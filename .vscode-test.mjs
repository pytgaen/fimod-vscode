import { defineConfig } from "@vscode/test-cli";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig([
  {
    label: "integration",
    files: "out/test/integration/**/*.test.js",
    extensionDevelopmentPath: __dirname,
    workspaceFolder: path.join(__dirname, "tests-data/test-workspace"),
    version: "stable",
    launchArgs: [
      "--no-sandbox",
      "--disable-gpu-sandbox",
      "--disable-updates",
      "--skip-welcome",
      "--skip-release-notes",
    ],
    mocha: {
      timeout: 15000,
    },
  },
]);
