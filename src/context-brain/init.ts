import type { ContextInput, ValidationError } from "./types";
import { validateContext } from "./validate";
import { writeBrainFiles } from "./write";

export type InitResult =
  | { ok: true; brainPath: string; statePath: string }
  | { ok: false; errors: ValidationError[] };

export async function initContextBrain(
  input: ContextInput,
  workspaceDir: string,
): Promise<InitResult> {
  const validation = validateContext(input);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  const { brainPath, statePath } = await writeBrainFiles(workspaceDir, {
    context: input.context,
    repos: input.repos,
  });
  return { ok: true, brainPath, statePath };
}
