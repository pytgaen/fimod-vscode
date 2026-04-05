import * as vscode from "vscode";

// --- Mold detection patterns ---

const TRANSFORM_RE = /^def\s+transform\s*\(/m;
const DIRECTIVE_RE = /^#\s*fimod:/m;

// Extract module-level docstring (triple-quoted string at top of file, after optional comments/blank lines)
const DOCSTRING_RE = /^(?:\s*#[^\n]*\n|\s*\n)*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/;

export function isMoldContent(text: string): boolean {
  return TRANSFORM_RE.test(text) || DIRECTIVE_RE.test(text);
}

export function extractDocstring(text: string): string | undefined {
  const m = DOCSTRING_RE.exec(text);
  if (!m) return undefined;
  const raw = (m[1] ?? m[2]).trim();
  // Return first line only
  const firstLine = raw.split("\n")[0].trim();
  return firstLine || undefined;
}

// --- Tree node ---

export interface LocalMoldNode {
  name: string;
  uri: vscode.Uri;
  relativePath: string;
  description: string;
}

// --- Tree data provider ---

export class LocalMoldsTreeProvider implements vscode.TreeDataProvider<LocalMoldNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<LocalMoldNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _cache: LocalMoldNode[] | undefined;

  refresh(): void {
    this._cache = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  getCachedChildren(): LocalMoldNode[] {
    return this._cache ?? [];
  }

  getTreeItem(node: LocalMoldNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
    item.description = node.relativePath;
    item.tooltip = node.description || node.relativePath;
    item.contextValue = "localMold";
    item.iconPath = new vscode.ThemeIcon("file-code");
    item.command = {
      command: "fimod.moldShowDetail",
      title: "Open Mold Detail",
      arguments: [{ name: node.name, localPath: node.uri.fsPath }],
    };
    return item;
  }

  async getChildren(): Promise<LocalMoldNode[]> {
    if (this._cache) return this._cache;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return [];

    const exclude = "{**/node_modules/**,**/.venv/**,**/__pycache__/**,**/.git/**}";
    const files = await vscode.workspace.findFiles("**/*.py", exclude, 500);

    const results = await Promise.all(
      files.map(async (uri) => {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = new TextDecoder().decode(bytes);
        if (!isMoldContent(text)) return undefined;

        const rel = vscode.workspace.asRelativePath(uri, false);
        const name = uri.path.split("/").pop()!.replace(/\.py$/, "");
        const description = extractDocstring(text) ?? "";

        return { name, uri, relativePath: rel, description } as LocalMoldNode;
      }),
    );

    const nodes = results.filter((n): n is LocalMoldNode => n !== undefined);
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    this._cache = nodes;
    return nodes;
  }
}

// --- Factory ---

export function createLocalMoldsTree(ctx: vscode.ExtensionContext): LocalMoldsTreeProvider {
  const provider = new LocalMoldsTreeProvider();
  ctx.subscriptions.push(vscode.window.registerTreeDataProvider("fimod.localMolds", provider));

  // Auto-refresh when Python files change in the workspace (debounced)
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.py");
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const debouncedRefresh = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => provider.refresh(), 400);
  };
  watcher.onDidCreate(debouncedRefresh);
  watcher.onDidChange(debouncedRefresh);
  watcher.onDidDelete(debouncedRefresh);
  ctx.subscriptions.push(watcher);

  return provider;
}
