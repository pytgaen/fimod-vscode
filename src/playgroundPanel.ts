import * as vscode from "vscode";
import * as path from "node:path";
import { readFile } from "node:fs/promises";

// @ts-ignore — esbuild loads .css as text
import hljsCss from "highlight.js/styles/vs2015.min.css";

import { runPlayground } from "./playgroundEngine.js";
import { detectFormat, FORMATS } from "./format.js";
import { invalidateMoldCache } from "./fimod.js";
import { invalidateRegistryCache } from "./registry.js";
import { pickMoldOrExpression } from "./moldPicker.js";
import { getNonce } from "./util.js";

export interface PlaygroundMoldRef {
  kind: "mold" | "expression";
  cliArg: string;
  displayName: string;
  fsPath?: string;
}

export interface OpenPlaygroundArgs {
  moldRef?: PlaygroundMoldRef;
  inputUri?: vscode.Uri;
}

interface PlaygroundState {
  mold?: PlaygroundMoldRef;
  inputText: string;
  inputSourceLabel?: string;
  inputIsEdited: boolean;
  inputFormatOverride?: string;
  outputFormatOverride?: string;
  moldArgs: string;
  live: boolean;
  lastOutput?: { text: string; format?: string };
}

let currentPanel: vscode.WebviewPanel | undefined;
let state: PlaygroundState = { live: true, moldArgs: "", inputText: "", inputIsEdited: false };
let disposables: vscode.Disposable[] = [];
let runTimer: NodeJS.Timeout | undefined;
let running = false;

const DEBOUNCE_MS = 200;

export async function openPlayground(args: OpenPlaygroundArgs): Promise<void> {
  if (args.moldRef) state.mold = args.moldRef;
  if (args.inputUri) {
    try {
      state.inputText = await readFile(args.inputUri.fsPath, "utf-8");
      state.inputSourceLabel = path.basename(args.inputUri.fsPath);
      state.inputIsEdited = false;
    } catch {
      state.inputSourceLabel = undefined;
    }
  }

  if (!currentPanel) {
    currentPanel = vscode.window.createWebviewPanel(
      "fimod.playground",
      "Playground",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [vscode.Uri.file(path.join(__dirname))] },
    );

    const hljsUri = currentPanel.webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, "hljs.js")));
    const codiconCssUri = currentPanel.webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, "codicon.css")));
    currentPanel.webview.html = buildHtml(currentPanel.webview, hljsUri, codiconCssUri);

    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
      state = { live: true, moldArgs: "", inputText: "", inputIsEdited: false };
      disposeAll();
    });

    currentPanel.webview.onDidReceiveMessage(handleMessage);

    disposables.push(
      currentPanel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active && e.webviewPanel.visible) {
          scheduleRun(0);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (state.live && matchesWatchedFile(doc.uri)) {
          scheduleRun(DEBOUNCE_MS);
        }
      }),
    );
  } else {
    currentPanel.reveal(vscode.ViewColumn.Beside, true);
  }

  currentPanel.title = buildTitle();
  await postState();
  scheduleRun(0);
}

function matchesWatchedFile(uri: vscode.Uri): boolean {
  if (state.mold?.fsPath && uri.fsPath === state.mold.fsPath) return true;
  return false;
}

function buildTitle(): string {
  const parts: string[] = ["Playground"];
  if (state.mold) parts.push(state.mold.displayName);
  if (state.inputSourceLabel) {
    const suffix = state.inputIsEdited ? " (edited)" : "";
    parts.push("← " + state.inputSourceLabel + suffix);
  }
  return parts.join(" ");
}

function disposeAll(): void {
  for (const d of disposables) d.dispose();
  disposables = [];
  if (runTimer) {
    clearTimeout(runTimer);
    runTimer = undefined;
  }
}

function scheduleRun(delayMs: number): void {
  if (runTimer) clearTimeout(runTimer);
  runTimer = setTimeout(() => {
    runTimer = undefined;
    void runOnce();
  }, delayMs);
}

async function postState(): Promise<void> {
  if (!currentPanel) return;
  await currentPanel.webview.postMessage({
    type: "state",
    mold: state.mold ? { displayName: state.mold.displayName, kind: state.mold.kind } : undefined,
    inputText: state.inputText,
    inputSourceLabel: state.inputSourceLabel,
    inputIsEdited: state.inputIsEdited,
    inputFormatOverride: state.inputFormatOverride,
    outputFormatOverride: state.outputFormatOverride,
    moldArgs: state.moldArgs,
    live: state.live,
  });
}

async function runOnce(): Promise<void> {
  if (!currentPanel || running) return;
  if (!state.mold || !state.inputText) {
    await currentPanel.webview.postMessage({
      type: "status",
      text:
        !state.mold && !state.inputText
          ? "Pick a mold and provide input."
          : !state.mold
            ? "Pick a mold."
            : "Provide input (type, paste, or load a file).",
    });
    return;
  }

  const inputText = state.inputText;
  const detected = detectFormat(inputText, "");
  const effectiveInputFormat = state.inputFormatOverride ?? detected;

  await currentPanel.webview.postMessage({ type: "running" });

  running = true;
  const t0 = Date.now();
  const result = await runPlayground({
    [state.mold.kind === "expression" ? "expression" : "mold"]: state.mold.cliArg,
    input: inputText,
    inputFormat: state.inputFormatOverride,
    outputFormat: state.outputFormatOverride,
    moldArgs: state.moldArgs ? state.moldArgs.split("\n") : undefined,
  });
  const elapsed = Date.now() - t0;
  running = false;

  if (result.kind === "error") {
    await currentPanel.webview.postMessage({
      type: "error",
      message: result.errorText,
      lastOutput: state.lastOutput,
      elapsed,
    });
  } else {
    const outFormat = state.outputFormatOverride ?? effectiveInputFormat;
    state.lastOutput = { text: result.output, format: outFormat };
    await currentPanel.webview.postMessage({
      type: "result",
      output: result.output,
      format: outFormat,
      elapsed,
    });
  }
}

async function applyStateChange(options: { run: boolean } = { run: true }): Promise<void> {
  if (currentPanel) currentPanel.title = buildTitle();
  await postState();
  if (options.run) scheduleRun(0);
}

async function pickMold(): Promise<void> {
  const pick = await pickMoldOrExpression();
  if (!pick) return;
  const c = pick.choice;
  if (c.type === "mold") {
    state.mold = { kind: "mold", cliArg: c.name, displayName: c.name };
  } else if (c.type === "localMold") {
    state.mold = {
      kind: "mold",
      cliArg: c.path,
      displayName: path.basename(c.path),
      fsPath: c.path,
    };
  } else {
    state.mold = { kind: "expression", cliArg: c.expr, displayName: `expr: ${c.expr}` };
  }
  await applyStateChange();
}

async function pickInput(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Load as Playground input",
  });
  if (!picked || picked.length === 0) return;
  try {
    state.inputText = await readFile(picked[0].fsPath, "utf-8");
    state.inputSourceLabel = path.basename(picked[0].fsPath);
    state.inputIsEdited = false;
  } catch (e) {
    void vscode.window.showErrorMessage(`Cannot read input: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  await applyStateChange();
}

async function pasteInput(): Promise<void> {
  const text = await vscode.env.clipboard.readText();
  if (!text) return;
  state.inputText = text;
  state.inputSourceLabel = "clipboard";
  state.inputIsEdited = false;
  await applyStateChange();
}

async function clearInput(): Promise<void> {
  state.inputText = "";
  state.inputSourceLabel = undefined;
  state.inputIsEdited = false;
  await applyStateChange({ run: false });
}

async function copyOutput(): Promise<void> {
  if (!state.lastOutput) return;
  await vscode.env.clipboard.writeText(state.lastOutput.text);
  void vscode.window.showInformationMessage("Output copied to clipboard.");
}

async function saveOutput(): Promise<void> {
  if (!state.lastOutput) return;
  const ext = state.lastOutput.format ?? "txt";
  const defaultUri = vscode.workspace.workspaceFolders?.[0]
    ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, `playground-output.${ext}`)
    : undefined;
  const target = await vscode.window.showSaveDialog({ defaultUri, saveLabel: "Save Playground output" });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(state.lastOutput.text, "utf-8"));
  void vscode.window.showInformationMessage(`Saved → ${path.basename(target.fsPath)}`);
}

type InboundMessage =
  | { type: "pickMold" | "pickInput" | "pasteInput" | "clearInput" | "copyOutput" | "saveOutput" | "run" | "refresh" }
  | { type: "editInput" | "setInputFormat" | "setOutputFormat" | "setArgs"; value: string }
  | { type: "toggleLive"; value: boolean };

async function handleMessage(msg: InboundMessage): Promise<void> {
  switch (msg.type) {
    case "pickMold":
      await pickMold();
      break;
    case "pickInput":
      await pickInput();
      break;
    case "pasteInput":
      await pasteInput();
      break;
    case "clearInput":
      await clearInput();
      break;
    case "editInput":
      state.inputText = msg.value ?? "";
      if (state.inputSourceLabel) {
        state.inputIsEdited = true;
      } else {
        state.inputSourceLabel = "scratchpad";
        state.inputIsEdited = false;
      }
      if (currentPanel) currentPanel.title = buildTitle();
      if (state.live) scheduleRun(DEBOUNCE_MS);
      break;
    case "copyOutput":
      await copyOutput();
      break;
    case "saveOutput":
      await saveOutput();
      break;
    case "setInputFormat":
      state.inputFormatOverride = msg.value || undefined;
      if (state.live) scheduleRun(DEBOUNCE_MS);
      break;
    case "setOutputFormat":
      state.outputFormatOverride = msg.value || undefined;
      if (state.live) scheduleRun(DEBOUNCE_MS);
      break;
    case "setArgs":
      state.moldArgs = msg.value ?? "";
      if (state.live) scheduleRun(DEBOUNCE_MS);
      break;
    case "toggleLive":
      state.live = Boolean(msg.value);
      break;
    case "run":
      scheduleRun(0);
      break;
    case "refresh":
      invalidateRegistryCache();
      invalidateMoldCache();
      scheduleRun(0);
      break;
  }
}

function buildHtml(webview: vscode.Webview, hljsUri: vscode.Uri, codiconCssUri: vscode.Uri): string {
  const nonce = getNonce();
  const formatOptions = [
    '<option value="">auto</option>',
    ...FORMATS.map((f) => `<option value="${f}">${f}</option>`),
  ].join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <script src="${hljsUri}" nonce="${nonce}"></script>
  <link rel="stylesheet" href="${codiconCssUri}">
  <style>${hljsCss}</style>
  <style>
    html, body { height: 100%; margin: 0; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      flex-wrap: wrap;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .toolbar button, .toolbar select {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-widget-border);
      padding: 4px 10px;
      font-size: 0.85em;
      cursor: pointer;
      border-radius: 3px;
    }
    .toolbar button { display: inline-flex; align-items: center; gap: 6px; }
    .toolbar button .codicon { font-size: 14px; }
    .pane-header button .codicon { font-size: 14px; vertical-align: middle; }
    .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .toolbar button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .toolbar button.primary:hover { background: var(--vscode-button-hoverBackground); }
    .toolbar button.pulse { animation: pulse 1.5s infinite; border-color: var(--vscode-focusBorder); }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 var(--vscode-focusBorder); }
      50% { box-shadow: 0 0 0 4px transparent; }
    }
    .toolbar label { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
    .toolbar .sep { width: 1px; height: 20px; background: var(--vscode-widget-border); }
    .toolbar .spacer { flex: 1; }
    .args-row {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .args-row textarea {
      width: 100%;
      min-height: 40px;
      box-sizing: border-box;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 4px 8px;
      resize: vertical;
    }
    .panes {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    .pane {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      border-right: 1px solid var(--vscode-widget-border);
    }
    .pane:last-child { border-right: none; }
    .pane-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px 4px 12px;
      font-size: 0.75em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-editorWidget-background);
      border-bottom: 1px solid var(--vscode-widget-border);
      min-height: 24px;
    }
    .pane-header .label-source {
      text-transform: none;
      letter-spacing: 0;
      font-style: italic;
      opacity: 0.7;
    }
    .pane-header .spacer { flex: 1; }
    .pane-header button {
      background: transparent;
      color: var(--vscode-foreground);
      border: 1px solid transparent;
      padding: 1px 6px;
      font-size: 1em;
      cursor: pointer;
      border-radius: 3px;
    }
    .pane-header button:hover {
      background: var(--vscode-toolbar-hoverBackground);
      border-color: var(--vscode-widget-border);
    }
    .pane-header button.pulse { animation: pulse 1.5s infinite; border-color: var(--vscode-focusBorder); }
    .pane-header button:disabled { opacity: 0.4; cursor: default; }
    .pane-header button:disabled:hover { background: transparent; border-color: transparent; }
    textarea.scratchpad {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      border: none;
      outline: none;
      resize: none;
      padding: 12px;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .pane-body {
      flex: 1;
      overflow: auto;
      position: relative;
    }
    pre.code {
      margin: 0;
      padding: 12px;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      white-space: pre-wrap;
      word-wrap: break-word;
      min-height: 100%;
      box-sizing: border-box;
    }
    pre.code.stale { opacity: 0.4; }
    pre.code.placeholder { color: var(--vscode-descriptionForeground); font-style: italic; }
    .error-banner {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
      border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
      padding: 8px 12px;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .error-banner.hidden { display: none; }
    .status {
      padding: 4px 12px;
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      border-top: 1px solid var(--vscode-widget-border);
      background: var(--vscode-statusBar-background);
      min-height: 20px;
    }
    .status.running::before { content: '⏳ '; }
    .args-row.hidden { display: none; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="pickMold"><i class="codicon codicon-beaker"></i><span id="moldLabel">Pick mold…</span></button>
    <span class="sep"></span>
    <label>in</label>
    <select id="inputFormat">${formatOptions}</select>
    <label>out</label>
    <select id="outputFormat">${formatOptions}</select>
    <span class="sep"></span>
    <label><input type="checkbox" id="live" checked> Live</label>
    <button id="run" class="primary"><i class="codicon codicon-play"></i>Run</button>
    <button id="refresh" title="Reload mold from registry / clear caches"><i class="codicon codicon-refresh"></i></button>
  </div>
  <div class="args-row" id="argsRow">
    <textarea id="moldArgs" placeholder="Mold args: key=value, one per line (leave empty if none)"></textarea>
  </div>
  <div class="panes">
    <div class="pane">
      <div class="pane-header">
        <span>Input</span>
        <span class="label-source" id="inputSource">scratchpad</span>
        <span class="spacer"></span>
        <button id="pasteInput" title="Paste from clipboard"><i class="codicon codicon-clippy"></i></button>
        <button id="loadInput" title="Load from file…"><i class="codicon codicon-folder-opened"></i></button>
        <button id="clearInput" title="Clear"><i class="codicon codicon-close"></i></button>
      </div>
      <div class="pane-body"><textarea class="scratchpad" id="input" placeholder="Type, paste, or load your input here…" spellcheck="false"></textarea></div>
    </div>
    <div class="pane">
      <div class="pane-header">
        <span>Output</span>
        <span class="spacer"></span>
        <button id="copyOutput" title="Copy to clipboard" disabled><i class="codicon codicon-copy"></i></button>
        <button id="saveOutput" title="Save to file…" disabled><i class="codicon codicon-save"></i></button>
      </div>
      <div class="pane-body">
        <div class="error-banner hidden" id="errorBanner"></div>
        <pre class="code placeholder" id="output">No output yet.</pre>
      </div>
    </div>
  </div>
  <div class="status" id="status">Idle.</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);

    function highlight(el, text, format) {
      el.classList.remove('placeholder');
      const lang = format && hljs.getLanguage(format) ? format : null;
      if (lang) {
        el.innerHTML = '<code>' + hljs.highlight(text, { language: lang }).value + '</code>';
      } else {
        el.textContent = text;
      }
    }

    $('pickMold').addEventListener('click', () => vscode.postMessage({ type: 'pickMold' }));
    $('pasteInput').addEventListener('click', () => vscode.postMessage({ type: 'pasteInput' }));
    $('loadInput').addEventListener('click', () => vscode.postMessage({ type: 'pickInput' }));
    $('clearInput').addEventListener('click', () => vscode.postMessage({ type: 'clearInput' }));
    $('copyOutput').addEventListener('click', () => vscode.postMessage({ type: 'copyOutput' }));
    $('saveOutput').addEventListener('click', () => vscode.postMessage({ type: 'saveOutput' }));
    $('inputFormat').addEventListener('change', (e) => vscode.postMessage({ type: 'setInputFormat', value: e.target.value }));
    $('outputFormat').addEventListener('change', (e) => vscode.postMessage({ type: 'setOutputFormat', value: e.target.value }));
    $('live').addEventListener('change', (e) => vscode.postMessage({ type: 'toggleLive', value: e.target.checked }));
    $('run').addEventListener('click', () => vscode.postMessage({ type: 'run' }));
    $('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

    let argsTimer;
    $('moldArgs').addEventListener('input', (e) => {
      clearTimeout(argsTimer);
      const value = e.target.value;
      argsTimer = setTimeout(() => vscode.postMessage({ type: 'setArgs', value }), 250);
    });

    let inputTimer;
    $('input').addEventListener('input', (e) => {
      clearTimeout(inputTimer);
      const value = e.target.value;
      inputTimer = setTimeout(() => vscode.postMessage({ type: 'editInput', value }), 250);
    });

    function setOutputActionsEnabled(enabled) {
      $('copyOutput').disabled = !enabled;
      $('saveOutput').disabled = !enabled;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'state': {
          $('moldLabel').textContent = msg.mold ? msg.mold.displayName : 'Pick mold…';
          $('pickMold').classList.toggle('pulse', !msg.mold);
          {
            const label = msg.inputSourceLabel ?? 'scratchpad';
            $('inputSource').textContent = msg.inputIsEdited ? label + ' (edited)' : label;
          }
          if (document.activeElement !== $('input')) {
            $('input').value = msg.inputText ?? '';
          }
          const empty = !msg.inputText;
          $('pasteInput').classList.toggle('pulse', empty);
          $('loadInput').classList.toggle('pulse', empty);
          $('inputFormat').value = msg.inputFormatOverride ?? '';
          $('outputFormat').value = msg.outputFormatOverride ?? '';
          $('live').checked = msg.live;
          if (document.activeElement !== $('moldArgs')) {
            $('moldArgs').value = msg.moldArgs ?? '';
          }
          break;
        }
        case 'running':
          $('status').textContent = 'Running…';
          $('status').classList.add('running');
          break;
        case 'result': {
          $('errorBanner').classList.add('hidden');
          $('output').classList.remove('stale');
          highlight($('output'), msg.output, msg.format);
          setOutputActionsEnabled(true);
          $('status').classList.remove('running');
          $('status').textContent = '✓ ' + msg.elapsed + 'ms';
          break;
        }
        case 'error': {
          $('errorBanner').textContent = msg.message;
          $('errorBanner').classList.remove('hidden');
          if (msg.lastOutput) {
            highlight($('output'), msg.lastOutput.text, msg.lastOutput.format);
            $('output').classList.add('stale');
            setOutputActionsEnabled(true);
          } else {
            $('output').textContent = '(no previous output)';
            $('output').classList.add('placeholder');
            $('output').classList.remove('stale');
            setOutputActionsEnabled(false);
          }
          $('status').classList.remove('running');
          $('status').textContent = msg.elapsed != null ? '✗ ' + msg.elapsed + 'ms' : '✗ error';
          break;
        }
        case 'status':
          $('errorBanner').classList.add('hidden');
          $('status').classList.remove('running');
          $('status').textContent = msg.text;
          break;
      }
    });
  </script>
</body>
</html>`;
}
