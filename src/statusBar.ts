import * as vscode from "vscode";
import { getVersion } from "./fimod.js";

let statusBarItem: vscode.StatusBarItem;

export async function initStatusBar(ctx: vscode.ExtensionContext): Promise<void> {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.name = "Fimod";
  ctx.subscriptions.push(statusBarItem);

  await refreshVersion();
}

export async function refreshVersion(): Promise<void> {
  const version = await getVersion();
  if (version) {
    // "fimod X.Y.Z standard (Monty engine: vA.B.C)" → "fimod X.Y.Z"
    const short = version.match(/^fimod\s+\S+/)?.[0] ?? version;
    statusBarItem.text = `$(symbol-misc) ${short}`;
    statusBarItem.tooltip = version;
    statusBarItem.show();
  } else {
    statusBarItem.text = "$(symbol-misc) fimod: not found";
    statusBarItem.tooltip = "fimod binary not found. Click to download.";
    statusBarItem.command = "fimod.downloadBinary";
    statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    statusBarItem.show();
  }
}
