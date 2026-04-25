import * as assert from "assert";
import { safeJsonParse, escapeHtml, createTTLCache, getBinaryName } from "../../util.js";

suite("safeJsonParse", () => {
  test("parses valid JSON", () => {
    assert.deepStrictEqual(safeJsonParse('{"a":1}', null), { a: 1 });
  });

  test("returns fallback on invalid JSON", () => {
    assert.strictEqual(safeJsonParse("not json", 42), 42);
  });

  test("returns fallback on empty string", () => {
    assert.deepStrictEqual(safeJsonParse("", []), []);
  });
});

suite("escapeHtml", () => {
  test("escapes ampersand", () => {
    assert.strictEqual(escapeHtml("a&b"), "a&amp;b");
  });

  test("escapes angle brackets", () => {
    assert.strictEqual(escapeHtml("<script>"), "&lt;script&gt;");
  });

  test("escapes double quotes", () => {
    assert.strictEqual(escapeHtml('"quoted"'), "&quot;quoted&quot;");
  });

  test("leaves plain text untouched", () => {
    assert.strictEqual(escapeHtml("hello world"), "hello world");
  });
});

suite("createTTLCache", () => {
  test("returns undefined before any set", () => {
    const cache = createTTLCache<string>(1000);
    assert.strictEqual(cache.get(), undefined);
  });

  test("returns value within TTL", () => {
    const cache = createTTLCache<number>(5000);
    cache.set(99);
    assert.strictEqual(cache.get(), 99);
  });

  test("returns undefined after TTL expired", async () => {
    const cache = createTTLCache<number>(10);
    cache.set(7);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(cache.get(), undefined);
  });

  test("invalidate clears all entries", () => {
    const cache = createTTLCache<string>(5000);
    cache.set("a", "key1");
    cache.set("b", "key2");
    cache.invalidate();
    assert.strictEqual(cache.get("key1"), undefined);
    assert.strictEqual(cache.get("key2"), undefined);
  });
});

suite("getBinaryName", () => {
  test("returns fimod on non-windows", () => {
    if (process.platform !== "win32") {
      assert.strictEqual(getBinaryName(), "fimod");
    }
  });
});
