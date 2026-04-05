import * as vscode from "vscode";
import { addSource, removeSource, setPriority, buildCatalog, runSetup, invalidateRegistryCache } from "./registry.js";
import * as path from "node:path";
import { invalidateMoldCache, runFimod, getOutputChannel, logStderr } from "./fimod.js";
import { RegistryTreeProvider, RegistryNode } from "./registryTree.js";
import { LocalMoldsTreeProvider, LocalMoldNode } from "./localMoldsTree.js";
import { showMoldDetailView } from "./moldDetail.js";

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
      const testsDir = path.join(path.dirname(moldPath), "tests");
      const result = await runFimod(["test", moldPath, testsDir]);
      logStderr(result);
      getOutputChannel().show();
      if (result.exitCode === 0) {
        vscode.window.showInformationMessage(`Tests passed for "${node.name}".`);
      } else {
        vscode.window.showErrorMessage(`Tests failed for "${node.name}". See Output for details.`);
      }
    }),

    vscode.commands.registerCommand(
      "fimod.moldShowDetail",
      async (ref?: { name: string; registry?: string; localPath?: string }) => {
        if (!ref) return;
        await showMoldDetailView(ref);
      },
    ),
  );
}
