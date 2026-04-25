# CLAUDE.md

## Project

VS Code extension for [fimod](https://github.com/pytgaen/fimod), a Rust CLI that transforms structured data files using embedded Python "mold" scripts.

Phase notes live in `notes/` (e.g. `notes/phase3.md`). The fimod CLI reference is in the upstream [fimod repo](https://github.com/pytgaen/fimod).

## Stack

- **Language**: TypeScript
- **Package manager**: npm (via mise for Node.js install)
- **Bundler**: esbuild
- **Target runtime**: VS Code's embedded Node.js (do NOT use Bun/Deno-specific APIs)
- **VS Code API**: TreeDataProvider, WebviewPanel, CodeLensProvider, CompletionItemProvider, TestController

## Build & Dev Commands

```bash
npm install                  # Install dependencies
npm run compile              # Build with esbuild
npm run watch                # Watch mode
npm run lint                 # ESLint
npm run package              # Build .vsix for distribution
```

To test the extension: press F5 in VS Code (launches Extension Development Host).

## Architecture

The extension wraps the `fimod` CLI binary — no Rust logic is duplicated in TypeScript.

All fimod interactions go through `child_process.execFile("fimod", [...args])`:

- **stdout** = transformed data (JSON, YAML, etc.) — this is the result
- **stderr** = debug info, messages (msg\_\*), errors — show in Output Channel or diagnostics
- **Exit code**: 0 = success, 1 = error/fail, 2 = CLI error

Key principle: the extension is a UI layer over the CLI. If fimod can't do it, the extension can't do it.

## Code Style

- No classes for simple modules — prefer functions + interfaces
- Prefix all VS Code commands with `fimod.`
- Prefix all settings with `fimod.`
- Keep webview HTML/CSS minimal — no heavy frameworks (no React, no Svelte)
- Error handling: always capture stderr separately, show user-friendly messages via `vscode.window.showErrorMessage`, detail in Output Channel

## Design Philosophy

Same as fimod: reason from the end-user perspective first. Before implementing a UI element, imagine the user clicking it for the first time. Does it make sense? Is it clean?

## Testing

Use the VS Code extension testing framework (`@vscode/test-electron` or `@vscode/test-cli`).
Unit test the fimod CLI wrapper functions independently (mock child_process).

## Language

Code, comments, and commit messages in English.
