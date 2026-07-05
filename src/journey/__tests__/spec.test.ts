import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderOrientationTemplate, validateOrientation } from "../spec";
import { readLedger, setJourneySpec } from "../ledger";

test("the template has every canonical section and a scope per unit", () => {
  const md = renderOrientationTemplate("j1", ["platform/core", "web"]);
  const check = validateOrientation(md, ["platform/core", "web"]);
  expect(check.ok).toBe(true);
});

test("validateOrientation flags missing sections and units", () => {
  const md = "# Orientation\n\n## Problem\nx\n\n### web\n- Scope\n";
  const check = validateOrientation(md, ["web", "api"]);
  expect(check.ok).toBe(false);
  expect(check.missingSections).toContain("Sequencing");
  expect(check.missingUnits).toEqual(["api"]);
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
