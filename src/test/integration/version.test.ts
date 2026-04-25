import * as assert from "assert";
import * as vscode from "vscode";
import { getVersion } from "../../fimod.js";

suite("getVersion", () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension("pytgaen.fimod-vscode");
    assert.ok(ext, "Extension not found");
    await ext.activate();
  });

  test("returns fake binary version string", async () => {
    const version = await getVersion();
    assert.ok(version, "getVersion() should return a non-null string");
    assert.ok(version.startsWith("fimod "), `Unexpected format: ${version}`);
    assert.ok(version.includes("1.2.3"), `Expected 1.2.3, got: ${version}`);
  });

  test("returns null when binary is missing", async () => {
    const cfg = vscode.workspace.getConfiguration("fimod");
    const original = cfg.get<string>("binaryPath");
    await cfg.update("binaryPath", "/nonexistent/fimod", vscode.ConfigurationTarget.Workspace);
    try {
      const version = await getVersion();
      assert.strictEqual(version, null);
    } finally {
      await cfg.update("binaryPath", original, vscode.ConfigurationTarget.Workspace);
    }
  });
});
