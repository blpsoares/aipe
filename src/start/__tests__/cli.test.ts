import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCommand } from "../cli";
import { findHarness, renderNextSteps } from "../start";
import { readCapabilities } from "../../capabilities/store";
import { FLOW_SKILLS } from "../../harness/skills";
import type { ProbeRunner } from "../../capabilities/types";

// `aipe start` never talks to a real harness binary in a test — same
// injectable-runner pattern as capabilities/__tests__/cli.test.ts's `only()`
// and execution/__tests__/cli.test.ts's fake runners.
const only = (present: string[]): ProbeRunner => async (bin) =>
  present.includes(bin) ? { code: 0, stdout: `${bin} 1.2.3`, stderr: "" } : { code: 127, stdout: "", stderr: "" };

const NOW = "2026-08-15T00:00:00.000Z";

const UNCONFIRMED_NOTE =
  "NOTE capabilities: probed, not confirmed — a binary on PATH is not an authenticated binary. Run `aipe capabilities confirm` once you have checked.";

const CLAUDE_CODE_HARNESS = findHarness("claude-code")!;
const SKILLS_NOTE = `${Object.keys(FLOW_SKILLS).length} AIPe skills installed`;

test("start writes an unconfirmed capabilities.yaml and reports what it found", async () => {
  const parentDir = await mkdtemp(join(tmpdir(), "aipe-startcli-"));
  const folder = "aipe-acme-co";

  const r = await startCommand({
    parentDir,
    harness: CLAUDE_CODE_HARNESS,
    name: "Acme Co",
    runner: only(["claude", "gemini"]),
    now: NOW,
  });

  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    `aipe: installed the Claude Code integration into ${folder}/`,
    "aipe:  - SessionStart hook → aipe session-context",
    `aipe:  - ${SKILLS_NOTE}`,
    "aipe: checked which harnesses are available on this machine:",
    "aipe:  - OK claude-code claude 1.2.3",
    "aipe:  - OK gemini gemini 1.2.3",
    "aipe:  - -- codex codex absent",
    "aipe:  - -- copilot copilot absent",
    `aipe:  - ${UNCONFIRMED_NOTE}`,
    ...renderNextSteps(folder),
  ]);

  const workspaceDir = join(parentDir, folder);
  const result = await readCapabilities(workspaceDir);
  expect(result).not.toBeNull();
  expect(result!.dropped).toBe(0);
  expect(result!.capabilities).toEqual({
    confirmed: false,
    harnesses: [
      { id: "claude-code", bin: "claude", present: true, version: "1.2.3", source: "probe", checkedAt: NOW },
      { id: "gemini", bin: "gemini", present: true, version: "1.2.3", source: "probe", checkedAt: NOW },
      { id: "codex", bin: "codex", present: false, version: null, source: "probe", checkedAt: NOW },
      { id: "copilot", bin: "copilot", present: false, version: null, source: "probe", checkedAt: NOW },
    ],
  });
});

test("start still completes when the probe throws", async () => {
  const parentDir = await mkdtemp(join(tmpdir(), "aipe-startcli-"));
  const folder = "aipe-acme-co";
  const workspaceDir = join(parentDir, folder);

  // Pre-create capabilities.yaml AS A DIRECTORY so store.ts's writeFile throws
  // EISDIR when probeCommand tries to persist the probe result — a real,
  // unmocked failure, not a stubbed one.
  const badCapsPath = join(workspaceDir, ".aipe", "capabilities.yaml");
  await mkdir(badCapsPath, { recursive: true });

  const r = await startCommand({
    parentDir,
    harness: CLAUDE_CODE_HARNESS,
    name: "Acme Co",
    runner: only(["claude"]),
    now: NOW,
  });

  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    `aipe: installed the Claude Code integration into ${folder}/`,
    "aipe:  - SessionStart hook → aipe session-context",
    `aipe:  - ${SKILLS_NOTE}`,
    `aipe:  - could not check harness capabilities automatically (Error: EISDIR: illegal operation on a directory, open '${badCapsPath}') — run \`aipe capabilities probe\` later`,
    ...renderNextSteps(folder),
  ]);
});
