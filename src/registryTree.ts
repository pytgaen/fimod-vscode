import * as vscode from "vscode";
import { RegistrySource, RegistryMold, listSources, listMoldsForSource } from "./registry.js";

// --- Tree node types ---

export type RegistryNode =
  | { kind: "source"; source: RegistrySource }
  | { kind: "mold"; mold: RegistryMold; sourceName: string };

// --- Tree data provider ---

export class RegistryTreeProvider implements vscode.TreeDataProvider<RegistryNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RegistryNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(node: RegistryNode): vscode.TreeItem {
    if (node.kind === "source") {
      return sourceTreeItem(node.source);
    }
    return moldTreeItem(node.mold);
  }

  async getChildren(node?: RegistryNode): Promise<RegistryNode[]> {
    if (!node) {
      const sources = await listSources();
      return sources.map((source) => ({ kind: "source" as const, source }));
    }
    if (node.kind === "source") {
      const molds = await listMoldsForSource(node.source.name);
      return molds.map((mold) => ({ kind: "mold" as const, mold, sourceName: node.source.name }));
    }
    return [];
  }
}

function sourceTreeItem(source: RegistrySource): vscode.TreeItem {
  const item = new vscode.TreeItem(source.name, vscode.TreeItemCollapsibleState.Collapsed);
  const parts = [`[${source.kind}]`];
  if (source.priority != null) {
    parts.push(`P${source.priority}`);
  }
  item.description = parts.join(" ");
  item.tooltip = source.location;
  item.contextValue = "registrySource";
  item.iconPath = new vscode.ThemeIcon("database");
  return item;
}

function moldTreeItem(mold: RegistryMold): vscode.TreeItem {
  const item = new vscode.TreeItem(mold.name, vscode.TreeItemCollapsibleState.None);
  item.description = mold.description;
  item.tooltip = mold.description;
  item.contextValue = "registryMold";
  item.iconPath = new vscode.ThemeIcon("symbol-function");
  item.command = {
    command: "fimod.moldShowDetail",
    title: "Show Mold Detail",
    arguments: [{ name: mold.name, registry: mold.registry }],
  };
  return item;
}

// --- Factory ---

export function createRegistryTree(ctx: vscode.ExtensionContext): RegistryTreeProvider {
  const provider = new RegistryTreeProvider();
  ctx.subscriptions.push(vscode.window.registerTreeDataProvider("fimod.registryExplorer", provider));
  return provider;
}
