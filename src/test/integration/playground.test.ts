import * as assert from "assert";
import * as vscode from "vscode";
import { runPlayground } from "../../playgroundEngine.js";

suite("runPlayground", () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension("pytgaen.fimod-vscode");
    assert.ok(ext, "Extension not found");
    await ext.activate();
  });

  test("nominal: JSON passthrough returns ok result", async () => {
    const input = '{"hello":"world"}';
    const result = await runPlayground({
      input,
      inputFormat: "json",
      outputFormat: "json",
      expression: ".",
    });
    assert.strictEqual(result.kind, "ok");
    const parsed = JSON.parse(result.output);
    assert.deepStrictEqual(parsed, { hello: "world" });
  });

  test("error: fake binary in error mode returns error result", async () => {
    process.env.FAKE_FIMOD_MODE = "error";
    try {
      const result = await runPlayground({
        input: '{"x":1}',
        inputFormat: "json",
        outputFormat: "json",
        expression: ".",
      });
      assert.strictEqual(result.kind, "error");
      assert.ok(result.errorText.includes("something went wrong"), `Unexpected error: ${result.errorText}`);
    } finally {
      delete process.env.FAKE_FIMOD_MODE;
    }
  });

  test("invalid input: non-JSON returns error result", async () => {
    const result = await runPlayground({
      input: "not valid json",
      inputFormat: "json",
      outputFormat: "json",
      expression: ".",
    });
    // fake binary echoes input as-is when JSON.parse fails, exit 0
    assert.strictEqual(result.kind, "ok");
    assert.strictEqual(result.output.trim(), "not valid json");
  });
});
