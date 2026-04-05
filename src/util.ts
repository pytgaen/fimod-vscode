import * as http from "node:http";
import * as https from "node:https";

export function getBinaryName(): string {
  return process.platform === "win32" ? "fimod.exe" : "fimod";
}

export interface TTLCache<T> {
  get(key?: string): T | undefined;
  set(data: T, key?: string): void;
  invalidate(): void;
}

export function createTTLCache<T>(ttlMs: number): TTLCache<T> {
  const entries = new Map<string, { data: T; timestamp: number }>();
  return {
    get(key = "") {
      const e = entries.get(key);
      return e && Date.now() - e.timestamp < ttlMs ? e.data : undefined;
    },
    set(data, key = "") {
      entries.set(key, { data, timestamp: Date.now() });
    },
    invalidate() {
      entries.clear();
    },
  };
}

export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface HttpResponse {
  status: number;
  body: Buffer;
  headers: http.IncomingHttpHeaders;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function httpGet(url: string, redirects = 5): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod
      .get(url, { headers: { "User-Agent": "fimod-vscode" } }, (res) => {
        const status = res.statusCode ?? 0;
        if (REDIRECT_STATUSES.has(status) && res.headers.location && redirects > 0) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          httpGet(next, redirects - 1).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status, body: Buffer.concat(chunks), headers: res.headers }));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}
