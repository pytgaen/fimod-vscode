import * as assert from "assert";
import { detectFormat } from "../../format.js";
import { stripV, isNewerVersion } from "../../binary.js";

suite("detectFormat", () => {
  test("detects json by languageId", () => {
    assert.strictEqual(detectFormat("{}", "json"), "json");
  });

  test("detects jsonc by languageId", () => {
    assert.strictEqual(detectFormat("{}", "jsonc"), "json");
  });

  test("detects yaml by languageId", () => {
    assert.strictEqual(detectFormat("key: val", "yaml"), "yaml");
  });

  test("detects toml by languageId", () => {
    assert.strictEqual(detectFormat("[section]", "toml"), "toml");
  });

  test("detects csv by languageId", () => {
    assert.strictEqual(detectFormat("a,b,c", "csv"), "csv");
  });

  test("detects plaintext by languageId", () => {
    assert.strictEqual(detectFormat("hello", "plaintext"), "txt");
  });

  test("falls back to content: { → json", () => {
    assert.strictEqual(detectFormat('{"x":1}', "unknown"), "json");
  });

  test("falls back to content: [ → json", () => {
    assert.strictEqual(detectFormat("[1,2,3]", "unknown"), "json");
  });

  test("falls back to content: --- → yaml", () => {
    assert.strictEqual(detectFormat("---\nkey: val", "unknown"), "yaml");
  });

  test("falls back to content: section header mid-file → toml", () => {
    assert.strictEqual(detectFormat("key=val\n[section]\nmore=stuff", "unknown"), "toml");
  });

  test("returns undefined for unrecognised content", () => {
    assert.strictEqual(detectFormat("hello world", "unknown"), undefined);
  });
});

suite("stripV", () => {
  test("strips leading v", () => {
    assert.strictEqual(stripV("v1.2.3"), "1.2.3");
  });

  test("leaves version without v untouched", () => {
    assert.strictEqual(stripV("1.2.3"), "1.2.3");
  });

  test("only strips leading v", () => {
    assert.strictEqual(stripV("v1.2.v3"), "1.2.v3");
  });
});

suite("isNewerVersion", () => {
  test("major bump is newer", () => {
    assert.ok(isNewerVersion("2.0.0", "1.9.9"));
  });

  test("minor bump is newer", () => {
    assert.ok(isNewerVersion("1.3.0", "1.2.9"));
  });

  test("patch bump is newer", () => {
    assert.ok(isNewerVersion("1.2.4", "1.2.3"));
  });

  test("same version is not newer", () => {
    assert.ok(!isNewerVersion("1.2.3", "1.2.3"));
  });

  test("older version is not newer", () => {
    assert.ok(!isNewerVersion("1.2.2", "1.2.3"));
  });

  test("older major is not newer", () => {
    assert.ok(!isNewerVersion("0.9.9", "1.0.0"));
  });
});
