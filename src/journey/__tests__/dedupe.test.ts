import { test, expect } from "bun:test";
import { normalizeRepo, normalizeSpecialist, canonicalizeDispatch } from "../normalize";
import { dedupeLedger } from "../dedupe";
import type { JourneyDispatch, JourneyLedger } from "../types";
import type { PersonaRegistryEntry } from "../../hire-specialists/types";

const roster: PersonaRegistryEntry[] = [
  { name: "Jane", role: "dev-fullstack", repo: "agentistics", path: null },
  { name: "Jesse", role: "dev-fullstack", repo: "aipe", path: null },
];

const d = (over: Partial<JourneyDispatch>): JourneyDispatch =>
  ({ repo: "agentistics", specialist: "Jane", branch: "b", worktree: "/wt", status: "dispatched", ...over }) as JourneyDispatch;

// ── normalize ─────────────────────────────────────────────────────────────────
test("normalizeRepo strips an org/owner prefix; idempotent on a bare name", () => {
  expect(normalizeRepo("blpsoares/agentistics")).toBe("agentistics");
  expect(normalizeRepo("agentistics")).toBe("agentistics");
});

test("normalizeSpecialist resolves case-insensitively to the roster's canonical name", () => {
  expect(normalizeSpecialist("jane", roster)).toBe("Jane");
  expect(normalizeSpecialist("JANE", roster)).toBe("Jane");
  expect(normalizeSpecialist("Ghost", roster)).toBe("Ghost"); // unknown → as-is, never guessed
});

// ── the jane/Jane collapse (item 5) ───────────────────────────────────────────
test("the two spellings of one unit collapse to a SINGLE record", () => {
  const ledger: JourneyLedger = {
    id: "j-cy",
    dispatches: [
      d({ specialist: "Jane", repo: "agentistics", package: "web", task: "t", status: "delivered", pr: "http://pr/1", evidence: { by: "dev", commands: ["x"], summary: "ok" } }),
      d({ specialist: "jane", repo: "blpsoares/agentistics", task: "t", status: "dispatched" }), // the self-registered dup
    ],
  };
  const { ledger: out, changed, merges } = dedupeLedger(ledger, roster);
  expect(out.dispatches.length).toBe(1);
  expect(changed).toBe(true);
  expect(merges.length).toBe(1);
  const rec = out.dispatches[0]!;
  expect(rec.specialist).toBe("Jane");
  expect(rec.repo).toBe("agentistics");
  expect(rec.status).toBe("delivered"); // the most-advanced survivor
});

// ── LOCK 1: merged immutability, incl. a duplicate stuck behind it ────────────
test("a merged survivor is kept EXACTLY, the stuck delivered duplicate is dropped", () => {
  const mergedRec = d({ specialist: "Jane", repo: "agentistics", package: "web", task: "t", status: "merged", pr: "http://pr/1", evidence: { by: "qa", commands: ["ci"], summary: "green" } });
  const ledger: JourneyLedger = {
    id: "j",
    dispatches: [
      mergedRec,
      d({ specialist: "jane", repo: "blpsoares/agentistics", package: "web", task: "t", status: "delivered", pr: "http://pr/stuck" }), // could never be closed → stuck
    ],
  };
  const { ledger: out } = dedupeLedger(ledger, roster);
  expect(out.dispatches.length).toBe(1);
  // the merged record survives untouched — byte-for-byte, immutability intact
  expect(out.dispatches[0]).toEqual(mergedRec);
});

// ── LOCK 2: existing ledgers load intact ──────────────────────────────────────
test("a ledger with nothing to fix round-trips unchanged (changed=false)", () => {
  const ledger: JourneyLedger = {
    id: "j",
    dispatches: [
      d({ specialist: "Jane", repo: "agentistics", task: "a", status: "verified" }),
      d({ specialist: "Jesse", repo: "aipe", task: "b", status: "dispatched" }),
    ],
  };
  const { ledger: out, changed } = dedupeLedger(ledger, roster);
  expect(changed).toBe(false);
  expect(out.dispatches).toEqual(ledger.dispatches);
});

test("unknown fields and legacy records with no envelope ride through untouched", () => {
  const legacy = { repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/w", status: "dispatched", weirdLegacyField: 42 } as unknown as JourneyDispatch;
  const { ledger: out } = dedupeLedger({ id: "j", dispatches: [legacy] }, roster);
  expect((out.dispatches[0] as unknown as { weirdLegacyField: number }).weirdLegacyField).toBe(42);
  expect(out.dispatches[0]!.harness).toBeUndefined();
});

test("recovers a PR/evidence that lived on the dropped duplicate (non-merged survivor)", () => {
  const ledger: JourneyLedger = {
    id: "j",
    dispatches: [
      d({ specialist: "jane", repo: "blpsoares/agentistics", task: "t", status: "verified", evidence: { by: "qa", commands: ["c"], summary: "s" } }), // survivor, no PR
      d({ specialist: "Jane", repo: "agentistics", task: "t", status: "delivered", pr: "http://pr/9" }), // dropped, has PR
    ],
  };
  const { ledger: out } = dedupeLedger(ledger, roster);
  expect(out.dispatches.length).toBe(1);
  expect(out.dispatches[0]!.status).toBe("verified");
  expect(out.dispatches[0]!.pr).toBe("http://pr/9"); // recovered
});

test("two DIFFERENT specialists on the same unit are NOT merged", () => {
  const ledger: JourneyLedger = {
    id: "j",
    dispatches: [
      d({ specialist: "Jane", repo: "agentistics", task: "t", status: "verified" }),
      d({ specialist: "Jesse", repo: "agentistics", task: "t", status: "dispatched" }),
    ],
  };
  const { ledger: out } = dedupeLedger(ledger, roster);
  expect(out.dispatches.length).toBe(2);
});

test("canonicalizeDispatch fixes repo + specialist together, leaving other fields", () => {
  const c = canonicalizeDispatch(d({ specialist: "jane", repo: "blpsoares/agentistics", task: "t", pr: "p" }), roster);
  expect(c.specialist).toBe("Jane");
  expect(c.repo).toBe("agentistics");
  expect(c.task).toBe("t");
  expect(c.pr).toBe("p");
});
