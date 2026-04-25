import * as assert from "assert";
import * as vscode from "vscode";
import { isMoldContent, extractDocstring, LocalMoldsTreeProvider } from "../../localMoldsTree.js";

suite("isMoldContent", () => {
  test("detects def transform(", () => {
    assert.ok(isMoldContent("def transform(data, **_):\n    return data"));
  });

  test("detects # fimod: directive", () => {
    assert.ok(isMoldContent("# fimod: input-format=json\ndef foo(): pass"));
  });

  test("returns false for plain python", () => {
    assert.ok(!isMoldContent("def foo():\n    return 42"));
  });

  test("returns false for empty string", () => {
    assert.ok(!isMoldContent(""));
  });
});

suite("extractDocstring", () => {
  test("extracts triple-double-quoted docstring", () => {
    const doc = extractDocstring('"""First line.\nSecond line."""\n\ndef transform(): pass');
    assert.strictEqual(doc, "First line.");
  });

  test("extracts triple-single-quoted docstring", () => {
    const doc = extractDocstring("'''My mold.'''\ndef transform(): pass");
    assert.strictEqual(doc, "My mold.");
  });

  test("returns undefined when no docstring", () => {
    assert.strictEqual(extractDocstring("def transform(): pass"), undefined);
  });

  test("returns undefined for empty string", () => {
    assert.strictEqual(extractDocstring(""), undefined);
  });

  test("skips leading comments", () => {
    const doc = extractDocstring('# comment\n\n"""The mold."""\ndef transform(): pass');
    assert.strictEqual(doc, "The mold.");
  });
});

suite("LocalMoldsTreeProvider", () => {
  let provider: LocalMoldsTreeProvider;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension("pytgaen.fimod-vscode");
    assert.ok(ext, "Extension not found");
    await ext.activate();
    provider = new LocalMoldsTreeProvider();
  });

  test("getChildren() finds upper.py mold in workspace", async () => {
    const nodes = await provider.getChildren();
    assert.ok(Array.isArray(nodes));
    const upper = nodes.find((n) => n.name === "upper");
    assert.ok(upper, 'Expected to find mold named "upper"');
    assert.strictEqual(upper.description, "Uppercase all string values.");
  });

  test("getTreeItem() returns correct contextValue", async () => {
    const nodes = await provider.getChildren();
    assert.ok(nodes.length > 0, "No mold nodes found");
    const item = provider.getTreeItem(nodes[0]);
    assert.strictEqual(item.contextValue, "localMold");
  });

  test("getCachedChildren() returns same array after getChildren()", async () => {
    await provider.getChildren();
    const cached = provider.getCachedChildren();
    assert.ok(cached.length > 0, "Cache should not be empty after getChildren()");
  });

  test("refresh() clears cache", async () => {
    await provider.getChildren();
    provider.refresh();
    assert.deepStrictEqual(provider.getCachedChildren(), []);
  });
});
