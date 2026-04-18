import * as vscode from "vscode";
import { addSource, removeSource, setPriority, buildCatalog, runSetup, invalidateRegistryCache } from "./registry.js";
import * as path from "node:path";
import * as fs from "node:fs";
import { invalidateMoldCache, runFimod, getOutputChannel, logStderr, extractErrorSummary } from "./fimod.js";
import { RegistryTreeProvider, RegistryNode } from "./registryTree.js";
import { LocalMoldsTreeProvider, LocalMoldNode } from "./localMoldsTree.js";
import { showMoldDetailView } from "./moldDetail.js";
import { openPlayground } from "./playgroundPanel.js";

const TESTS_DIR_OVERRIDES_KEY = "fimod.mold.testsDirOverrides";

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function getTestsDirOverride(ctx: vscode.ExtensionContext, moldFsPath: string): string | undefined {
  const overrides = ctx.workspaceState.get<Record<string, string>>(TESTS_DIR_OVERRIDES_KEY, {});
  return overrides[moldFsPath];
}

async function setTestsDirOverride(ctx: vscode.ExtensionContext, moldFsPath: string, dir: string): Promise<void> {
  const overrides = { ...ctx.workspaceState.get<Record<string, string>>(TESTS_DIR_OVERRIDES_KEY, {}) };
  overrides[moldFsPath] = dir;
  await ctx.workspaceState.update(TESTS_DIR_OVERRIDES_KEY, overrides);
}

function resolveTestsDir(ctx: vscode.ExtensionContext, moldUri: vscode.Uri): string {
  const override = getTestsDirOverride(ctx, moldUri.fsPath);
  if (override) return override;

  const pattern = vscode.workspace
    .getConfiguration("fimod.mold")
    .get<string>("testsDirPattern", "${workspaceFolder}/tests-molds/${moldName}");

  const moldDir = path.dirname(moldUri.fsPath);
  const moldName = path.basename(moldUri.fsPath, ".py");
  const wsFolder = vscode.workspace.getWorkspaceFolder(moldUri)?.uri.fsPath ?? path.dirname(moldDir);

  return pattern
    .replace(/\$\{moldDir\}/g, moldDir)
    .replace(/\$\{moldName\}/g, moldName)
    .replace(/\$\{workspaceFolder\}/g, wsFolder);
}

function canonicalizeDir(dirFsPath: string, moldUri: vscode.Uri): string {
  const wsFolder = vscode.workspace.getWorkspaceFolder(moldUri)?.uri.fsPath;
  if (wsFolder) {
    const rel = path.relative(wsFolder, dirFsPath);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return "${workspaceFolder}/" + rel.split(path.sep).join("/");
    }
  }
  return dirFsPath;
}

async function pickTestsDir(ctx: vscode.ExtensionContext, node: LocalMoldNode): Promise<string | undefined> {
  const current = resolveTestsDir(ctx, node.uri);
  const defaultUri = dirExists(current) ? vscode.Uri.file(current) : vscode.Uri.file(path.dirname(node.uri.fsPath));
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri,
    openLabel: "Use as tests directory",
  });
  if (!picked || picked.length === 0) return undefined;
  const canonical = canonicalizeDir(picked[0].fsPath, node.uri);
  await setTestsDirOverride(ctx, node.uri.fsPath, canonical);
  return canonical;
}

export function registerCommands(
  ctx: vscode.ExtensionContext,
  registryTree: RegistryTreeProvider,
  localMoldsTree: LocalMoldsTreeProvider,
): void {
  function refreshAll(): void {
    invalidateRegistryCache();
    invalidateMoldCache();
    registryTree.refresh();
    localMoldsTree.refresh();
  }

  ctx.subscriptions.push(
    // --- Registry actions ---

    vscode.commands.registerCommand("fimod.registryRefresh", () => {
      refreshAll();
    }),

    vscode.commands.registerCommand("fimod.registryAddSource", async () => {
      const name = await vscode.window.showInputBox({ prompt: "Source name", placeHolder: "my-source" });
      if (!name) return;
      const location = await vscode.window.showInputBox({
        prompt: "Path or URL",
        placeHolder: "/path/to/molds or https://...",
      });
      if (!location) return;
      if (await addSource(name, location)) {
        refreshAll();
      }
    }),

    vscode.commands.registerCommand("fimod.registryRemoveSource", async (node?: RegistryNode) => {
      const name = node?.kind === "source" ? node.source.name : undefined;
      if (!name) return;
      const confirm = await vscode.window.showWarningMessage(`Remove source "${name}"?`, { modal: true }, "Remove");
      if (confirm !== "Remove") return;
      if (await removeSource(name)) {
        refreshAll();
      }
    }),

    vscode.commands.registerCommand("fimod.registrySetPriority", async (node?: RegistryNode) => {
      const name = node?.kind === "source" ? node.source.name : undefined;
      if (!name) return;
      const input = await vscode.window.showInputBox({
        prompt: `Priority for "${name}" (0 = highest)`,
        placeHolder: "0",
        validateInput: (v) => (/^\d+$/.test(v) ? null : "Enter a number"),
      });
      if (input === undefined) return;
      if (await setPriority(name, parseInt(input, 10))) {
        refreshAll();
      }
    }),

    vscode.commands.registerCommand("fimod.registryBuildCatalog", async (node?: RegistryNode) => {
      const location = node?.kind === "source" ? node.source.location : undefined;
      if (await buildCatalog(location)) {
        refreshAll();
        vscode.window.showInformationMessage("Catalog built successfully.");
      }
    }),

    vscode.commands.registerCommand("fimod.registrySetup", async () => {
      if (await runSetup()) {
        refreshAll();
        vscode.window.showInformationMessage("Registry setup complete.");
      }
    }),

    vscode.commands.registerCommand("fimod.registryShowSource", async (node?: RegistryNode) => {
      if (node?.kind !== "source") return;
      const lines = [
        `Name: ${node.source.name}`,
        `Kind: ${node.source.kind}`,
        `Location: ${node.source.location}`,
        `Priority: ${node.source.priority}`,
      ];
      vscode.window.showInformationMessage(lines.join(" · "));
    }),

    // --- Local molds ---

    vscode.commands.registerCommand("fimod.localMoldsRefresh", () => {
      refreshAll();
    }),

    // --- Mold actions ---

    vscode.commands.registerCommand("fimod.moldOpen", async (node?: LocalMoldNode) => {
      if (!node) return;
      const doc = await vscode.workspace.openTextDocument(node.uri);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand("fimod.moldRun", async (node?: LocalMoldNode) => {
      if (!node) return;
      const fileUri = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: "Select input file",
      });
      if (!fileUri || fileUri.length === 0) return;
      const doc = await vscode.workspace.openTextDocument(fileUri[0]);
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand("fimod.shape");
    }),

    vscode.commands.registerCommand("fimod.moldTest", async (node?: LocalMoldNode) => {
      if (!node) return;
      const moldPath = node.uri.fsPath;
      let testsDir = resolveTestsDir(ctx, node.uri);

      if (!dirExists(testsDir)) {
        const choice = await vscode.window.showErrorMessage(`Tests directory not found: ${testsDir}`, "Set Directory");
        if (choice !== "Set Directory") return;
        const picked = await pickTestsDir(ctx, node);
        if (!picked) return;
        testsDir = resolveTestsDir(ctx, node.uri);
      }

      const result = await runFimod(["mold", "test", moldPath, testsDir]);
      logStderr(result);
      if (result.exitCode === 0) {
        vscode.window.showInformationMessage(`Tests passed for "${node.name}".`);
      } else {
        const summary = extractErrorSummary(result);
        const isMissingDir = /Not a directory|No such file/i.test(summary);
        const buttons = isMissingDir ? ["Set Directory", "Show Output"] : ["Show Output"];
        const choice = await vscode.window.showErrorMessage(`Tests failed for "${node.name}": ${summary}`, ...buttons);
        if (choice === "Set Directory") {
          const picked = await pickTestsDir(ctx, node);
          if (picked) {
            await vscode.commands.executeCommand("fimod.moldTest", node);
          }
        } else if (choice === "Show Output") {
          getOutputChannel().show();
        }
      }
    }),

    vscode.commands.registerCommand(
      "fimod.moldShowDetail",
      async (ref?: { name: string; registry?: string; localPath?: string }) => {
        if (!ref) return;
        await showMoldDetailView(ref);
      },
    ),

    vscode.commands.registerCommand("fimod.localMoldsSettings", () => {
      void vscode.commands.executeCommand("workbench.action.openSettings", "fimod.mold");
    }),

    vscode.commands.registerCommand("fimod.moldSetTestsDir", async (node?: LocalMoldNode) => {
      if (!node) return;
      const picked = await pickTestsDir(ctx, node);
      if (picked) {
        vscode.window.showInformationMessage(`Tests directory for "${node.name}" → ${picked}`);
      }
    }),

    // --- Phase 3 — Playground ---

    vscode.commands.registerCommand("fimod.playground", async (arg?: vscode.Uri | LocalMoldNode | RegistryNode) => {
      if (arg && typeof arg === "object" && "kind" in arg && arg.kind === "mold" && "mold" in arg) {
        await openPlayground({
          moldRef: {
            kind: "mold",
            cliArg: "@" + arg.mold.name,
            displayName: arg.mold.name,
          },
        });
        return;
      }

      let uri: vscode.Uri | undefined;
      if (arg instanceof vscode.Uri) {
        uri = arg;
      } else if (arg && (arg as LocalMoldNode).uri instanceof vscode.Uri) {
        uri = (arg as LocalMoldNode).uri;
      } else {
        uri = vscode.window.activeTextEditor?.document.uri;
      }

      if (!uri || uri.scheme !== "file") {
        await openPlayground({});
        return;
      }

      if (uri.fsPath.endsWith(".py")) {
        await openPlayground({
          moldRef: {
            kind: "mold",
            cliArg: uri.fsPath,
            displayName: path.basename(uri.fsPath),
            fsPath: uri.fsPath,
          },
        });
      } else {
        await openPlayground({ inputUri: uri });
      }
    }),
  );
}
