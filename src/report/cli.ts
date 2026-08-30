#!/usr/bin/env bun
// `aipe report` — the delivery report the PE can relate to third parties. Reads
// the journey ledgers, runs the pure computeReport engine, and prints a readable
// table (default), --json (the whole result), or --csv (flat group rows). Every
// number says whether it is measured or derived; absence is never a zero.
import { listJourneys } from "../journey/ledger";
import { computeReport, type GroupDim, type ReportFilter } from "./compute";
import { resolvePublication } from "./publication";
import { toTable, toJson, toCsv } from "./format";

const GROUP_DIMS: GroupDim[] = ["repo", "persona", "status", "period", "model", "harness", "tier"];

// Repeatable value flag: collects every `--name value` occurrence.
function multiFlag(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) {
      const v = args[i + 1];
      if (v !== undefined && !v.startsWith("--")) out.push(v);
    }
  }
  return out;
}

function singleFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : undefined;
}

function workspaceOf(args: string[]): string {
  return singleFlag(args, "--workspace") ?? process.cwd();
}

export async function run(args: string[]): Promise<number> {
  const groupByRaw = multiFlag(args, "--group-by");
  const bad = groupByRaw.filter((g) => !GROUP_DIMS.includes(g as GroupDim));
  if (bad.length > 0) {
    console.log(`ERROR --group-by: unknown dimension(s) ${bad.join(", ")}. Known: ${GROUP_DIMS.join(", ")}`);
    return 1;
  }

  const filter: ReportFilter = {};
  const repo = multiFlag(args, "--repo");
  const persona = multiFlag(args, "--persona");
  const status = multiFlag(args, "--status");
  const since = singleFlag(args, "--since");
  const until = singleFlag(args, "--until");
  if (repo.length) filter.repo = repo;
  if (persona.length) filter.persona = persona;
  if (status.length) filter.status = status;
  if (since) filter.since = since;
  if (until) filter.until = until;

  const workspace = workspaceOf(args);
  // Publication (merged ≠ published) from local git — the driven-on-binary
  // surface resolves it once. `--no-release` skips the git touch (repos then
  // report as `unknown`, honest absence, never a guessed "published").
  const journeys = await listJourneys(workspace);
  const publication = args.includes("--no-release") ? {} : await resolvePublication(workspace);
  const result = computeReport(journeys, { filter, groupBy: groupByRaw as GroupDim[], publication });

  if (args.includes("--json")) console.log(toJson(result));
  else if (args.includes("--csv")) console.log(toCsv(result));
  else console.log(toTable(result));
  return 0;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
