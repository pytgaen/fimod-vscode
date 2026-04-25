#!/usr/bin/env node
// Fake fimod binary for integration tests.
// Behaviour is controlled by FAKE_FIMOD_MODE env var (default: "ok").

const args = process.argv.slice(2);
const mode = process.env.FAKE_FIMOD_MODE ?? "ok";

function handleShape() {
  if (mode === "error") {
    process.stderr.write("[FAIL] something went wrong\n");
    process.exit(1);
  }
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    try {
      const parsed = JSON.parse(input);
      process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");
    } catch {
      process.stdout.write(input);
    }
    process.exit(0);
  });
}

if (args[0] === "--version") {
  process.stdout.write("fimod 1.2.3\n");
  process.exit(0);
} else if (args[0] === "mold" && args[1] === "list") {
  if (mode === "error") {
    process.stderr.write("[FAIL] something went wrong\n");
    process.exit(1);
  }
  const molds = [{ name: "test-mold", description: "A test mold", source: "local" }];
  process.stdout.write(JSON.stringify(molds) + "\n");
  process.exit(0);
} else if (args[0] === "shape") {
  handleShape();
} else {
  process.stderr.write(`[error] unknown command: ${args[0] ?? "(none)"}\n`);
  process.exit(2);
}
