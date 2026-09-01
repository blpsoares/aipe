// The registry drives `aipe upgrade`, which rehydrates every workspace it knows
// about. It only ever forgot an entry whose `.aipe/` had disappeared — and a
// `/tmp` fixture survives until reboot, a scratchpad indefinitely. So every test
// run, every e2e case and every assistant session that built a scratch workspace
// was recorded FOREVER, and each one added a rehydrate to every future upgrade.
//
// Measured on the PE's machine: 50 entries, 49 throwaway, one real. His
// `aipe upgrade` rehydrated six scratch directories before reaching his actual
// workspace — and then reported the migration blocked, partly because of them.
import { expect, test } from "bun:test";
import { isEphemeralWorkspace } from "../workspaces";

test("a /tmp or scratchpad workspace is ephemeral; a real one is not", () => {
  expect(isEphemeralWorkspace("/tmp/aipe-e2e-fuT9")).toBe(true);
  expect(isEphemeralWorkspace("/tmp/tmp.QYjKROMaeT")).toBe(true);
  // the exact shape that filled the PE's registry today
  expect(isEphemeralWorkspace("/tmp/claude-1000/-home-x/abc/scratchpad/ws3")).toBe(true);
  expect(isEphemeralWorkspace("/home/mithrandir/work/scratchpad")).toBe(true);

  expect(isEphemeralWorkspace("/home/mithrandir/aipe-blpsoares")).toBe(false);
  expect(isEphemeralWorkspace("/opt/projects/context")).toBe(false);
  // a real workspace that merely CONTAINS the word is not ephemeral — the rule
  // is about being inside a scratch dir, not about spelling
  expect(isEphemeralWorkspace("/home/mithrandir/scratchpad-notes")).toBe(false);
});

test("the rule is a PATH rule, not a guess about content", () => {
  // Deliberate: nothing here reads the directory. A heuristic that tried to
  // judge "is this workspace real?" from what is inside it would be a signal
  // asserting what it had not established — the defect class this repo tracks.
  // Ephemerality is decided by WHERE the path is, which is a fact.
  expect(isEphemeralWorkspace("/tmp/does-not-exist-at-all")).toBe(true);
});
