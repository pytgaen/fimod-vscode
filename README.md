<p align="center">
  <img src="https://raw.githubusercontent.com/pytgaen/fimod-vscode/main/assets/logo-image.jpg" alt="Fimod" width="600">
</p>

# Fimod for VS Code

> ⚠️ **Beta / unreleased** — this extension is in active development and not yet published on the Marketplace. APIs, commands and settings may change without notice. Feedback and issues welcome at [pytgaen/fimod-vscode](https://github.com/pytgaen/fimod-vscode/issues).

Transform structured data files (JSON, YAML, TOML, CSV) using Python mold scripts — right from your editor.

This extension wraps the [fimod](https://github.com/pytgaen/fimod) CLI, giving you a visual workflow for shaping data without leaving VS Code.

## Features

### Shape command

One command to transform any data file: select a mold or type a Python expression, preview the diff, apply.

- **From the editor**: select text (or use the whole file) → `Ctrl+Shift+M` → pick a mold or type an expression → review diff → apply
- **From the explorer**: right-click a file → Fimod → Shape
- **Inline expressions**: type any Python expression directly (e.g. `[x for x in data if x["active"]]`)
- **Molds**: reusable Python scripts from your registries (`@mold-name`)

### Quick pick toggles

The Shape quick pick includes toggle buttons to control behavior on the fly:

- **Preview** (`eye` / `eye-closed`): show a diff before applying
- **Format** (`symbol-file` / `notebook-open-as-text`): auto-detect or manually choose input/output formats

The title bar displays the current state: `preview: on · formats: auto`.

### Recent history

Your last mold/expression choices appear at the top of the quick pick for quick reuse. History persists across VS Code sessions.

### Registry Explorer

Browse all configured mold registries from the activity bar sidebar.

- View sources (local, GitHub, remote) and their molds
- Add or remove sources
- Set default source and reorder priorities
- Build catalog for local sources
- One-click setup for the official registry

### Local Molds

See molds from your local registries at a glance.

- Open the mold source file directly
- Run a mold on a file
- Run mold tests
- View mold details

### Mold Detail View

Click any mold in the tree views to open a detail panel:

- Documentation (README fetched from local path or GitHub URL)
- Full source code
- Mini playground — paste any input (JSON, YAML, CSV, text...), pick format, run, see output

### Playground

A dedicated side panel for iterating on molds with live feedback — ideal when authoring or tuning a mold against real input.

- **Input source**: load from a file, paste from clipboard, or type directly in a scratchpad
- **Mold source**: pick a registry mold (`@name`), a local mold file, or type an inline expression
- **Live mode** (on by default): re-runs automatically on edits (debounced) and on save of the watched mold file
- **Toolbar**: override input/output format, pass mold args, toggle live, refresh registry cache
- **Output**: copy to clipboard or save to disk; errors show as a red banner while the last valid output stays visible

Triggers:

- Editor or explorer context menu → Fimod → Open Playground
- Registry Explorer / Local Molds tree → right-click a mold → Open Playground
- Command palette → `Fimod: Open Playground`

Playground is read-only — use **Shape** to apply a transformation back to a file.

### Status bar

Displays `fimod X.Y.Z` in the status bar when the binary is detected, so you always know which version is active.

## Requirements

- [fimod](https://github.com/pytgaen/fimod) CLI installed and available in your `PATH` (or configured via `fimod.binaryPath`)

## Usage

| Action                  | Shortcut                                                          |
| ----------------------- | ----------------------------------------------------------------- |
| Shape (editor)          | `Ctrl+Shift+M` (`Cmd+Shift+M` on macOS)                           |
| Shape (explorer)        | Right-click → Fimod → Shape                                       |
| Shape (command palette) | `Fimod: Shape`                                                    |
| Playground              | `Fimod: Open Playground` or right-click → Fimod → Open Playground |

## Extension Settings

| Setting                       | Default                                      | Description                                                                                                                                               |
| ----------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fimod.binaryPath`            | `""`                                         | Path to the fimod binary. If empty, searches `PATH`.                                                                                                      |
| `fimod.shape.preview`         | `true`                                       | Show diff preview before applying transformations.                                                                                                        |
| `fimod.shape.formatDetection` | `"auto"`                                     | Format detection mode: `auto` or `manual`.                                                                                                                |
| `fimod.shape.historySize`     | `3`                                          | Number of recent choices shown at the top of the quick pick (0–10).                                                                                       |
| `fimod.registry.autoRefresh`  | `true`                                       | Automatically refresh registry tree on activation.                                                                                                        |
| `fimod.mold.scanPaths`        | `[]`                                         | Additional directories to scan for local molds.                                                                                                           |
| `fimod.mold.testsDirPattern`  | `${workspaceFolder}/tests-molds/${moldName}` | Pattern for the directory used by `fimod mold test`. Placeholders: `${workspaceFolder}`, `${moldDir}`, `${moldName}`. Per-mold overrides take precedence. |

## Supported formats

JSON, YAML, TOML, CSV, NDJSON, plain text — anything fimod supports. Format is auto-detected from the file extension or content.

## License

Apache-2.0
