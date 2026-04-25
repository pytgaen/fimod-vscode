import path from "path";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fakeBin = path.join(root, "tests-data", "fake-fimod.mjs");
const settingsDir = path.join(root, "tests-data", "test-workspace", ".vscode");

mkdirSync(settingsDir, { recursive: true });
writeFileSync(
  path.join(settingsDir, "settings.json"),
  JSON.stringify(
    {
      "fimod.binaryPath": fakeBin,
      "fimod.binary.autoCheckUpdates": false,
      "fimod.registry.autoRefresh": false,
    },
    null,
    2,
  ),
);
console.log(`Test workspace configured: binaryPath=${fakeBin}`);
