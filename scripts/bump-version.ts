#!/usr/bin/env bun
// Stamps one version onto every file that hardcodes it.
//
// The release workflow computes the next version and calls this; nothing else
// should edit those files by hand. There is deliberately ONE list (REFS in
// scripts/version.ts) shared by the writer here and the guard that verifies the
// result — two lists that must agree is the shape of the bug, not the fix.
//
//   bun run scripts/bump-version.ts 1.1.0
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auditVersions, REFS, ROOT } from "./version";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/** Pure: replace the first match of `pattern` with the new declaration. */
export function stamp(text: string, pattern: RegExp, replacement: string): string | null {
  return pattern.test(text) ? text.replace(pattern, replacement) : null;
}

export async function bump(version: string): Promise<number> {
  if (!SEMVER_RE.test(version)) {
    console.log(`ERROR version: '${version}' is not major.minor.patch`);
    return 1;
  }

  const manifestPath = join(ROOT, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`OK   .claude-plugin/plugin.json = ${version}`);

  let failures = 0;
  for (const ref of REFS) {
    const full = join(ROOT, ref.file);
    const text = await readFile(full, "utf8");
    const next = stamp(text, ref.pattern, ref.write(version));
    if (next === null) {
      console.log(`FAIL ${ref.file} — no version declaration matched`);
      failures++;
      continue;
    }
    await writeFile(full, next, "utf8");
    console.log(`OK   ${ref.file} = ${version}`);
  }

  // Verify with the same reader the CI guard uses, so a silently-wrong write
  // (a pattern that matched the wrong line) fails here rather than in a release.
  const audit = await auditVersions();
  if (!audit.inSync || audit.source !== version) {
    console.log(`STATE version=${audit.source} — out of sync after the bump`);
    return 1;
  }
  console.log(`STATE version=${version} (in sync)`);
  return failures === 0 ? 0 : 1;
}

if (import.meta.main) {
  const version = (process.argv[2] ?? "").replace(/^v/, "");
  bump(version)
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
