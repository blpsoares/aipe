import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPlaceholders, parseOrientationUnits, renderOrientationTemplate, validateOrientation } from "../spec";
import { readLedger, setJourneySpec } from "../ledger";

test("the raw template has every section and a scope per unit but is NOT ok — its `<...>` slots are unsubstituted", () => {
  const md = renderOrientationTemplate("j1", ["platform/core", "web"]);
  const check = validateOrientation(md, ["platform/core", "web"]);
  // Structurally complete…
  expect(check.missingSections).toEqual([]);
  expect(check.missingUnits).toEqual([]);
  // …but a template is not a filled spec: the placeholders make it not ok.
  expect(check.placeholders.length).toBeGreaterThan(0);
  expect(check.ok).toBe(false);
});

test("a fully substituted spec passes validateOrientation", () => {
  const md = [
    "# Orientation Spec — j1",
    "## Problem",
    "Ship the gate.",
    "## Cross-package contracts",
    "aipe consumes agentop.",
    "## Per-package scope",
    "### aipe",
    "- **Scope:** close the spec gate",
    "- **Acceptance:** green tests",
    "## Sequencing",
    "- **Wave 1:** aipe",
    "## Out of scope",
    "- the site",
    "",
  ].join("\n");
  const check = validateOrientation(md, ["aipe"]);
  expect(check.placeholders).toEqual([]);
  expect(check.ok).toBe(true);
});

test("findPlaceholders reports the intact slots but ignores URL autolinks", () => {
  const md = "## Problem\n<why this matters>\nSee <https://example.com/x> and <mailto:a@b.co>.\n<why this matters>\n";
  // De-duplicated, order-preserving; the autolinks are NOT placeholders.
  expect(findPlaceholders(md)).toEqual(["<why this matters>"]);
});

test("validateOrientation flags missing sections and units", () => {
  const md = "# Orientation\n\n## Problem\nx\n\n### web\n- Scope\n";
  const check = validateOrientation(md, ["web", "api"]);
  expect(check.ok).toBe(false);
  expect(check.missingSections).toContain("Sequencing");
  expect(check.missingUnits).toEqual(["api"]);
});

test("parseOrientationUnits reads the units back from a rendered template", () => {
  const md = renderOrientationTemplate("j1", ["platform/core", "web"]);
  expect(parseOrientationUnits(md)).toEqual(["platform/core", "web"]);
});

test("parseOrientationUnits only counts `###` under Per-package scope, not prose headings elsewhere", () => {
  const md = [
    "# Orientation Spec — j1",
    "## Problem",
    "### Confirmados no código",
    "text",
    "### A verificar",
    "more",
    "## Per-package scope",
    "### aipe",
    "- Scope",
    "## Sequencing",
    "### wave notes",
  ].join("\n");
  expect(parseOrientationUnits(md)).toEqual(["aipe"]);
});

test("setJourneySpec persists and round-trips through the ledger, preserving dispatches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-jspec-"));
  try {
    const { recordDispatch } = await import("../ledger");
    await recordDispatch(dir, "j1", { repo: "web", specialist: "Ana", branch: "b", worktree: "w", status: "dispatched" });
    await setJourneySpec(dir, "j1", { path: ".aipe/journeys/j1/orientation.md", version: 1, approved: false });
    let ledger = await readLedger(dir, "j1");
    expect(ledger?.spec).toEqual({ path: ".aipe/journeys/j1/orientation.md", version: 1, approved: false });
    expect(ledger?.dispatches).toHaveLength(1); // dispatch preserved

    await setJourneySpec(dir, "j1", { ...ledger!.spec!, approved: true });
    ledger = await readLedger(dir, "j1");
    expect(ledger?.spec?.approved).toBe(true);
    expect(ledger?.dispatches).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
