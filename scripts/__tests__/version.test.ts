import { expect, test } from "bun:test";
import { auditVersions } from "../version";

test("every hardcoded version reference matches the plugin manifest SoT", async () => {
  const audit = await auditVersions();
  // Every ref file was found (no null versions) and equals the source.
  for (const ref of audit.refs) {
    expect(ref.version, `${ref.file} version`).toBe(audit.source);
  }
  expect(audit.inSync).toBe(true);
});

test("the SoT version is a sane semver-ish string", async () => {
  const audit = await auditVersions();
  expect(audit.source).toMatch(/^\d+\.\d+\.\d+/);
});
