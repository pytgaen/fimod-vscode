import { runFimod, runFimodQuiet, handleFimodError } from "./fimod.js";
import { createTTLCache, httpGet, safeJsonParse } from "./util.js";

// --- Interfaces ---

export interface RegistrySource {
  name: string;
  kind: string;
  location: string;
  priority: number;
}

export interface RegistryMold {
  name: string;
  registry: string;
  priority: string;
  description: string;
}

export interface MoldDetail {
  name: string;
  registry?: string;
  description: string;
  sourcePath?: string;
  readmePath?: string;
  args: { name: string; description: string }[];
  inputFormat?: string;
  outputFormat?: string;
}

// --- TTL caches ---

const CACHE_TTL = 30_000;
const sourcesCache = createTTLCache<RegistrySource[]>(CACHE_TTL);
const moldsCache = createTTLCache<RegistryMold[]>(CACHE_TTL);

export function invalidateRegistryCache(): void {
  sourcesCache.invalidate();
  moldsCache.invalidate();
}

// --- Registry sources ---

export async function listSources(): Promise<RegistrySource[]> {
  const cached = sourcesCache.get();
  if (cached) {
    return cached;
  }

  const result = await runFimodQuiet(["registry", "list", "--output-format", "json"]);
  if (result.exitCode !== 0) {
    return [];
  }

  const data = safeJsonParse<RegistrySource[]>(result.stdout, []);
  data.sort((a, b) => a.priority - b.priority);
  sourcesCache.set(data);
  return data;
}

export async function listMoldsForSource(sourceName: string): Promise<RegistryMold[]> {
  const cached = moldsCache.get(sourceName);
  if (cached) {
    return cached;
  }

  const result = await runFimodQuiet(["mold", "list", "--output-format", "json", sourceName]);
  if (result.exitCode !== 0) {
    return [];
  }

  const data = safeJsonParse<RegistryMold[]>(result.stdout, []);
  moldsCache.set(data, sourceName);
  return data;
}

// --- Mold detail (JSON) ---

export async function showMold(name: string): Promise<MoldDetail | undefined> {
  const result = await runFimodQuiet(["mold", "show", name, "--output-format", "json"]);
  if (result.exitCode !== 0) {
    return undefined;
  }

  const raw = safeJsonParse<any>(result.stdout, null);
  if (!raw) {
    return undefined;
  }
  return {
    name: raw.name ?? "",
    registry: raw.registry,
    description: raw.description ?? "",
    sourcePath: raw.source_path ?? undefined,
    readmePath: raw.readme_path ?? undefined,
    inputFormat: raw.input_format ?? undefined,
    outputFormat: raw.output_format ?? undefined,
    args: raw.args ?? [],
  };
}

// --- Registry actions ---

export async function addSource(name: string, pathOrUrl: string): Promise<boolean> {
  const result = await runFimod(["registry", "add", name, pathOrUrl]);
  return !handleFimodError(result, "Failed to add source");
}

export async function removeSource(name: string): Promise<boolean> {
  const result = await runFimod(["registry", "remove", name]);
  return !handleFimodError(result, "Failed to remove source");
}

export async function setPriority(name: string, priority: number): Promise<boolean> {
  const result = await runFimod(["registry", "set-priority", name, String(priority)]);
  return !handleFimodError(result, "Failed to set priority");
}

export async function buildCatalog(path?: string): Promise<boolean> {
  const args = ["registry", "build-catalog"];
  if (path) {
    args.push("--path", path);
  }
  const result = await runFimod(args);
  return !handleFimodError(result, "Failed to build catalog");
}

export async function runSetup(): Promise<boolean> {
  const result = await runFimod(["registry", "setup", "--yes"]);
  return !handleFimodError(result, "Registry setup failed");
}

// --- README fetching ---

export async function fetchReadme(readmePath: string): Promise<string | undefined> {
  if (!readmePath) {
    return undefined;
  }

  // Local file
  if (!readmePath.startsWith("http://") && !readmePath.startsWith("https://")) {
    try {
      const { readFile } = await import("node:fs/promises");
      return await readFile(readmePath, "utf-8");
    } catch {
      return undefined;
    }
  }

  // Remote URL — convert GitHub tree URLs to raw content
  let url = readmePath;
  const ghTreeMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/);
  if (ghTreeMatch) {
    const [, owner, repo, branch, path] = ghTreeMatch;
    url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  }

  try {
    const res = await httpGet(url);
    return res.status === 200 ? res.body.toString("utf-8") : undefined;
  } catch {
    return undefined;
  }
}
