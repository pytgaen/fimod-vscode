import * as vscode from "vscode";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as https from "node:https";
import * as crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getOutputChannel } from "./fimod.js";
import { getBinaryName, httpGet } from "./util.js";

const REPO = "pytgaen/fimod";
const RELEASES_BASE = `https://github.com/${REPO}/releases`;

interface Target {
  triple: string;
  ext: "tar.gz" | "zip";
  binName: string;
}

export function detectTarget(): Target | null {
  const platform = process.platform;
  const arch = process.arch;
  const binName = getBinaryName();

  if (platform === "linux" && arch === "x64") {
    return { triple: "x86_64-unknown-linux-musl", ext: "tar.gz", binName };
  }
  if (platform === "linux" && arch === "arm64") {
    return { triple: "aarch64-unknown-linux-musl", ext: "tar.gz", binName };
  }
  if (platform === "darwin" && arch === "arm64") {
    return { triple: "aarch64-apple-darwin", ext: "tar.gz", binName };
  }
  if (platform === "win32" && arch === "x64") {
    return { triple: "x86_64-pc-windows-msvc", ext: "zip", binName };
  }
  return null;
}

export function getManagedBinaryPath(ctx: vscode.ExtensionContext): string {
  return path.join(ctx.globalStorageUri.fsPath, "bin", getBinaryName());
}

export function managedBinaryExists(ctx: vscode.ExtensionContext): boolean {
  try {
    fs.accessSync(getManagedBinaryPath(ctx), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function downloadToFile(
  url: string,
  dest: string,
  progress?: vscode.Progress<{ message?: string; increment?: number }>,
  redirects = 5,
): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "fimod-vscode" } }, (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirects > 0) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          downloadToFile(next, dest, progress, redirects - 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status} for ${url}`));
          return;
        }
        const total = Number(res.headers["content-length"] ?? 0);
        let received = 0;
        let lastPct = 0;
        const file = fs.createWriteStream(dest);
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (progress && total > 0) {
            const pct = Math.floor((received / total) * 100);
            if (pct > lastPct) {
              progress.report({ message: `${pct}%`, increment: pct - lastPct });
              lastPct = pct;
            }
          }
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

export async function resolveLatestVersion(): Promise<string> {
  // Try the redirect-based VERSION file (no rate limit, mirrors install.sh)
  const r = await httpGet(`${RELEASES_BASE}/latest/download/VERSION`);
  if (r.status === 200) {
    const v = r.body.toString("utf-8").trim();
    if (v) {
      return v;
    }
  }
  throw new Error(`Could not resolve latest fimod version (HTTP ${r.status})`);
}

async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(file)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return hash.digest("hex");
}

async function extractTarGz(archive: string, destDir: string, binName: string): Promise<void> {
  const tar = await import("tar");
  await tar.x({ file: archive, cwd: destDir });
  const extracted = path.join(destDir, binName);
  if (!fs.existsSync(extracted)) {
    throw new Error(`Binary "${binName}" not found in archive`);
  }
}

async function extractZip(archive: string, destDir: string, binName: string): Promise<void> {
  const { default: yauzl } = await import("yauzl");
  return new Promise((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(err ?? new Error("Failed to open zip"));
        return;
      }
      let found = false;
      zip.on("entry", (entry) => {
        if (path.basename(entry.fileName) === binName) {
          found = true;
          zip.openReadStream(entry, (err2, stream) => {
            if (err2 || !stream) {
              reject(err2 ?? new Error("Failed to read zip entry"));
              return;
            }
            const out = fs.createWriteStream(path.join(destDir, binName));
            stream.pipe(out);
            out.on("finish", () => {
              out.close(() => {
                zip.close();
                resolve();
              });
            });
            out.on("error", reject);
          });
        } else {
          zip.readEntry();
        }
      });
      zip.on("end", () => {
        if (!found) {
          reject(new Error(`Binary "${binName}" not found in zip`));
        }
      });
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

export async function downloadBinary(ctx: vscode.ExtensionContext, version?: string): Promise<string> {
  const target = detectTarget();
  if (!target) {
    throw new Error(
      `Unsupported platform ${process.platform}/${process.arch}. ` +
        `Set "fimod.binaryPath" in settings to a manually-installed binary.`,
    );
  }

  const out = getOutputChannel();

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Fimod: downloading binary", cancellable: false },
    async (progress) => {
      progress.report({ message: "resolving version..." });
      const v = version ?? (await resolveLatestVersion());
      out.appendLine(`[binary] target=${target.triple} version=${v}`);

      const asset = `fimod-${v}-${target.triple}.${target.ext}`;
      const url = `${RELEASES_BASE}/download/${v}/${asset}`;
      const sumsName = `fimod-${v}-sha256sums.txt`;
      const sumsUrl = `${RELEASES_BASE}/download/${v}/${sumsName}`;

      const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "fimod-dl-"));
      try {
        const archivePath = path.join(tmpDir, asset);

        progress.report({ message: `downloading ${asset}` });
        await downloadToFile(url, archivePath, progress);

        // SHA256 verification (warn-only if sums file missing, like install.sh)
        try {
          const sumsRes = await httpGet(sumsUrl);
          if (sumsRes.status === 200) {
            const line = sumsRes.body
              .toString("utf-8")
              .split("\n")
              .find((l) => l.includes(asset));
            if (line) {
              const expected = line.trim().split(/\s+/)[0];
              const actual = await sha256File(archivePath);
              if (actual !== expected) {
                throw new Error(`SHA256 mismatch (expected ${expected}, got ${actual})`);
              }
              out.appendLine(`[binary] sha256 verified`);
            } else {
              out.appendLine(`[binary] warning: asset not in sums file, skipping verification`);
            }
          } else {
            out.appendLine(`[binary] warning: sums file unavailable (HTTP ${sumsRes.status})`);
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("SHA256 mismatch")) {
            throw e;
          }
          out.appendLine(`[binary] warning: sha256 check skipped (${e})`);
        }

        progress.report({ message: "extracting..." });
        if (target.ext === "tar.gz") {
          await extractTarGz(archivePath, tmpDir, target.binName);
        } else {
          await extractZip(archivePath, tmpDir, target.binName);
        }

        const finalDir = path.join(ctx.globalStorageUri.fsPath, "bin");
        await fsp.mkdir(finalDir, { recursive: true });
        const finalPath = path.join(finalDir, target.binName);
        await fsp.rename(path.join(tmpDir, target.binName), finalPath);
        if (process.platform !== "win32") {
          await fsp.chmod(finalPath, 0o755);
        }

        out.appendLine(`[binary] installed to ${finalPath}`);
        void promptRegistrySetup();
        return finalPath;
      } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );
}

async function promptRegistrySetup(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    "Fimod binary installed. Set up the example mold registry now?",
    "Setup",
    "Skip",
  );
  if (choice === "Setup") {
    await vscode.commands.executeCommand("fimod.registrySetup");
  }
}

const execFileP = promisify(execFile);

async function isOnPath(): Promise<boolean> {
  try {
    await execFileP("fimod", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures a fimod binary is available. Returns true if available (configured,
 * managed, or on PATH), false if the user declined or the platform is unsupported.
 */
export async function ensureBinary(ctx: vscode.ExtensionContext): Promise<boolean> {
  const configured = vscode.workspace.getConfiguration("fimod").get<string>("binaryPath");
  if (configured) {
    return true;
  }
  if (managedBinaryExists(ctx)) {
    return true;
  }
  if (await isOnPath()) {
    return true;
  }

  const target = detectTarget();
  const items: vscode.MessageItem[] = target
    ? [{ title: "Download" }, { title: "Configure path" }, { title: "Cancel", isCloseAffordance: true }]
    : [{ title: "Configure path" }, { title: "Cancel", isCloseAffordance: true }];

  const msg = target
    ? "Fimod binary not found. Download the latest release from GitHub?"
    : `Fimod binary not found. No pre-built binary for ${process.platform}/${process.arch} — please install manually and set "fimod.binaryPath".`;

  const choice = await vscode.window.showInformationMessage(msg, { modal: false }, ...items);
  if (!choice || choice.title === "Cancel") {
    return false;
  }
  if (choice.title === "Configure path") {
    await vscode.commands.executeCommand("workbench.action.openSettings", "fimod.binaryPath");
    return false;
  }

  try {
    await downloadBinary(ctx);
    return true;
  } catch (e) {
    void vscode.window.showErrorMessage(`Fimod download failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
