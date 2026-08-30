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

// --- the shell-hook install OFFER at the end of `aipe start` (discoverability) ---
// The offer SUGGESTS, never installs (installing is the user's act), and it stops
// appearing once the hook is installed, so it never becomes per-run noise.
import { writeFile } from "node:fs/promises";
import { installShellHook } from "../../shell-hook/cli";

test("start offers the shell-hook when it is not installed in the user's rc", async () => {
  const parentDir = await mkdtemp(join(tmpdir(), "aipe-startcli-"));
  const home = await mkdtemp(join(tmpdir(), "aipe-starthome-"));
  await writeFile(join(home, ".bashrc"), "export PATH=x\n");

  const r = await startCommand({
    parentDir,
    home,
    harness: CLAUDE_CODE_HARNESS,
    name: "Acme Co",
    runner: only(["claude"]),
    now: NOW,
  });

  expect(r.code).toBe(0);
  expect(r.lines.some((l) => l.includes("aipe shell-hook install"))).toBe(true);
  // Nothing was written — the offer only suggests.
  expect(await Bun.file(join(home, ".bashrc")).text()).toBe("export PATH=x\n");
});

test("start stays silent about the shell-hook once it is installed (no nagging)", async () => {
  const parentDir = await mkdtemp(join(tmpdir(), "aipe-startcli-"));
  const home = await mkdtemp(join(tmpdir(), "aipe-starthome-"));
  await writeFile(join(home, ".bashrc"), "export PATH=x\n");
  await installShellHook(home); // user opted in

  const r = await startCommand({
    parentDir,
    home,
    harness: CLAUDE_CODE_HARNESS,
    name: "Acme Co",
    runner: only(["claude"]),
    now: NOW,
  });

  expect(r.lines.some((l) => l.includes("aipe shell-hook"))).toBe(false);
});

test("start without a home context appends nothing beyond the next steps", async () => {
  const parentDir = await mkdtemp(join(tmpdir(), "aipe-startcli-"));
  const folder = "aipe-acme-co";
  const r = await startCommand({
    parentDir,
    harness: CLAUDE_CODE_HARNESS,
    name: "Acme Co",
    runner: only(["claude"]),
    now: NOW,
  });
  // Last line is the final next-steps line — no offer leaked in without a home.
  expect(r.lines[r.lines.length - 1]).toBe(renderNextSteps(folder)[renderNextSteps(folder).length - 1]);
});
