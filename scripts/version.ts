#!/usr/bin/env bun
// Version single-source-of-truth guard. The release version is hardcoded in
// several files (the plugin manifest, the CLI, both launchers, the POSIX
// installer). This module reads them all and checks they agree, so a release
// can't go out with a drifted version. Run directly: `bun run scripts/version.ts`.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

export interface VersionRef {
  file: string;
  version: string | null;
}

export interface VersionAudit {
  source: string; // the SoT version, from .claude-plugin/plugin.json
  refs: VersionRef[];
  inSync: boolean;
  mismatches: VersionRef[];
}

// Each ref file + a regex whose first capture group is the version string.
const REFS: { file: string; pattern: RegExp }[] = [
  { file: "src/cli.ts", pattern: /export const VERSION\s*=\s*"([^"]+)"/ },
  { file: "bin/aipe", pattern: /AIPE_VERSION="([^"]+)"/ },
  { file: "bin/aipe.cmd", pattern: /set "AIPE_VERSION=([^"]+)"/ },
  { file: "scripts/install.sh", pattern: /AIPE_VERSION="\$\{AIPE_VERSION:-([^"}]+)\}"/ },
];

async function extract(file: string, pattern: RegExp): Promise<string | null> {
  try {
    const text = await readFile(join(ROOT, file), "utf8");
    const m = text.match(pattern);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function auditVersions(): Promise<VersionAudit> {
  const manifest = JSON.parse(await readFile(join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
  const source: string = manifest.version;

  const refs: VersionRef[] = [{ file: ".claude-plugin/plugin.json", version: source }];
  for (const { file, pattern } of REFS) {
    refs.push({ file, version: await extract(file, pattern) });
  }

  const mismatches = refs.filter((r) => r.version !== source);
  return { source, refs, inSync: mismatches.length === 0, mismatches };
}

if (import.meta.main) {
  const audit = await auditVersions();
  for (const r of audit.refs) {
    const ok = r.version === audit.source;
    console.log(`${ok ? "OK  " : "DIFF"} ${r.file} = ${r.version ?? "<not found>"}`);
  }
  if (audit.inSync) {
    console.log(`STATE version=${audit.source} (in sync)`);
    process.exit(0);
  }
  console.log(`STATE version=${audit.source} — ${audit.mismatches.length} file(s) out of sync`);
  process.exit(1);
}
