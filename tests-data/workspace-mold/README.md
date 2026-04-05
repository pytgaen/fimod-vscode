# Workspace Mold Example

This example shows how to use a **local mold** (a `.py` file in your workspace) directly with the Shape command — no registry setup needed.

## Files

- `upper.py` — A simple mold that uppercases all string values in the data.
- `sample.csv` — Sample input data.

## How to use

1. Open this folder in VS Code (or add it to your workspace).
2. The mold `upper` appears automatically in the **Local Molds** tree view in the Fimod sidebar.
3. Open `sample.csv` in the editor.
4. Run **Fimod: Shape** (`Ctrl+Shift+P` → "Fimod: Shape").
5. In the picker, select `@upper` under the **workspace** section.
6. The CSV is transformed in-place:

```csv
name,city,score
ALICE,PARIS,42
BOB,LYON,87
CHARLIE,MARSEILLE,15
```

## Notes

- Workspace molds are detected by scanning `.py` files for a `def transform(` function or a `# fimod:` directive.
- They appear in a dedicated **workspace** section in the mold picker, separate from registry molds.
- The mold file path is passed directly to `fimod shape -m /path/to/upper.py`, so it works without registering the mold in any source.
