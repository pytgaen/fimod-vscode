import { runFimod } from "./fimod.js";
import { buildShapeArgs, ShapeArgsInput } from "./fimodArgs.js";

export interface PlaygroundRunRequest extends ShapeArgsInput {
  input?: string;
}

export type PlaygroundRunResult =
  | { kind: "ok"; output: string; exitCode: 0 }
  | { kind: "error"; errorText: string; exitCode: number };

export async function runPlayground(req: PlaygroundRunRequest): Promise<PlaygroundRunResult> {
  const args = buildShapeArgs(req);
  const result = await runFimod(args, req.input);
  if (result.exitCode !== 0) {
    const errText =
      result.messages
        .filter((m) => m.level === "error" || m.level === "fail")
        .map((m) => m.text)
        .join("\n") ||
      result.stderr ||
      `Exit code ${result.exitCode}`;
    return { kind: "error", errorText: errText, exitCode: result.exitCode };
  }
  return { kind: "ok", output: result.stdout, exitCode: 0 };
}
