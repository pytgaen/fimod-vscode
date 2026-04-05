import * as vscode from "vscode";
import * as path from "node:path";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import bash from "highlight.js/lib/languages/bash";
import toml from "highlight.js/lib/languages/ini"; // hljs uses ini for toml
import markdown from "highlight.js/lib/languages/markdown";
import javascript from "highlight.js/lib/languages/javascript";
import sql from "highlight.js/lib/languages/sql";
import shell from "highlight.js/lib/languages/shell";

hljs.registerLanguage("python", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("toml", toml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("sh", shell);
import { showMold, fetchReadme, MoldDetail } from "./registry.js";
import { runFimod } from "./fimod.js";
import { extractDocstring } from "./localMoldsTree.js";
import { escapeHtml } from "./util.js";
import { FORMATS } from "./format.js";
import { readFile } from "node:fs/promises";

const md = new MarkdownIt({
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(str, { language: lang }).value;
    }
    return "";
  },
});

// @ts-ignore — esbuild loads .css as text
import hljsCss from "highlight.js/styles/vs2015.min.css";

interface RunMessage {
  type: "run";
  input?: string;
  inputFormat?: string;
  outputFormat?: string;
  moldArgs?: string;
}

type WebviewMessage = RunMessage;

let currentPanel: vscode.WebviewPanel | undefined;
let messageListener: vscode.Disposable | undefined;

export async function showMoldDetailView(moldRef: {
  name: string;
  registry?: string;
  localPath?: string;
}): Promise<void> {
  let detail: MoldDetail;
  let moldArg: string; // CLI arg for -m

  let localSource: string | undefined;

  if (moldRef.localPath) {
    try {
      localSource = await readFile(moldRef.localPath, "utf-8");
    } catch {
      vscode.window.showErrorMessage(`Cannot read mold file "${moldRef.localPath}".`);
      return;
    }
    detail = {
      name: moldRef.name,
      description: extractDocstring(localSource) ?? "",
      sourcePath: moldRef.localPath,
      args: [],
    };
    moldArg = moldRef.localPath;
  } else {
    const resolved = await showMold(moldRef.name);
    if (!resolved) {
      vscode.window.showErrorMessage(`Could not load details for mold "${moldRef.name}".`);
      return;
    }
    detail = resolved;
    moldArg = `@${detail.name}`;
  }

  const [sourceCode, readme] = await Promise.all([
    localSource ?? (detail.sourcePath ? readFile(detail.sourcePath, "utf-8").catch(() => undefined) : undefined),
    detail.readmePath ? fetchReadme(detail.readmePath) : undefined,
  ]);

  // Create or reuse panel
  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      "fimod.moldDetail",
      `Mold: ${detail.name}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [vscode.Uri.file(path.join(__dirname))] },
    );
    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
    });
  }

  currentPanel.title = `Mold: ${detail.name}`;
  const hljsUri = currentPanel.webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, "hljs.js")));
  currentPanel.webview.html = buildHtml(detail, sourceCode, readme, currentPanel.webview, hljsUri);

  // Handle playground messages — dispose previous listener to avoid duplicates on panel reuse
  messageListener?.dispose();
  messageListener = currentPanel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
    if (msg.type === "run") {
      const cliArgs = ["shape"];
      if (msg.inputFormat) {
        cliArgs.push("--input-format", msg.inputFormat);
      }
      if (msg.outputFormat) {
        cliArgs.push("--output-format", msg.outputFormat);
      }
      if (msg.moldArgs) {
        for (const pair of msg.moldArgs.split("\n")) {
          const trimmed = pair.trim();
          if (trimmed) {
            cliArgs.push("--arg", trimmed);
          }
        }
      }
      cliArgs.push("-m", moldArg);
      const result = await runFimod(cliArgs, msg.input);
      if (result.exitCode !== 0) {
        const errText =
          result.messages
            .filter((m) => m.level === "error" || m.level === "fail")
            .map((m) => m.text)
            .join("\n") ||
          result.stderr ||
          `Exit code ${result.exitCode}`;
        currentPanel?.webview.postMessage({ type: "error", message: errText });
      } else {
        const effectiveOutFmt = msg.outputFormat || detail.outputFormat || msg.inputFormat || detail.inputFormat;
        currentPanel?.webview.postMessage({ type: "result", output: result.stdout, format: effectiveOutFmt });
      }
    }
  });
}

function buildHtml(
  detail: MoldDetail,
  sourceCode?: string,
  readme?: string,
  webview?: vscode.Webview,
  hljsUri?: vscode.Uri,
): string {
  const nonce = getNonce();
  const escapedName = escapeHtml(detail.name);
  const registryBadge = detail.registry ? ` <span class="badge">${escapeHtml(detail.registry)}</span>` : "";

  // Args table
  let argsHtml = "";
  if (detail.args.length > 0) {
    argsHtml = `<h2>Arguments</h2><table class="args-table">
      <tr><th>Name</th><th>Description</th></tr>
      ${detail.args.map((a) => `<tr><td><code>${escapeHtml(a.name)}</code></td><td>${escapeHtml(a.description)}</td></tr>`).join("")}
    </table>`;
  }

  // Format info
  let formatInfo = "";
  if (detail.inputFormat || detail.outputFormat) {
    const parts: string[] = [];
    if (detail.inputFormat) parts.push(`Input: <code>${escapeHtml(detail.inputFormat)}</code>`);
    if (detail.outputFormat) parts.push(`Output: <code>${escapeHtml(detail.outputFormat)}</code>`);
    formatInfo = `<p class="format-info">${parts.join(" · ")}</p>`;
  }

  // Description / README — rendered as markdown
  let docHtml: string;
  if (readme) {
    docHtml = `<div class="readme">${md.render(readme)}</div>`;
  } else if (detail.description) {
    docHtml = `<div class="readme">${md.render(detail.description)}</div>`;
  } else {
    docHtml = `<p class="muted">No documentation available.</p>`;
  }

  // Source code (tab content)
  let sourceTab = "";
  let sourcePanel = "";
  if (sourceCode) {
    const highlighted = hljs.highlight(sourceCode, { language: "python" }).value;
    sourceTab = `<button class="tab" data-tab="source">🐍 Source</button>`;
    sourcePanel = `<div class="tab-panel" id="tab-source"><pre class="source-code"><code>${highlighted}</code></pre></div>`;
  }

  // Format options for dropdowns, pre-select from mold directives
  const inputFormatOptions = FORMATS.map(
    (f) => `<option value="${f}"${f === detail.inputFormat ? " selected" : ""}>${f}</option>`,
  ).join("");
  const outputFormatOptions = FORMATS.map(
    (f) => `<option value="${f}"${f === detail.outputFormat ? " selected" : ""}>${f}</option>`,
  ).join("");
  const inputAutoSelected = detail.inputFormat ? "" : " selected";
  const outputAutoSelected = detail.outputFormat ? "" : " selected";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview?.cspSource || ""};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="${hljsUri}" nonce="${nonce}"></script>
  <style>${hljsCss}</style>
  <style>
    html, body { height: 100%; margin: 0; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      padding: 0;
      line-height: 1.5;
      display: flex;
      flex-direction: column;
    }
    .doc-pane {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      min-height: 0;
    }
    h1 { font-size: 1.4em; margin-bottom: 4px; }
    h2 { font-size: 1.1em; margin-top: 24px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 4px; }
    .badge {
      font-size: 0.75em;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      vertical-align: middle;
    }
    .format-info { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .muted { color: var(--vscode-descriptionForeground); font-style: italic; }
    pre.doc, pre.source-code {
      background: var(--vscode-textBlockQuote-background);
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
    .args-table { border-collapse: collapse; width: 100%; }
    .args-table th, .args-table td {
      text-align: left;
      padding: 4px 12px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    .args-table th { font-weight: 600; }
    .playground {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      border-top: 1px solid var(--vscode-widget-border);
    }
    .playground.expanded {
      min-height: 120px;
    }
    .playground-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px;
      cursor: pointer;
      user-select: none;
      font-weight: 600;
      font-size: 1em;
      color: var(--vscode-editor-foreground);
    }
    .playground-header:hover { background: var(--vscode-list-hoverBackground); }
    .playground-header .chevron {
      display: inline-block;
      transition: transform 0.15s;
      font-size: 0.75em;
    }
    .playground.expanded .playground-header .chevron { transform: rotate(90deg); }
    .playground-body {
      display: none;
      flex: 1;
      overflow-y: auto;
      padding: 0 16px 12px;
    }
    .playground.expanded .playground-body { display: block; }
    .resize-handle {
      height: 4px;
      cursor: row-resize;
      background: transparent;
      flex-shrink: 0;
      display: none;
    }
    .resize-handle:hover, .resize-handle.dragging {
      background: var(--vscode-focusBorder);
    }
    .resize-handle.visible { display: block; }

    .playground-toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .playground-toolbar label { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
    .playground-toolbar select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 2px 6px;
      font-size: 0.85em;
    }
    .playground-row { display: flex; gap: 12px; }
    .playground-col { flex: 1; display: flex; flex-direction: column; }
    .playground-col label { font-size: 0.85em; margin-bottom: 4px; font-weight: 600; }
    .code-editor {
      position: relative;
      min-height: 120px;
    }
    .code-editor textarea#input {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.4;
      background: transparent;
      color: transparent;
      caret-color: var(--vscode-editor-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 8px;
      resize: vertical;
      min-height: 120px;
      width: 100%;
      box-sizing: border-box;
      position: relative;
      z-index: 1;
      white-space: pre-wrap;
      word-wrap: break-word;
      margin: 0;
    }
    .code-editor .code-highlight {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      padding: 8px;
      margin: 0;
      overflow: auto;
      pointer-events: none;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.4;
      white-space: pre-wrap;
      word-wrap: break-word;
      border: 1px solid transparent;
      background: var(--vscode-input-background);
      box-sizing: border-box;
      color: var(--vscode-input-foreground);
    }
    .code-editor .code-highlight code {
      font-family: inherit;
      font-size: inherit;
    }
    pre#output {
      background: var(--vscode-textBlockQuote-background);
      padding: 8px;
      min-height: 120px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      border: 1px solid var(--vscode-widget-border);
      margin: 0;
    }
    pre#output.error { color: var(--vscode-errorForeground); }
    pre#output.running {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    pre#output.running::before { content: '⏳ Running…'; }
    button#run {
      margin-top: 8px;
      padding: 6px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      cursor: pointer;
      font-size: 0.9em;
    }
    button#run:hover { background: var(--vscode-button-hoverBackground); }
    button#run:disabled { opacity: 0.5; cursor: default; }
    .args-input {
      flex: 1;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 4px 8px;
      resize: vertical;
    }
    .col-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .col-header label { font-size: 0.85em; font-weight: 600; }
    .icon-btn {
      background: none;
      border: 1px solid var(--vscode-widget-border);
      color: var(--vscode-descriptionForeground);
      padding: 2px 8px;
      font-size: 0.75em;
      cursor: pointer;
      border-radius: 3px;
    }
    .icon-btn:hover { color: var(--vscode-editor-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--vscode-widget-border);
      margin-top: 16px;
    }
    .tab {
      padding: 8px 16px;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font-size: 1em;
    }
    .tab:hover { color: var(--vscode-editor-foreground); }
    .tab.active {
      color: var(--vscode-editor-foreground);
      border-bottom-color: var(--vscode-focusBorder);
    }
    .tab-panel { display: none; padding-top: 12px; }
    .tab-panel.active { display: block; }
  </style>
</head>
<body>
  <div class="doc-pane">
    <h1>${escapedName}${registryBadge}</h1>
    ${formatInfo}
    ${argsHtml}

    <div class="tabs">
      <button class="tab active" data-tab="doc">📖 Doc</button>
      ${sourceTab}
    </div>
    <div class="tab-panel active" id="tab-doc">${docHtml}</div>
    ${sourcePanel}
  </div>

  <div class="resize-handle" id="resizeHandle"></div>
  <div class="playground" id="playground">
    <div class="playground-header" id="playgroundToggle">
      <span class="chevron">&#9654;</span> 🧪 Try it
    </div>
    <div class="playground-body">
    <div class="playground-toolbar">
      <label>Input format</label>
      <select id="inputFormat">
        <option value=""${inputAutoSelected}>auto</option>
        ${inputFormatOptions}
      </select>
      <label>Output format</label>
      <select id="outputFormat">
        <option value=""${outputAutoSelected}>auto</option>
        ${outputFormatOptions}
      </select>
    </div>
    <div class="playground-toolbar">
      <label>Args</label>
      <textarea id="moldArgs" rows="2" class="args-input" placeholder="key=value (one per line)"></textarea>
    </div>
    <div class="playground-row">
      <div class="playground-col">
        <div class="col-header"><label>Input</label><button class="icon-btn" id="pasteBtn" title="Paste from clipboard">Paste</button></div>
        <div class="code-editor">
          <pre class="code-highlight" aria-hidden="true"><code id="inputHighlight"></code></pre>
          <textarea id="input" rows="8" placeholder="Paste your data here..." spellcheck="false"></textarea>
        </div>
      </div>
      <div class="playground-col">
        <div class="col-header"><label>Output</label><button class="icon-btn" id="copyBtn" title="Copy to clipboard">Copy</button></div>
        <pre id="output"></pre>
      </div>
    </div>
    <button id="run">Run</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Tab switching
    document.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });
    // Playground toggle + resize
    const pgEl = document.getElementById('playground');
    const pgToggle = document.getElementById('playgroundToggle');
    const resizeHandle = document.getElementById('resizeHandle');

    pgToggle.addEventListener('click', () => {
      const expanded = pgEl.classList.toggle('expanded');
      resizeHandle.classList.toggle('visible', expanded);
      if (!expanded) { pgEl.style.height = ''; }
    });

    let startY, startH;
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startY = e.clientY;
      startH = pgEl.offsetHeight;
      resizeHandle.classList.add('dragging');
      const onMove = (ev) => {
        const delta = startY - ev.clientY;
        pgEl.style.height = Math.max(120, startH + delta) + 'px';
      };
      const onUp = () => {
        resizeHandle.classList.remove('dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    const runBtn = document.getElementById('run');
    const inputEl = document.getElementById('input');
    const outputEl = document.getElementById('output');
    const inputFmt = document.getElementById('inputFormat');
    const outputFmt = document.getElementById('outputFormat');
    const moldArgsEl = document.getElementById('moldArgs');
    const pasteBtn = document.getElementById('pasteBtn');
    const copyBtn = document.getElementById('copyBtn');

    const inputHlEl = document.getElementById('inputHighlight');
    const FORMAT_LANG = { json: 'json', yaml: 'yaml', toml: 'toml' };
    function escapeForHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    function highlightText(text, format) {
      if (!text) return '';
      if (text.length > 50000) return escapeForHtml(text);
      const lang = FORMAT_LANG[format];
      try {
        return lang ? hljs.highlight(text, { language: lang }).value : escapeForHtml(text);
      } catch { return escapeForHtml(text); }
    }
    function updateInputHighlight() {
      inputHlEl.innerHTML = highlightText(inputEl.value, inputFmt.value);
    }
    inputEl.addEventListener('input', updateInputHighlight);
    inputFmt.addEventListener('change', updateInputHighlight);
    const hlPre = inputHlEl.parentElement;
    inputEl.addEventListener('scroll', () => {
      hlPre.scrollTop = inputEl.scrollTop;
      hlPre.scrollLeft = inputEl.scrollLeft;
    });
    new ResizeObserver(() => {
      hlPre.style.height = inputEl.offsetHeight + 'px';
    }).observe(inputEl);

    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        inputEl.value = text;
        updateInputHighlight();
      } catch {
        pasteBtn.textContent = 'Unavailable';
        setTimeout(() => { pasteBtn.textContent = 'Paste'; }, 1500);
      }
    });

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(outputEl.textContent || '');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      } catch {
        copyBtn.textContent = 'Unavailable';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      }
    });

    function runMold() {
      runBtn.disabled = true;
      runBtn.textContent = 'Running…';
      outputEl.textContent = '';
      outputEl.className = 'running';
      vscode.postMessage({
        type: 'run',
        input: inputEl.value,
        inputFormat: inputFmt.value || undefined,
        outputFormat: outputFmt.value || undefined,
        moldArgs: moldArgsEl.value || undefined,
      });
    }

    runBtn.addEventListener('click', runMold);

    // Ctrl+Enter / Cmd+Enter from any playground input to run
    document.getElementById('playground').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !runBtn.disabled) {
        e.preventDefault();
        runMold();
      }
    });

    window.addEventListener('message', (event) => {
      runBtn.disabled = false;
      runBtn.textContent = 'Run';
      const msg = event.data;
      if (msg.type === 'result') {
        outputEl.innerHTML = highlightText(msg.output, msg.format || outputFmt.value);
        outputEl.className = '';
      } else if (msg.type === 'error') {
        outputEl.textContent = msg.message;
        outputEl.className = 'error';
      }
    });
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
