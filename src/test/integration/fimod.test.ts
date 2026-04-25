import * as assert from "assert";
import * as vscode from "vscode";
import { parseStderr, listMolds, handleFimodError, invalidateMoldCache } from "../../fimod.js";
import type { FimodResult } from "../../fimod.js";

suiteSetup(async () => {
  const ext = vscode.extensions.getExtension("pytgaen.fimod-vscode");
  assert.ok(ext, "Extension not found");
  await ext.activate();
});

suite("parseStderr", () => {
  test("empty string returns []", () => {
    assert.deepStrictEqual(parseStderr(""), []);
  });

  test("whitespace-only returns []", () => {
    assert.deepStrictEqual(parseStderr("   \n  "), []);
  });

  test("parses [info] level", () => {
    assert.deepStrictEqual(parseStderr("[info] hello"), [{ level: "info", text: "hello" }]);
  });

  test("parses [warn] level", () => {
    assert.deepStrictEqual(parseStderr("[warn] be careful"), [{ level: "warn", text: "be careful" }]);
  });

  test("parses [error] level", () => {
    assert.deepStrictEqual(parseStderr("[error] something broke"), [{ level: "error", text: "something broke" }]);
  });

  test("parses [FAIL] level as fail", () => {
    assert.deepStrictEqual(parseStderr("[FAIL] fatal"), [{ level: "fail", text: "fatal" }]);
  });

  test("plain line becomes print level", () => {
    assert.deepStrictEqual(parseStderr("raw output"), [{ level: "print", text: "raw output" }]);
  });

  test("parses multiple lines", () => {
    const result = parseStderr("[info] step 1\n[FAIL] step 2\nplain");
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].level, "info");
    assert.strictEqual(result[1].level, "fail");
    assert.strictEqual(result[2].level, "print");
  });
});

suite("listMolds", () => {
  setup(() => {
    invalidateMoldCache();
  });

  test("returns array from fake binary", async () => {
    const molds = await listMolds();
    assert.ok(Array.isArray(molds), "listMolds should return an array");
    assert.ok(molds.length > 0, "Expected at least one mold from fake binary");
    const mold = molds[0];
    assert.strictEqual(typeof mold.name, "string");
  });

  test("returns empty array when binary fails", async () => {
    process.env.FAKE_FIMOD_MODE = "error";
    try {
      const molds = await listMolds();
      assert.deepStrictEqual(molds, []);
    } finally {
      delete process.env.FAKE_FIMOD_MODE;
    }
  });

  test("caches results on second call", async () => {
    const first = await listMolds();
    const second = await listMolds();
    assert.strictEqual(first, second, "Second call should return same array reference (cached)");
  });
});

suite("handleFimodError", () => {
  const okResult: FimodResult = { stdout: "ok", stderr: "", exitCode: 0, messages: [] };
  const errResult: FimodResult = {
    stdout: "",
    stderr: "[FAIL] oops",
    exitCode: 1,
    messages: [{ level: "fail", text: "oops" }],
  };

  test("returns false when exitCode is 0", () => {
    assert.strictEqual(handleFimodError(okResult, "ctx"), false);
  });

  test("returns true when exitCode is non-zero", () => {
    assert.strictEqual(handleFimodError(errResult, "ctx"), true);
  });
});
