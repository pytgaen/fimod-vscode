#!/usr/bin/env node
// Generate/prepend CHANGELOG.md from conventional commits since last release tag.
// Emulates git-cliff's split_commits=true: bullets in squash commit bodies are
// treated as independent conventional commits.
//
// Usage: node scripts/changelog.mjs X.Y.Z[-rc.N]

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
  console.error("Usage: node scripts/changelog.mjs X.Y.Z[-rc.N]");
  process.exit(1);
}

const SECTIONS = [
  ["feat", "Features"],
  ["fix", "Bug Fixes"],
  ["perf", "Performance"],
  ["refactor", "Refactoring"],
  ["docs", "Documentation"],
];
const HIDDEN_TYPES = new Set(["chore", "ci", "test", "style", "build"]);
const RELEASE_RE = /^chore\((?:release|prerelease)\):/;
const BULLET_RE = /^[-*]\s+((?:feat|fix|perf|docs|refactor|chore|ci|test|style|build)(?:\([\w\-./]+\))?!?:\s+.+)$/;
const HEADER_RE = /^(\w+)(?:\(([\w\-./]+)\))?(!)?:\s*(.+)$/;

let lastTag = "";
try {
  lastTag = execFileSync(
    "git",
    ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "--exclude", "*-rc.*", "--exclude", "*-beta.*"],
    { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" },
  ).trim();
} catch {
  lastTag = "";
}

const range = lastTag ? `${lastTag}..HEAD` : "HEAD";

const CSEP = "@@FIMOD-C@@";
const FSEP = "@@FIMOD-F@@";
const raw = execFileSync("git", ["log", range, `--format=${CSEP}%H${FSEP}%s${FSEP}%b`], { encoding: "utf8" });

const commits = raw
  .split(CSEP)
  .filter(Boolean)
  .map((chunk) => {
    const [hash, subject, body] = chunk.split(FSEP);
    return {
      hash: (hash ?? "").trim(),
      subject: (subject ?? "").trim(),
      body: (body ?? "").trim(),
    };
  });

const entries = [];
const breakingNotes = [];

for (const c of commits) {
  if (RELEASE_RE.test(c.subject)) continue;

  const bulletHeaders = c.body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .map((l) => l.match(BULLET_RE)?.[1])
    .filter(Boolean);

  const headers = bulletHeaders.length > 0 ? bulletHeaders : [c.subject];

  for (const h of headers) {
    const m = h.match(HEADER_RE);
    if (!m) continue;
    const [, type, scope, bang, subject] = m;
    if (HIDDEN_TYPES.has(type) && !bang) continue;
    entries.push({ type, scope: scope ?? "", subject, breaking: !!bang });
    if (bang) {
      breakingNotes.push({ scope: scope ?? "", subject });
    }
  }

  const bc = c.body.match(/^BREAKING[ -]CHANGE:\s*(.+)$/im);
  if (bc) breakingNotes.push({ scope: "", subject: bc[1].trim() });
}

if (entries.length === 0) {
  console.error(`No release-worthy commits since ${lastTag || "initial commit"}.`);
  process.exit(1);
}

const grouped = new Map(SECTIONS.map(([t]) => [t, []]));
for (const e of entries) {
  grouped.get(e.type)?.push(e);
}

const date = new Date().toISOString().slice(0, 10);
const lines = [];
lines.push(`## [${version}] — ${date}`);
lines.push("");

if (breakingNotes.length > 0) {
  lines.push("### ⚠ BREAKING CHANGES");
  lines.push("");
  for (const e of breakingNotes) {
    const scope = e.scope ? `**${e.scope}:** ` : "";
    lines.push(`- ${scope}${e.subject}`);
  }
  lines.push("");
}

for (const [type, label] of SECTIONS) {
  const arr = grouped.get(type) ?? [];
  if (arr.length === 0) continue;
  lines.push(`### ${label}`);
  lines.push("");
  for (const e of arr) {
    const scope = e.scope ? `**${e.scope}:** ` : "";
    lines.push(`- ${scope}${e.subject}`);
  }
  lines.push("");
}

const newSection = lines.join("\n") + "\n";

const CHANGELOG_PATH = "CHANGELOG.md";
const HEADER = `# Changelog

All notable changes to the Fimod VS Code extension are documented here.

The format is based on [Conventional Commits](https://www.conventionalcommits.org/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;

let existing = "";
if (existsSync(CHANGELOG_PATH)) {
  const content = readFileSync(CHANGELOG_PATH, "utf8");
  const idx = content.indexOf("## ");
  existing = idx >= 0 ? content.slice(idx) : "";
}

writeFileSync(CHANGELOG_PATH, HEADER + newSection + existing);
console.log(`CHANGELOG.md prepended with [${version}] — ${date} (${entries.length} entries)`);
