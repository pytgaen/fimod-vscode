import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile, type ExecFileException } from "node:child_process";
import { createTTLCache, getBinaryName, safeJsonParse } from "./util.js";

let extensionContext: vscode.ExtensionContext | undefined;

export function setExtensionContext(ctx: vscode.ExtensionContext): void {
  extensionContext = ctx;
}

export interface FimodMessage {
  level: "info" | "warn" | "error" | "fail" | "print";
  text: string;
}

export interface FimodResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  messages: FimodMessage[];
}

let outputChannel: vscode.OutputChannel | undefined;

export function initOutputChannel(ctx: vscode.ExtensionContext): vscode.OutputChannel {
  outputChannel = vscode.window.createOutputChannel("Fimod");
  ctx.subscriptions.push(outputChannel);
  return outputChannel;
}

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Fimod");
  }
  return outputChannel;
}

function getBinaryPath(): string {
  const configured = vscode.workspace.getConfiguration("fimod").get<string>("binaryPath");
  if (configured) {
    return configured;
  }
  if (extensionContext) {
    const managed = path.join(extensionContext.globalStorageUri.fsPath, "bin", getBinaryName());
    if (fs.existsSync(managed)) {
      return managed;
    }
  }
  return "fimod";
}

const MSG_RE = /^\[(info|warn|error|FAIL)]\s*(.*)$/;

export function parseStderr(stderr: string): FimodMessage[] {
  if (!stderr.trim()) {
    return [];
  }
  return stderr
    .trim()
    .split("\n")
    .map((line) => {
      const m = line.match(MSG_RE);
      if (m) {
        return { level: m[1].toLowerCase() as FimodMessage["level"], text: m[2] };
      }
      return { level: "print" as const, text: line };
    });
}

function execFimod(args: string[], stdin?: string): Promise<FimodResult> {
  const bin = getBinaryPath();
  const ch = getOutputChannel();
  ch.appendLine(`> ${bin} ${args.join(" ")}`);
  if (stdin !== undefined) {
    ch.appendLine(`  stdin: ${stdin.length} chars`);
  }
  return new Promise((resolve) => {
    const proc = execFile(bin, args, { maxBuffer: 24 * 1024 * 1024 }, (error, stdout, stderr) => {
      const exitCode = error
        ? typeof (error as ExecFileException).code === "number"
          ? ((error as ExecFileException).code as number)
          : 1
        : 0;
      ch.appendLine(`  exit: ${exitCode} | stdout: ${stdout?.length ?? 0} chars`);
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode,
        messages: parseStderr(stderr ?? ""),
      });
    });
    if (stdin !== undefined && proc.stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }
  });
}

export async function runFimod(args: string[], stdin?: string): Promise<FimodResult> {
  return await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Fimod" }, () =>
    execFimod(args, stdin),
  );
}

/** Run without progress indicator (for internal/background calls like --version, mold list). */
export function runFimodQuiet(args: string[], stdin?: string): Promise<FimodResult> {
  return execFimod(args, stdin);
}

export async function getVersion(): Promise<string | null> {
  const result = await runFimodQuiet(["--version"]);
  if (result.exitCode !== 0) {
    return null;
  }
  // Output: "fimod X.Y.Z standard (Monty engine: vA.B.C)"
  return result.stdout.trim();
}

export function logStderr(result: FimodResult): void {
  const ch = getOutputChannel();
  for (const msg of result.messages) {
    const prefix = msg.level === "print" ? "" : `[${msg.level}] `;
    ch.appendLine(`${prefix}${msg.text}`);
  }
}

export function extractErrorSummary(result: FimodResult): string {
  const tagged = result.messages.filter((m) => m.level === "error" || m.level === "fail").map((m) => m.text);
  if (tagged.length > 0) return tagged.join(" / ");
  const firstLine = result.stderr.split("\n").find((l) => l.trim());
  if (firstLine) return firstLine.trim();
  return `exit ${result.exitCode}`;
}

export function showError(message: string, result?: FimodResult): void {
  if (result) {
    logStderr(result);
  }
  void vscode.window.showErrorMessage(message, "Show Output").then((choice) => {
    if (choice === "Show Output") {
      getOutputChannel().show();
    }
  });
}

export function handleFimodError(result: FimodResult, contextMessage: string): boolean {
  logStderr(result);
  if (result.exitCode !== 0) {
    showError(`${contextMessage} (exit ${result.exitCode}).`, result);
    return true;
  }
  return false;
}

// --- Mold listing with TTL cache ---

export interface MoldItem {
  name: string;
  source?: string;
  description?: string;
}

const moldCache = createTTLCache<MoldItem[]>(30_000);

export function invalidateMoldCache(): void {
  moldCache.invalidate();
}

export async function listMolds(): Promise<MoldItem[]> {
  const cached = moldCache.get();
  if (cached) {
    return cached;
  }

  const result = await runFimodQuiet(["mold", "list", "--output-format", "json"]);
  if (result.exitCode !== 0) {
    return [];
  }

  const parsed = safeJsonParse<unknown>(result.stdout, []);
  const items: MoldItem[] = Array.isArray(parsed)
    ? parsed.map((m: any) => ({
        name: typeof m === "string" ? m : (m.name ?? ""),
        source: m.source,
        description: m.description ?? m.doc ?? "",
      }))
    : [];

  moldCache.set(items);
  return items;
}
