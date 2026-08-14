import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, recordDispatch, startJourney } from "../../journey/ledger";

test("a session-mode dispatch round-trips its new fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-ledger-fields-"));
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark",
    specialist: "Joaquim",
    branch: "aipe/j1/joaquim",
    worktree: ".worktrees/j1-joaquim",
    status: "dispatched",
    mode: "session",
    intensity: "ultracode",
    harness: "claude-code",
    sessionId: "s-abc",
  });
  const ledger = await readLedger(dir, "j1");
  expect(ledger!.dispatches[0]).toMatchObject({
    mode: "session",
    intensity: "ultracode",
    harness: "claude-code",
    sessionId: "s-abc",
  });
});

test("a subagent dispatch omits them entirely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-ledger-fields-"));
  await startJourney(dir, "j2");
  await recordDispatch(dir, "j2", {
    repo: "embark",
    specialist: "Joaquim",
    branch: "b",
    worktree: "w",
    status: "dispatched",
  });
  const d = (await readLedger(dir, "j2"))!.dispatches[0]!;
  expect(d.mode).toBeUndefined();
  expect(d.sessionId).toBeUndefined();
});
