import * as assert from "assert";
import * as vscode from "vscode";

const EXTENSION_ID = "pytgaen.fimod-vscode";

const EXPECTED_COMMANDS = [
  "fimod.shape",
  "fimod.downloadBinary",
  "fimod.registryRefresh",
  "fimod.registryAddSource",
  "fimod.registryRemoveSource",
  "fimod.registrySetPriority",
  "fimod.registryBuildCatalog",
  "fimod.registrySetup",
  "fimod.registryShowSource",
  "fimod.localMoldsRefresh",
  "fimod.moldOpen",
  "fimod.moldRun",
  "fimod.moldTest",
  "fimod.moldShowDetail",
  "fimod.playground",
  "fimod.moldSetTestsDir",
  "fimod.localMoldsSettings",
];

suite("Extension smoke", () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} not found`);
    await ext.activate();
  });

  test("extension activates without error", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext?.isActive, "Extension should be active");
  });

  test("all fimod.* commands are registered", async () => {
    const all = await vscode.commands.getCommands(true);
    for (const cmd of EXPECTED_COMMANDS) {
      assert.ok(all.includes(cmd), `Missing command: ${cmd}`);
    }
  });
});
