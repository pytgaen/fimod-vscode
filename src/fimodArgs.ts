export interface ShapeArgsInput {
  mold?: string;
  expression?: string;
  inputFormat?: string;
  outputFormat?: string;
  moldArgs?: string[];
}

export function buildShapeArgs(input: ShapeArgsInput): string[] {
  const out = ["shape"];
  if (input.inputFormat) {
    out.push("--input-format", input.inputFormat);
  }
  if (input.outputFormat) {
    out.push("--output-format", input.outputFormat);
  }
  for (const pair of input.moldArgs ?? []) {
    const trimmed = pair.trim();
    if (trimmed) {
      out.push("--arg", trimmed);
    }
  }
  if (input.expression !== undefined) {
    out.push("-e", input.expression);
  } else if (input.mold !== undefined) {
    out.push("-m", input.mold);
  }
  return out;
}
