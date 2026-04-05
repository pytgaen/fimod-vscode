import * as vscode from "vscode";
import { listMolds, MoldItem } from "./fimod.js";
import type { LocalMoldNode } from "./localMoldsTree.js";

function moldsToQuickPickItems(molds: MoldItem[]): vscode.QuickPickItem[] {
  return molds.map((m) => ({
    label: `@${m.name}`,
    description: m.description ?? "",
  }));
}

interface LocalQuickPickItem extends vscode.QuickPickItem {
  localMoldPath?: string;
}

export interface PickResult {
  choice:
    | { type: "mold"; name: string }
    | { type: "localMold"; name: string; path: string }
    | { type: "expression"; expr: string };
  preview: boolean;
  chooseFormats: boolean;
}

const HISTORY_KEY = "fimod.shapeHistory";

interface HistoryEntry {
  label: string;
  type: "mold" | "localMold" | "expression";
}

const history: HistoryEntry[] = [];

function maxHistory(): number {
  return vscode.workspace.getConfiguration("fimod.shape").get<number>("historySize", 3);
}
let state: vscode.Memento | undefined;

export function initHistory(globalState: vscode.Memento): void {
  state = globalState;
  const saved = globalState.get<(HistoryEntry | string)[]>(HISTORY_KEY, []);
  for (const entry of saved.slice(0, maxHistory())) {
    if (typeof entry === "string") {
      // migrate old string-only entries
      history.push({ label: entry, type: entry.startsWith("@") ? "mold" : "expression" });
    } else {
      history.push(entry);
    }
  }
}

function pushHistory(entry: HistoryEntry): void {
  const idx = history.findIndex((h) => h.label === entry.label && h.type === entry.type);
  if (idx !== -1) {
    history.splice(idx, 1);
  }
  history.unshift(entry);
  const max = maxHistory();
  if (history.length > max) {
    history.length = max;
  }
  state?.update(HISTORY_KEY, [...history]);
}

function historyDescription(type: HistoryEntry["type"]): string {
  switch (type) {
    case "mold":
      return "mold";
    case "localMold":
      return "workspace mold";
    case "expression":
      return "inline expression (-e)";
  }
}

function historyItems(localMolds?: LocalMoldNode[]): vscode.QuickPickItem[] {
  if (history.length === 0) {
    return [];
  }
  const localByPath = new Map(localMolds?.map((m) => [m.relativePath, m.uri.fsPath]) ?? []);
  const items: vscode.QuickPickItem[] = [];
  for (const h of history) {
    if (h.type === "localMold" && !localByPath.has(h.label)) {
      continue;
    }
    const item: LocalQuickPickItem = {
      label: h.label,
      description: historyDescription(h.type),
      localMoldPath: h.type === "localMold" ? localByPath.get(h.label) : undefined,
    };
    items.push(item);
  }
  if (items.length === 0) {
    return [];
  }
  return [
    { label: "recent", kind: vscode.QuickPickItemKind.Separator },
    ...items,
    { label: "", kind: vscode.QuickPickItemKind.Separator },
  ];
}

const PREVIEW_ON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon("eye"),
  tooltip: "Preview diff before applying (on)",
};
const PREVIEW_OFF: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon("eye-closed"),
  tooltip: "Preview diff before applying (off)",
};
const FORMATS_ON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon("notebook-open-as-text"),
  tooltip: "Choose input/output formats (on)",
};
const FORMATS_OFF: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon("symbol-file"),
  tooltip: "Choose input/output formats (off — auto-detect)",
};

export async function pickMoldOrExpression(localMolds?: LocalMoldNode[]): Promise<PickResult | undefined> {
  const config = vscode.workspace.getConfiguration("fimod.shape");
  let previewEnabled = config.get<boolean>("preview", true);
  let chooseFormatsEnabled = config.get<string>("formatDetection", "auto") === "manual";

  function getButtons(): vscode.QuickInputButton[] {
    return [previewEnabled ? PREVIEW_ON : PREVIEW_OFF, chooseFormatsEnabled ? FORMATS_ON : FORMATS_OFF];
  }

  function getTitle(): string {
    const parts: string[] = [];
    parts.push(previewEnabled ? "preview: on" : "preview: off");
    parts.push(chooseFormatsEnabled ? "formats: custom" : "formats: auto");
    return parts.join("  ·  ");
  }

  const molds = await listMolds();
  const moldItems = moldsToQuickPickItems(molds);

  const localItems: LocalQuickPickItem[] =
    localMolds && localMolds.length > 0
      ? [
          { label: "workspace", kind: vscode.QuickPickItemKind.Separator },
          ...localMolds.map((m) => ({
            label: m.relativePath,
            description: m.description || undefined,
            localMoldPath: m.uri.fsPath,
          })),
          { label: "", kind: vscode.QuickPickItemKind.Separator },
        ]
      : [];

  return new Promise((resolve) => {
    let resolved = false;
    const qp = vscode.window.createQuickPick();
    qp.placeholder = "Type a Python expression or select a @mold";
    qp.matchOnDescription = true;
    const defaultItems = [...historyItems(localMolds), ...localItems, ...moldItems];
    qp.items = defaultItems;
    qp.buttons = getButtons();
    qp.title = getTitle();

    qp.onDidTriggerButton((button) => {
      if (button === PREVIEW_ON || button === PREVIEW_OFF) {
        previewEnabled = !previewEnabled;
      } else if (button === FORMATS_ON || button === FORMATS_OFF) {
        chooseFormatsEnabled = !chooseFormatsEnabled;
      }
      qp.buttons = getButtons();
      qp.title = getTitle();
    });

    qp.onDidChangeValue((value) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed.startsWith("@")) {
        qp.items = defaultItems;
      } else {
        const exprItem: vscode.QuickPickItem = {
          label: trimmed,
          description: "inline expression (-e)",
          alwaysShow: true,
        };
        qp.items = [exprItem, ...localItems, ...moldItems];
        qp.activeItems = [exprItem];
      }
    });

    qp.onDidAccept(() => {
      const selected = qp.activeItems[0];
      const value = qp.value.trim();

      let choice: PickResult["choice"] | undefined;

      const localPath = (selected as LocalQuickPickItem | undefined)?.localMoldPath;
      if (selected && localPath) {
        choice = { type: "localMold", name: selected.label, path: localPath };
      } else if (selected && selected.label.startsWith("@")) {
        choice = { type: "mold", name: selected.label };
      } else if (value && !value.startsWith("@")) {
        choice = { type: "expression", expr: value };
      } else if (value.startsWith("@")) {
        choice = { type: "mold", name: value };
      }

      if (choice) {
        const historyLabel = choice.type === "expression" ? choice.expr : choice.name;
        pushHistory({ label: historyLabel, type: choice.type });
        resolved = true;
        qp.dispose();
        resolve({ choice, preview: previewEnabled, chooseFormats: chooseFormatsEnabled });
      }
    });

    qp.onDidHide(() => {
      qp.dispose();
      if (!resolved) {
        resolve(undefined);
      }
    });

    qp.show();
  });
}
