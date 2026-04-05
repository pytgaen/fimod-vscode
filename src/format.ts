import * as vscode from "vscode";

const LANG_FORMAT_MAP: Record<string, string> = {
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  toml: "toml",
  csv: "csv",
  plaintext: "txt",
};

export function detectFormat(text: string, languageId: string): string | undefined {
  if (LANG_FORMAT_MAP[languageId]) {
    return LANG_FORMAT_MAP[languageId];
  }

  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }
  if (trimmed.startsWith("---")) {
    return "yaml";
  }
  if (/^\[[\w.-]+\]/m.test(trimmed)) {
    return "toml";
  }
  return undefined;
}

export const FORMATS = ["json", "json-compact", "ndjson", "yaml", "toml", "csv", "txt", "lines", "raw"];

const QUICK_CONVERSIONS: Record<string, string[]> = {
  csv: ["json", "lines"],
  json: ["yaml"],
  yaml: ["json"],
  toml: ["json"],
};

export async function pickOutputFormatOrCustom(
  detected?: string,
): Promise<{ inputFormat?: string; outputFormat: string } | undefined> {
  const items: vscode.QuickPickItem[] = [];

  if (detected) {
    items.push({ label: detected, description: "(same format)" });
    const shortcuts = QUICK_CONVERSIONS[detected];
    if (shortcuts) {
      for (const f of shortcuts) {
        items.push({ label: `${detected} → ${f}` });
      }
    }
  }

  items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
  items.push({ label: "Custom...", description: "choose input & output separately" });

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: detected ? `Output format (input: ${detected})` : "Output format",
  });
  if (!pick) {
    return undefined;
  }

  if (pick.label === "Custom...") {
    const inItems = FORMATS.map((f) => ({
      label: f,
      description: f === detected ? "(detected)" : "",
    }));
    const inPick = await vscode.window.showQuickPick(inItems, { placeHolder: "Input format" });
    if (!inPick) {
      return undefined;
    }
    const outItems = FORMATS.map((f) => ({ label: f }));
    const outPick = await vscode.window.showQuickPick(outItems, { placeHolder: "Output format" });
    if (!outPick) {
      return undefined;
    }
    return { inputFormat: inPick.label, outputFormat: outPick.label };
  }

  const arrow = pick.label.indexOf(" → ");
  if (arrow >= 0) {
    return { outputFormat: pick.label.slice(arrow + 3) };
  }
  return { outputFormat: pick.label };
}
