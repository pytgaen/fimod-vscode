import * as assert from "assert";
import { buildShapeArgs } from "../../fimodArgs.js";

suite("buildShapeArgs", () => {
  test("expression only", () => {
    const args = buildShapeArgs({ expression: "." });
    assert.deepStrictEqual(args, ["shape", "-e", "."]);
  });

  test("mold only", () => {
    const args = buildShapeArgs({ mold: "my-mold" });
    assert.deepStrictEqual(args, ["shape", "-m", "my-mold"]);
  });

  test("input + output format", () => {
    const args = buildShapeArgs({ inputFormat: "json", outputFormat: "yaml", expression: "." });
    assert.deepStrictEqual(args, ["shape", "--input-format", "json", "--output-format", "yaml", "-e", "."]);
  });

  test("moldArgs are forwarded as --arg pairs", () => {
    const args = buildShapeArgs({ expression: ".", moldArgs: ["key=val", "  ", "foo=bar"] });
    assert.deepStrictEqual(args, ["shape", "--arg", "key=val", "--arg", "foo=bar", "-e", "."]);
  });

  test("no mold and no expression", () => {
    const args = buildShapeArgs({ inputFormat: "json" });
    assert.deepStrictEqual(args, ["shape", "--input-format", "json"]);
  });

  test("expression takes precedence over mold", () => {
    const args = buildShapeArgs({ expression: ".", mold: "ignored" });
    assert.ok(args.includes("-e"));
    assert.ok(!args.includes("-m"));
  });
});
