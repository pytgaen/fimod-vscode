import * as vscode from "vscode";
import { initOutputChannel, getOutputChannel, setExtensionContext } from "./fimod.js";
import { initStatusBar, refreshVersion } from "./statusBar.js";
import { ensureBinary, downloadBinary } from "./binary.js";
import { shape, previewProvider, setLocalMoldsTree } from "./shape.js";
import { initHistory } from "./moldPicker.js";
import { createRegistryTree } from "./registryTree.js";
import { createLocalMoldsTree } from "./localMoldsTree.js";
import { registerCommands } from "./commands.js";

export function activate(ctx: vscode.ExtensionContext): void {
  setExtensionContext(ctx);
  initOutputChannel(ctx);
  initHistory(ctx.globalState);

  // Phase 1 — Shape
  ctx.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("fimod-preview", previewProvider),
    vscode.commands.registerCommand("fimod.shape", shape),
    vscode.commands.registerCommand("fimod.downloadBinary", async () => {
      try {
        await downloadBinary(ctx);
        await refreshVersion();
      } catch (e) {
        void vscode.window.showErrorMessage(`Fimod download failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );

  // Phase 2 — Registry & Molds Browser
  const registryTree = createRegistryTree(ctx);
  const localMoldsTree = createLocalMoldsTree(ctx);
  setLocalMoldsTree(localMoldsTree);
  registerCommands(ctx, registryTree, localMoldsTree);

  // Ensure binary is available, then init status bar
  ensureBinary(ctx)
    .catch((err) => {
      getOutputChannel().appendLine(`Binary check failed: ${err}`);
      return false;
    })
    .finally(() => {
      initStatusBar(ctx).catch((err) => {
        getOutputChannel().appendLine(`Status bar init failed: ${err}`);
      });
    });
}

export function deactivate(): void {}
