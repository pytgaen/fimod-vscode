import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { runFimod, handleFimodError } from "./fimod.js";
import { detectFormat, pickOutputFormatOrCustom } from "./format.js";
import { pickMoldOrExpression } from "./moldPicker.js";
import type { LocalMoldsTreeProvider } from "./localMoldsTree.js";

const FILE_MODE_THRESHOLD = 20 * 1024 * 1024; // 20 Mo

const previewContents = new Map<string, string>();
export const previewProvider: vscode.TextDocumentContentProvider = {
  provideTextDocumentContent(uri) {
    return previewContents.get(uri.path) ?? "";
  },
};

let localMoldsTreeProvider: LocalMoldsTreeProvider | undefined;

export function setLocalMoldsTree(provider: LocalMoldsTreeProvider): void {
  localMoldsTreeProvider = provider;
}

export async function shape(fileUri?: vscode.Uri): Promise<void> {
  if (fileUri) {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fileUri));
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage("No active editor.");
    return;
  }

  const selection = editor.selection;
  const text = selection.isEmpty ? editor.document.getText() : editor.document.getText(selection);

  if (!text.trim()) {
    vscode.window.showInformationMessage("Nothing to transform (empty selection/document).");
    return;
  }

  const localMolds = localMoldsTreeProvider?.getCachedChildren() ?? [];
  const pick = await pickMoldOrExpression(localMolds);
  if (!pick) {
    return;
  }

  const detected = detectFormat(text, editor.document.languageId);
  let inputFormat = detected;
  let outputFormat = detected;

  if (pick.chooseFormats) {
    const formatChoice = await pickOutputFormatOrCustom(detected);
    if (!formatChoice) {
      return;
    }
    if (formatChoice.inputFormat) {
      inputFormat = formatChoice.inputFormat;
    }
    outputFormat = formatChoice.outputFormat;
  }

  const args = ["shape"];
  if (inputFormat) {
    args.push("--input-format", inputFormat);
  }
  if (outputFormat) {
    args.push("--output-format", outputFormat);
  }
  if (pick.choice.type === "expression") {
    args.push("-e", pick.choice.expr);
  } else if (pick.choice.type === "localMold") {
    args.push("-m", pick.choice.path);
  } else {
    args.push("-m", pick.choice.name);
  }

  let output: string;

  if (Buffer.byteLength(text) > FILE_MODE_THRESHOLD) {
    const tmpDir = os.tmpdir();
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inputPath = path.join(tmpDir, `fimod-in-${stamp}`);
    const outputPath = path.join(tmpDir, `fimod-out-${stamp}`);
    try {
      await fs.writeFile(inputPath, text);
      args.push("-i", inputPath, "-o", outputPath);
      const result = await runFimod(args);
      if (handleFimodError(result, "Fimod transform failed")) {
        return;
      }
      output = await fs.readFile(outputPath, "utf-8");
    } finally {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
    }
  } else {
    const result = await runFimod(args, text);
    if (handleFimodError(result, "Fimod transform failed")) {
      return;
    }
    output = result.stdout;
  }

  if (!text.endsWith("\n") && output.endsWith("\n")) {
    output = output.slice(0, -1);
  }

  if (pick.preview) {
    previewContents.set("/original", text);
    previewContents.set("/transformed", output);
    try {
      const originalUri = vscode.Uri.parse("fimod-preview:/original");
      const transformedUri = vscode.Uri.parse("fimod-preview:/transformed");

      await vscode.commands.executeCommand("vscode.diff", originalUri, transformedUri, "Fimod: Preview Transform");

      const apply = await vscode.window.showInformationMessage("Apply this transform?", { modal: true }, "Apply");

      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

      if (apply !== "Apply") {
        return;
      }
    } finally {
      previewContents.clear();
    }
  }

  const activeEditor = await vscode.window.showTextDocument(editor.document, editor.viewColumn);

  const range = selection.isEmpty
    ? new vscode.Range(
        activeEditor.document.positionAt(0),
        activeEditor.document.positionAt(activeEditor.document.getText().length),
      )
    : selection;

  await activeEditor.edit((editBuilder) => {
    editBuilder.replace(range, output);
  });
}
