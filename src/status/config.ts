// `aipe status config` — the documented, typed path to change the (10)
// follow-preference AFTER onboarding, without redoing it (invariant 5). The
// coordinator never edits the brain YAML by hand: this reads the brain, applies
// the change through the typed validator (invariant 6 — an invalid value is a
// legible error, never a crash or a silent default) and writes it back,
// preserving the existing key order (round-trip via the same parse→stringify the
// rest of the brain uses).
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { validateStatusUpdates } from "../context-brain/validate";
import type { StatusUpdatesConfig, StatusUpdatesFormat } from "../context-brain/types";
import { readBrain } from "../make-workspace/read";

const DEFAULT: StatusUpdatesConfig = { auto: false, format: "detailed" };

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) return undefined;
  return v;
}

function parseBool(v: string): boolean | undefined {
  if (v === "true" || v === "on" || v === "yes") return true;
  if (v === "false" || v === "off" || v === "no") return false;
  return undefined;
}

export async function configCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const brainResult = await readBrain(workspace);
  if (!brainResult.ok) {
    console.log(`ERROR brain: ${brainResult.error}`);
    return 1;
  }
  const brain = brainResult.brain;
  const current: StatusUpdatesConfig = brain.context.statusUpdates ?? DEFAULT;

  const autoFlag = getFlag(args, "--auto");
  const formatFlag = getFlag(args, "--format");

  // No change requested → report the current setting.
  if (autoFlag === undefined && formatFlag === undefined) {
    console.log(`STATUS-UPDATES auto=${current.auto} format=${current.format}`);
    return 0;
  }

  let auto = current.auto;
  if (autoFlag !== undefined) {
    const parsed = parseBool(autoFlag);
    if (parsed === undefined) {
      console.log("ERROR context.statusUpdates.auto: --auto must be true or false");
      return 1;
    }
    auto = parsed;
  }
  const format = (formatFlag ?? current.format) as StatusUpdatesFormat;

  const next: StatusUpdatesConfig = { auto, format };
  const errors = validateStatusUpdates(next);
  if (errors.length > 0) {
    for (const e of errors) console.log(`ERROR ${e.field}: ${e.message}`);
    return 1;
  }

  brain.context.statusUpdates = next;
  await writeFile(join(workspace, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  console.log(`OK status-updates auto=${next.auto} format=${next.format}`);
  return 0;
}
