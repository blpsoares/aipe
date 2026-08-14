# Session-mode dispatch via agentop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AIPe coordinator dispatch a specialist as a real, detached `agentop` session — each with its own context window and optional `ultracode` — while a containment gate makes it impossible for that specialist to open sessions of its own.

**Architecture:** A new `src/session/` module is the only place that knows agentop exists; it composes prompt files, assembles the `agentop session batch` argv, and classifies wave state by cross-referencing `agentop session list --json` with the journey ledger. `src/dispatch/law.ts` gains a `mode` axis and adjudicates session-specific rejections. `HarnessAdapter` gains `containmentHook()`, so the block-before-execute config is written in each harness's own format while every one of them invokes the same pure `aipe session guard` decision function.

**Tech Stack:** TypeScript (strict), Bun (runtime + `bun test` + `Bun.spawn`), `yaml` for ledger I/O. No new npm dependencies.

## Global Constraints

- **agentop is a soft dependency.** It is NOT in `package.json` — the npm package named `agentop` is an unrelated project (`ktamas77/agentop`). It is probed at runtime via `agentop --version`. Without it, AIPe behaves exactly as today and only `mode: session` is unavailable.
- **Minimum agentop version: `1.9.0`** (verified to carry `session batch`/`list` with `--json`). Declared as `MIN_AGENTOP_VERSION` in one place.
- **agentop is never executed in tests.** It is reached through an injectable `AgentopRunner`; every test passes a fake.
- **No brief content in argv, ever.** Prompts go to files under `.aipe/journeys/<id>/prompts/`; argv carries only the file path.
- **The guard decision is one pure function**, shared by every harness. Only its config wrapper differs per adapter.
- **Session cap is 4** concurrent sessions per wave (`SESSION_MAX_CONCURRENT`); the subagent cap stays at `MAX_CONCURRENT = 16`.
- **Ledger paths:** ledger file is `.aipe/journeys/<id>.yaml`; this plan adds a sibling *directory* `.aipe/journeys/<id>/` for prompts and grants. `listJourneys` filters on `.yaml`, so the directory is ignored by it — no conflict.
- **Code style:** follow the module conventions already in the repo — `run(args: string[]): Promise<number>` per CLI, the local `getFlag` helper, `OK …` / `ERROR <field>: …` / `REJECT …` output lines.

## Scope boundary

This plan delivers session-mode dispatch across **four harnesses** — Claude Code, Codex, Gemini and Copilot — each with a `containmentHook()`, plus the eligibility rule that rejects any harness without one (`antigravity`, `kimi`).

Tasks 15–17 build the three new adapters. Each begins by **re-verifying that harness's file conventions against current docs**, because a persona written to a path the harness does not read is a specialist that never receives its brief, and these CLIs move fast. Starting points, from the spec's verified table:

| Harness | Containment config | Personas / skills | Always-on context |
| --- | --- | --- | --- |
| Codex CLI | `.codex/hooks.json` (project-scoped — see below) | `.codex/skills/<slug>/SKILL.md` | `AGENTS.md` |
| Gemini CLI | `.gemini/settings.json` | `.gemini/commands/*.toml` | `GEMINI.md` |
| Copilot CLI | `.github/hooks/` | `.github/agents/<slug>.agent.md` | `AGENTS.md` |

**`ContainmentHook.relPath` is workspace-relative, and that is a requirement, not
a limitation.** A containment hook written to a harness's *global* config
(`~/.codex/hooks.json`, `~/.copilot/settings.json`) would install AIPe's
containment into every session that harness ever runs on that machine, including
ones with nothing to do with this workspace — and would survive the workspace
being deleted. Each adapter MUST therefore target its harness's **project-scoped**
hook config. If a harness turns out to support only global hooks, it is not
containable and `containmentHook()` returns `null`: it is then ineligible for
session-mode dispatch, which is exactly what the eligibility rule is for. Verify
project-scoped support as part of each adapter's Step 1.

**Two namespaces, and the mapping between them is load-bearing — fix this in
Task 16, before a second adapter exists.** AIPe identifies a harness by its
*adapter id* (`claude-code`, and soon `codex`/`gemini`/`copilot`) — that is what
the Orientation Spec approves and what the ledger's `harness` field stores.
`agentop` identifies one by its *harness name* (`claude`, `codex`, `gemini`,
`copilot`, `antigravity`, `kimi`). **`claude-code` is not `claude`.**

`dispatchCommand` in `src/session/cli.ts` currently writes the literal
`harness: "claude"` into every `BatchUnit`, ignoring the unit's recorded
`harness`. That is correct only while `claude-code` is the only containable
adapter. The moment a second one becomes eligible, a unit the PE approved for
Codex silently starts a **Claude** session — destroying the cross-model
independence that is the entire reason these adapters exist, with nothing
failing and nothing logged.

So `HarnessAdapter` gains an **`agentopHarness: string | null`** member naming
the harness agentop knows, and `dispatchCommand` resolves it from the unit's
recorded adapter id instead of using a literal. `null` means the adapter has no
agentop equivalent, which makes it not session-dispatchable for the same reason
a non-containable one is. Task 16 does this as its first step, and its tests
must include a unit whose `harness` is not `claude-code` producing the right
agentop harness name in the argv — a test the current hardcode would fail.

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/session/types.ts` | Shared types: `SessionMode`, `Intensity`, `ProbeResult`, `StartedSession`, `UnitState`, `AgentopRunner`, `MIN_AGENTOP_VERSION` |
| `src/session/runner.ts` | The injectable agentop runner (default: `Bun.spawn`) + `probe()` |
| `src/session/guard.ts` | Pure decision function: is this command a session spawn, and is it allowed? |
| `src/session/grants.ts` | Atomic on-disk grant counter, per session id |
| `src/session/prompt.ts` | Prompt composition: persona + spec slice + return contract + `ultracode` |
| `src/session/batch.ts` | `agentop session batch` argv assembly + `--json` parsing |
| `src/session/poll.ts` | Classify each unit: `landed` / `running` / `dead-silent` |
| `src/session/cli.ts` | `aipe session dispatch \| collect \| guard \| doctor` |
| `src/session/__tests__/*.test.ts` | One test file per module above |

**Modified:**

| File | Change |
| --- | --- |
| `src/dispatch/types.ts` | `mode`, `intensity`, `harness` on `DispatchEntry`; `SESSION_MAX_CONCURRENT` |
| `src/dispatch/law.ts` | Three new rejections |
| `src/harness/types.ts` | `containmentHook()` on `HarnessAdapter` |
| `src/harness/claude-code.ts` | Implement `containmentHook()`; install it in `installIntegration` |
| `src/harness/generic.ts` | `containmentHook()` returns `null` (not containable) |
| `src/journey/types.ts` | `mode`, `intensity`, `harness`, `sessionId` on `JourneyDispatch` |
| `src/journey/cli.ts` | Flags to record the four new fields |
| `src/cli.ts` | Register `session`; add the help line |
| `skills/operate/SKILL.md` | Coordinator prose for choosing and driving session mode |

---

### Task 1: agentop probe behind an injectable runner

**Files:**
- Create: `src/session/types.ts`
- Create: `src/session/runner.ts`
- Test: `src/session/__tests__/runner.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MIN_AGENTOP_VERSION: string`; `type AgentopRunner = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>`; `probe(runner?: AgentopRunner): Promise<ProbeResult>` where `ProbeResult = { present: boolean; version: string | null; ok: boolean; reason?: string }`; `realRunner: AgentopRunner`.

- [ ] **Step 1: Write the failing test**

Create `src/session/__tests__/runner.test.ts`:

```ts
import { expect, test } from "bun:test";
import { probe } from "../runner";
import type { AgentopRunner } from "../types";

const fake = (code: number, stdout: string): AgentopRunner =>
  async () => ({ code, stdout, stderr: "" });

test("a modern agentop probes ok", async () => {
  const r = await probe(fake(0, "agentop v1.9.0"));
  expect(r).toEqual({ present: true, version: "1.9.0", ok: true });
});

test("a newer agentop probes ok", async () => {
  const r = await probe(fake(0, "agentop v1.10.2"));
  expect(r.ok).toBe(true);
  expect(r.version).toBe("1.10.2");
});

test("an old agentop is present but not ok", async () => {
  const r = await probe(fake(0, "agentop v1.8.9"));
  expect(r.present).toBe(true);
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("below-minimum 1.8.9 < 1.9.0");
});

test("a missing binary is absent and not ok", async () => {
  const r = await probe(async () => { throw new Error("ENOENT"); });
  expect(r).toEqual({ present: false, version: null, ok: false, reason: "not-installed" });
});

test("unparseable version output is not ok", async () => {
  const r = await probe(fake(0, "something else entirely"));
  expect(r.present).toBe(true);
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("unreadable-version");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/session/__tests__/runner.test.ts`
Expected: FAIL — `Cannot find module '../runner'`

- [ ] **Step 3: Write the types**

Create `src/session/types.ts`:

```ts
// The one place that names the agentop contract AIPe depends on. 1.9.0 is the
// version verified to carry `session batch`/`list` with `--json`.
export const MIN_AGENTOP_VERSION = "1.9.0";

export type SessionMode = "subagent" | "session";
export type Intensity = "normal" | "ultracode";

// agentop is always reached through this, so tests never execute the binary.
export type AgentopRunner = (
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface ProbeResult {
  present: boolean;
  version: string | null;
  ok: boolean;
  reason?: string;
}

// One session agentop started, as returned by `session batch --json`.
export interface StartedSession {
  id: string;
  harness: string;
  cwd: string;
}

export type UnitPhase = "landed" | "running" | "dead-silent";

export interface UnitState {
  fqid: string; // repo or repo/package
  sessionId: string | null;
  phase: UnitPhase;
  branch: string;
  worktree: string;
}
```

- [ ] **Step 4: Write the runner**

Create `src/session/runner.ts`:

```ts
// Everything AIPe knows about invoking the agentop binary lives here.
import { MIN_AGENTOP_VERSION } from "./types";
import type { AgentopRunner, ProbeResult } from "./types";

export const realRunner: AgentopRunner = async (args) => {
  const proc = Bun.spawn(["agentop", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
};

// "1.10.2" > "1.9.0" — compare numerically per segment, never as strings.
function gte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export async function probe(runner: AgentopRunner = realRunner): Promise<ProbeResult> {
  let out: { code: number; stdout: string };
  try {
    out = await runner(["--version"]);
  } catch {
    return { present: false, version: null, ok: false, reason: "not-installed" };
  }
  if (out.code !== 0) {
    return { present: false, version: null, ok: false, reason: "not-installed" };
  }
  const m = out.stdout.match(/v?(\d+\.\d+\.\d+)/);
  if (!m) return { present: true, version: null, ok: false, reason: "unreadable-version" };
  const version = m[1]!;
  if (!gte(version, MIN_AGENTOP_VERSION)) {
    return {
      present: true,
      version,
      ok: false,
      reason: `below-minimum ${version} < ${MIN_AGENTOP_VERSION}`,
    };
  }
  return { present: true, version, ok: true };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/session/__tests__/runner.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 6: Commit**

```bash
git add src/session/types.ts src/session/runner.ts src/session/__tests__/runner.test.ts
git commit -m "feat(session): probe do agentop atrás de um runner injetável"
```

---

### Task 2: the guard decision function

**Files:**
- Create: `src/session/guard.ts`
- Test: `src/session/__tests__/guard.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `decide(input: GuardInput): GuardDecision`, where
  `GuardInput = { command: string; role: string | undefined }` and
  `GuardDecision = { action: "allow" } | { action: "deny"; reason: string } | { action: "needs-grant"; reason: string }`.
  `needs-grant` means: this IS a spawn by a specialist — the caller must consult the grant counter (Task 3) before allowing.

- [ ] **Step 1: Write the failing test**

Create `src/session/__tests__/guard.test.ts`:

```ts
import { expect, test } from "bun:test";
import { decide } from "../guard";

test("a non-specialist passes everything through", () => {
  expect(decide({ command: "agentop session batch --task x", role: undefined }).action).toBe("allow");
  expect(decide({ command: "agentop session claude -p hi", role: "coordinator" }).action).toBe("allow");
});

test("a specialist spawning a session needs a grant", () => {
  for (const cmd of [
    "agentop session claude -p 'do the thing'",
    "agentop session codex -p x",
    "agentop session batch --task y --session 'claude: z'",
    "  agentop   session   gemini  -p x",
  ]) {
    expect(decide({ command: cmd, role: "specialist" })).toEqual({
      action: "needs-grant",
      reason: "specialist-session-spawn",
    });
  }
});

test("a specialist may never kill a session", () => {
  expect(decide({ command: "agentop session kill abc", role: "specialist" })).toEqual({
    action: "deny",
    reason: "a specialist must not kill sessions",
  });
});

test("a specialist may read and annotate sessions", () => {
  for (const cmd of [
    "agentop session list --json",
    "agentop session attach abc",
    "agentop session note abc 'progress'",
    "agentop session rename abc 'label'",
  ]) {
    expect(decide({ command: cmd, role: "specialist" }).action).toBe("allow");
  }
});

test("unrelated commands are never the guard's business", () => {
  for (const cmd of ["git status", "bun test", "echo hello"]) {
    expect(decide({ command: cmd, role: "specialist" }).action).toBe("allow");
  }
});

// The guard is deliberately CONSERVATIVE: it matches the token sequence
// wherever it appears, and does not try to work out whether `agentop` sits in
// command position. Every hiding place below is ordinary shell syntax.
test("a spawn is caught wherever it hides", () => {
  for (const cmd of [
    "git status && agentop session claude -p x",
    "true; agentop session batch --task t",
    "sleep 1 & agentop session claude",
    "if true; then agentop session claude; fi",
    "for i in 1 2 3; do agentop session claude; done",
    "{ agentop session claude; }",
    "(agentop session claude)",
    "sudo agentop session claude",
    'FOO="bar baz" agentop session claude',
    "echo $(agentop session claude)",
    "echo agentop session claude",
  ]) {
    expect(decide({ command: cmd, role: "specialist" }).action).toBe("needs-grant");
  }
});

test("kill wins over a spawn appearing in the same command", () => {
  expect(decide({ command: "agentop session claude -p x; agentop session kill abc", role: "specialist" }))
    .toEqual({ action: "deny", reason: "a specialist must not kill sessions" });
  expect(decide({ command: '{ REASON="a b" agentop session kill abc; }', role: "specialist" }).action)
    .toBe("deny");
});

// Plain capitalization must never hide an invocation.
test("matching is case-insensitive", () => {
  expect(decide({ command: "AGENTOP SESSION KILL abc", role: "specialist" }).action).toBe("deny");
  expect(decide({ command: "AGENTOP SESSION CLAUDE", role: "specialist" }).action).toBe("needs-grant");
  expect(decide({ command: "agentop session claude -p x; AGENTOP SESSION KILL abc", role: "specialist" }).action).toBe("deny");
  expect(decide({ command: "AGENTOP SESSION LIST", role: "specialist" }).action).toBe("allow");
});

// An unrecognised token after `session` must fall through to needs-grant, never allow.
test("a flag-shaped token after session is not a free pass", () => {
  expect(decide({ command: "agentop session --foo claude", role: "specialist" }).action).toBe("needs-grant");
  expect(decide({ command: "agentop session -- claude", role: "specialist" }).action).toBe("needs-grant");
});

// Regression: consuming the verb let `agentop` be eaten as one match's verb and
// so miss starting the next — hiding a real kill. The lookahead prevents it.
test("a repeated token sequence cannot swallow a following kill", () => {
  expect(decide({ command: "agentop session agentop session kill x", role: "specialist" }).action).toBe("deny");
  expect(decide({ command: "agentop session agentop session agentop session kill x", role: "specialist" }).action).toBe("deny");
  expect(decide({ command: "agentop session claude -p 'ask agentop session agentop session kill x'", role: "specialist" }).action).toBe("deny");
  expect(decide({ command: "agentop session agentop session claude", role: "specialist" }).action).toBe("needs-grant");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/session/__tests__/guard.test.ts`
Expected: FAIL — `Cannot find module '../guard'`

- [ ] **Step 3: Write the implementation**

Create `src/session/guard.ts`:

```ts
// The single decision every harness's containment hook consults. Pure: no I/O,
// no env reads — the caller supplies the role, so this stays trivially testable.
//
// DELIBERATELY CONSERVATIVE. An earlier design tried to decide whether
// `agentop` sat in *command position*, so that `echo agentop session claude`
// could be waved through. Shell syntax defeated it repeatedly — brace groups,
// subshells, quoted env assignments, `$(...)`, `then`/`do` after `;` — and each
// hole silently disabled containment, one of them defeating the unconditional
// kill-deny. For a guard, a false positive is an annoyance and a false negative
// is the whole feature not existing. So: match the token sequence WHEREVER it
// appears, and accept that writing the string into an `echo` gets denied too.
// No shell parsing, no denylist of keywords, no arms race.

export interface GuardInput {
  command: string;
  role: string | undefined; // AIPE_ROLE
}

export type GuardDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "needs-grant"; reason: string };

// Sub-commands of `agentop session` that a specialist may run freely: they read
// or annotate, they never create or destroy.
const READ_ONLY = new Set(["list", "attach", "note", "rename"]);

// `i`: plain capitalization must not hide an invocation (`AGENTOP SESSION KILL`).
// `[\w-]+`: a flag-shaped token (`--foo`) is captured too — it will not be in
//   READ_ONLY, so an unrecognised token after `session` falls through to
//   needs-grant rather than silently allowing.
// Lookahead: the verb is captured WITHOUT being consumed. Consuming it lets
//   `agentop session agentop session kill x` eat the second `agentop` as a verb,
//   hiding the real `kill` from the scan — a regex-engine artifact, not a boundary.
const INVOCATION = /agentop\s+session\s+(?=([\w-]+))/gi;

export function decide(input: GuardInput): GuardDecision {
  if (input.role !== "specialist") return { action: "allow" };

  let sawSpawn = false;
  // A FRESH regex per call: the module-level one is only ever read via .source,
  // so no `lastIndex` state can leak between calls. decide() stays re-entrant.
  const re = new RegExp(INVOCATION.source, "gi");
  let m: RegExpExecArray | null;
  // Scan every occurrence: `kill` outranks a spawn appearing in the same
  // command, so a compound that does both is denied outright, not granted.
  while ((m = re.exec(input.command)) !== null) {
    const verb = m[1]!.toLowerCase();
    if (verb === "kill") {
      return { action: "deny", reason: "a specialist must not kill sessions" };
    }
    // Anything else under `session` creates one: a harness name, or `batch`.
    if (!READ_ONLY.has(verb)) sawSpawn = true;
    // Advance ONE character, so matches fully overlap and nothing is consumed.
    // Consuming lets a token that is itself part of the trigger sequence hide
    // the next match — `agentop session session session kill x` would lose its
    // kill. Each match's start index strictly increases, so this terminates.
    re.lastIndex = m.index + 1;
  }
  return sawSpawn
    ? { action: "needs-grant", reason: "specialist-session-spawn" }
    : { action: "allow" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/session/__tests__/guard.test.ts`
Expected: PASS — the full guard suite

- [ ] **Step 5: Commit**

```bash
git add src/session/guard.ts src/session/__tests__/guard.test.ts
git commit -m "feat(session): função pura de decisão do guard de contenção"
```

---

### Task 3: the atomic grant counter

**Files:**
- Create: `src/session/grants.ts`
- Test: `src/session/__tests__/grants.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `grantPath(workspaceDir, journeyId, sessionId): string`;
  `issueGrant(workspaceDir, journeyId, sessionId, count): Promise<void>`;
  `consumeGrant(workspaceDir, journeyId, sessionId): Promise<boolean>` — `true` if a unit was consumed, `false` if none remained.

Why atomic: without it, a grant of 1 lets a session spawn without bound, because every concurrent check reads the same pre-decrement value. `writeFile` with the `wx` flag is the atomic primitive here — the same approach `src/dispatch/lock.ts` uses for the per-repo claim.

- [ ] **Step 1: Write the failing test**

Create `src/session/__tests__/grants.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumeGrant, issueGrant } from "../grants";

async function ws(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-grants-"));
}

test("with no grant issued, nothing can be consumed", async () => {
  const dir = await ws();
  expect(await consumeGrant(dir, "j1", "s1")).toBe(false);
});

test("a grant of 2 is consumable exactly twice", async () => {
  const dir = await ws();
  await issueGrant(dir, "j1", "s1", 2);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(false);
});

test("grants are scoped per session", async () => {
  const dir = await ws();
  await issueGrant(dir, "j1", "s1", 1);
  expect(await consumeGrant(dir, "j1", "s2")).toBe(false);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
});

test("concurrent consumers never exceed the grant", async () => {
  const dir = await ws();
  await issueGrant(dir, "j1", "s1", 3);
  const results = await Promise.all(
    Array.from({ length: 20 }, () => consumeGrant(dir, "j1", "s1")),
  );
  expect(results.filter(Boolean).length).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/session/__tests__/grants.test.ts`
Expected: FAIL — `Cannot find module '../grants'`

- [ ] **Step 3: Write the implementation**

Create `src/session/grants.ts`:

```ts
// A grant is a quota of session spawns the coordinator hands a specialist. It is
// spent one token-file at a time: `writeFile(..., { flag: "wx" })` fails if the
// file exists, so exactly one concurrent caller can claim each token. Counting
// an integer in a file would race — two readers see "2" and both write "1".
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// These ids become path segments, so a separator or a `.`/`..` would collapse
// the per-(journey, session) isolation this module exists to provide.
function assertSafeId(label: string, id: string): void {
  if (id === "" || id === "." || id === ".." || id.includes("/") || id.includes("\\")) {
    throw new Error(`grantPath: unsafe ${label} id ${JSON.stringify(id)}`);
  }
}

function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

export function grantPath(workspaceDir: string, journeyId: string, sessionId: string): string {
  assertSafeId("journey", journeyId);
  assertSafeId("session", sessionId);
  return join(workspaceDir, ".aipe", "journeys", journeyId, "grants", sessionId);
}

export async function issueGrant(
  workspaceDir: string,
  journeyId: string,
  sessionId: string,
  count: number,
): Promise<void> {
  if (count < 0) throw new Error(`issueGrant: count must not be negative (got ${count})`);
  const dir = grantPath(workspaceDir, journeyId, sessionId);
  await mkdir(dirname(dir), { recursive: true });
  // The NON-RECURSIVE mkdir *is* the exclusivity check: it fails with EEXIST if
  // the directory exists. A read-then-write check would race — two concurrent
  // callers both pass it and both write. Never silently widen or replace a
  // grant: replacing would hand back units the specialist already spent.
  try {
    await mkdir(dir);
  } catch (err) {
    if (errorCode(err) === "EEXIST") {
      throw new Error(`issueGrant: a grant already exists for ${journeyId}/${sessionId}`);
    }
    throw err;
  }
  // Plain "w" is safe here: the mkdir above guarantees we are the only writer.
  for (let i = 0; i < count; i++) {
    await writeFile(join(dir, `token-${i}`), "", "utf8");
  }
}

export async function consumeGrant(
  workspaceDir: string,
  journeyId: string,
  sessionId: string,
): Promise<boolean> {
  const dir = grantPath(workspaceDir, journeyId, sessionId);
  let tokens: string[];
  try {
    tokens = (await readdir(dir))
      // `!endsWith(".spent")` matters: `token-0.spent` also startsWith "token-",
      // so without it a spent marker is re-listed as a claimable token and the
      // quota silently grows by one on every subsequent call.
      .filter((f) => f.startsWith("token-") && !f.endsWith(".spent"))
      // Numeric, not lexicographic: at 10+ tokens `token-10` would sort before
      // `token-2`, so claim order would stop matching issuance order.
      .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  } catch (err) {
    // Only a missing directory means "no grant issued". Anything else — EACCES,
    // ENOSPC — is a real failure and must not read as "denied".
    if (errorCode(err) === "ENOENT") return false;
    throw err;
  }
  for (const token of tokens) {
    try {
      // Claim by creating the .spent marker exclusively — the winner is whoever
      // creates it first; everyone else gets EEXIST and moves to the next token.
      await writeFile(join(dir, `${token}.spent`), "", { encoding: "utf8", flag: "wx" });
      return true;
    } catch (err) {
      if (errorCode(err) === "EEXIST") continue; // real contention
      throw err;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/session/__tests__/grants.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/session/grants.ts src/session/__tests__/grants.test.ts
git commit -m "feat(session): contador de cota atômico por sessão"
```

---

### Task 4: `aipe session guard` — the CLI the hooks call

**Files:**
- Create: `src/session/cli.ts`
- Test: `src/session/__tests__/cli-guard.test.ts`

**Interfaces:**
- Consumes: `decide` (Task 2), `consumeGrant` (Task 3).
- Produces: `guardCommand(payload: string, env: Record<string, string | undefined>): Promise<{ code: number; stdout: string }>` — the testable core; and `run(args)` as the module's CLI entry (extended in later tasks).

The hook payload is JSON on stdin, in the Claude Code / Codex shape:
`{"tool_name":"Bash","tool_input":{"command":"..."}}`. Gemini and Copilot differ in envelope but carry the same two facts; the parser reads both `tool_name`/`toolName` and `tool_input.command`/`toolInput.command`.

Output on deny is the shape all four harnesses accept:
```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}
```
Allow prints nothing and exits 0 — every harness treats silence as "fall through to normal permission handling".

- [ ] **Step 1: Write the failing test**

Create `src/session/__tests__/cli-guard.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardCommand } from "../cli";
import { issueGrant } from "../grants";

const payload = (command: string) =>
  JSON.stringify({ tool_name: "Bash", tool_input: { command } });

test("a coordinator is never blocked", async () => {
  const r = await guardCommand(payload("agentop session batch --task t"), {});
  expect(r.code).toBe(0);
  expect(r.stdout).toBe("");
});

test("a specialist without a grant is denied, with a reason", async () => {
  const r = await guardCommand(payload("agentop session claude -p x"), {
    AIPE_ROLE: "specialist",
  });
  expect(r.code).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(out.hookSpecificOutput.permissionDecisionReason).toContain("not permitted");
});

test("a specialist with a grant is allowed, and the grant is spent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-guardcli-"));
  await issueGrant(dir, "j1", "s1", 1);
  const env = {
    AIPE_ROLE: "specialist",
    AIPE_WORKSPACE: dir,
    AIPE_JOURNEY: "j1",
    AGENTOP_SESSION_ID: "s1",
  };
  const first = await guardCommand(payload("agentop session claude -p x"), env);
  expect(first.stdout).toBe("");

  const second = await guardCommand(payload("agentop session claude -p y"), env);
  expect(JSON.parse(second.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
});

test("killing a session is denied even with a grant", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-guardcli-"));
  await issueGrant(dir, "j1", "s1", 5);
  const r = await guardCommand(payload("agentop session kill other"), {
    AIPE_ROLE: "specialist",
    AIPE_WORKSPACE: dir,
    AIPE_JOURNEY: "j1",
    AGENTOP_SESSION_ID: "s1",
  });
  expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason).toContain("kill");
});

test("an unparseable payload fails open, never blocking real work", async () => {
  const r = await guardCommand("not json", { AIPE_ROLE: "specialist" });
  expect(r.code).toBe(0);
  expect(r.stdout).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/session/__tests__/cli-guard.test.ts`
Expected: FAIL — `Cannot find module '../cli'`

- [ ] **Step 3: Write the implementation**

Create `src/session/cli.ts`:

```ts
#!/usr/bin/env bun
// `aipe session <dispatch|collect|guard|doctor>`.
import { decide } from "./guard";
import { consumeGrant } from "./grants";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function denyJson(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

// Reads the command out of any of the four harnesses' hook payload shapes.
function readCommand(payload: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const r = parsed as Record<string, any>;
  const input = r.tool_input ?? r.toolInput ?? r.input;
  const command = input?.command;
  return typeof command === "string" ? command : null;
}

export async function guardCommand(
  payload: string,
  env: Record<string, string | undefined>,
): Promise<{ code: number; stdout: string }> {
  const command = readCommand(payload);
  // Fail open: a guard that cannot read the payload must not block real work.
  // Containment is a guardrail against drift, and a guardrail that breaks the
  // agent is worse than the drift it prevents.
  if (command === null) return { code: 0, stdout: "" };

  const decision = decide({ command, role: env.AIPE_ROLE });
  if (decision.action === "allow") return { code: 0, stdout: "" };
  if (decision.action === "deny") return { code: 0, stdout: denyJson(decision.reason) };

  const workspace = env.AIPE_WORKSPACE;
  const journey = env.AIPE_JOURNEY;
  const sessionId = env.AGENTOP_SESSION_ID;
  if (workspace && journey && sessionId && (await consumeGrant(workspace, journey, sessionId))) {
    return { code: 0, stdout: "" };
  }
  return {
    code: 0,
    stdout: denyJson(
      "Opening agentop sessions is not permitted for a specialist. Ask the coordinator for a grant if a sub-session is genuinely required.",
    ),
  };
}

async function guard(): Promise<number> {
  const payload = await new Response(Bun.stdin.stream()).text();
  const { code, stdout } = await guardCommand(payload, process.env);
  if (stdout) console.log(stdout);
  return code;
}

const HELP = [
  "aipe session — dispatch specialists as real agentop sessions",
  "",
  "  dispatch --journey <id> [--workspace <dir>]   Start the wave's session-mode units",
  "  collect  --journey <id> [--timeout <s>] [--workspace <dir>]",
  "  doctor                                        Report agentop availability",
  "  guard                                         (internal) containment hook decision",
].join("\n");

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "guard":
      return guard();
    default:
      console.log(HELP);
      return sub === undefined || sub === "--help" ? 0 : 1;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/session/__tests__/cli-guard.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/session/cli.ts src/session/__tests__/cli-guard.test.ts
git commit -m "feat(session): subcomando guard que os hooks de contenção chamam"
```

---

### Task 5: `containmentHook()` on the harness adapter

**Files:**
- Modify: `src/harness/types.ts`
- Modify: `src/harness/claude-code.ts:19-55` and `:63-82`
- Modify: `src/harness/generic.ts`
- Test: `src/session/__tests__/containment.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: on `HarnessAdapter`, `containmentHook(): ContainmentHook | null`, where
  `ContainmentHook = { relPath: string; merge: (existing: unknown) => unknown }`.
  `null` means the harness cannot be contained and is therefore **not eligible** for `mode: session`.
  Also exports `isContainable(adapter): boolean`.

A golden fixture asserts the exact rendered config. A silently malformed hook is the worst failure available here: it looks installed and denies nothing.

- [ ] **Step 1: Write the failing test**

Create `src/session/__tests__/containment.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../../harness/claude-code";
import { genericAdapter } from "../../harness/generic";
import { isContainable } from "../../harness/types";

test("claude-code is containable and renders the PreToolUse hook", () => {
  const hook = claudeCodeAdapter.containmentHook();
  expect(hook).not.toBeNull();
  expect(hook!.relPath).toBe(join(".claude", "settings.json"));
  expect(hook!.merge({})).toEqual({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "aipe session guard" }],
        },
      ],
    },
  });
});

test("merging is idempotent and preserves foreign settings", () => {
  const hook = claudeCodeAdapter.containmentHook()!;
  const once = hook.merge({ model: "opus", hooks: { SessionStart: [{ matcher: "startup" }] } });
  const twice = hook.merge(once);
  expect(twice).toEqual(once);
  expect((twice as any).model).toBe("opus");
  expect((twice as any).hooks.SessionStart).toHaveLength(1);
  expect((twice as any).hooks.PreToolUse).toHaveLength(1);
});

test("the generic adapter is not containable", () => {
  expect(genericAdapter.containmentHook()).toBeNull();
  expect(isContainable(genericAdapter)).toBe(false);
  expect(isContainable(claudeCodeAdapter)).toBe(true);
});

test("installIntegration writes the containment hook to disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-containment-"));
  await claudeCodeAdapter.installIntegration(dir);
  const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
  expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("aipe session guard");
  expect(JSON.stringify(settings.hooks.SessionStart)).toContain("aipe session-context");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/session/__tests__/containment.test.ts`
Expected: FAIL — `claudeCodeAdapter.containmentHook is not a function`

- [ ] **Step 3: Extend the adapter interface**

In `src/harness/types.ts`, add above `HarnessAdapter`:

```ts
// How a harness is told to block a command before it runs. `relPath` is the
// config file, relative to the workspace; `merge` folds the containment rule
// into that file's existing contents, idempotently.
//
// A harness whose adapter returns null cannot be contained — and is therefore
// NOT eligible for session-mode dispatch. That is the whole eligibility rule:
// AIPe never starts a session it cannot govern.
export interface ContainmentHook {
  relPath: string;
  merge: (existing: unknown) => unknown;
}
```

Add to the `HarnessAdapter` interface, after `startupDelivery`:

```ts
  containmentHook(): ContainmentHook | null;
```

And at the end of the file:

```ts
export function isContainable(adapter: HarnessAdapter): boolean {
  return adapter.containmentHook() !== null;
}
```

- [ ] **Step 4: Implement it for claude-code**

In `src/harness/claude-code.ts`, add after the `SESSION_START_HOOK` constant (line 22):

```ts
const CONTAINMENT_COMMAND = "aipe session guard";

const PRE_TOOL_USE_HOOK = {
  matcher: "Bash",
  hooks: [{ type: "command", command: CONTAINMENT_COMMAND }],
};
```

Add to the `claudeCodeAdapter` object, after `startupDelivery`:

```ts
  containmentHook(): ContainmentHook {
    return {
      relPath: join(".claude", "settings.json"),
      merge(existing: unknown): unknown {
        const settings: Settings =
          existing && typeof existing === "object" ? { ...(existing as Settings) } : {};
        const hooks = { ...(settings.hooks ?? {}) };
        const list = Array.isArray(hooks.PreToolUse) ? [...hooks.PreToolUse] : [];
        const already = list.some((e) => JSON.stringify(e).includes(CONTAINMENT_COMMAND));
        if (!already) list.push(PRE_TOOL_USE_HOOK);
        hooks.PreToolUse = list;
        settings.hooks = hooks;
        return settings;
      },
    };
  },
```

Update the `Settings` interface (line 24) so `PreToolUse` is known:

```ts
interface Settings {
  hooks?: { SessionStart?: unknown[]; PreToolUse?: unknown[]; [k: string]: unknown };
  [k: string]: unknown;
}
```

Import the new type at the top:

```ts
import type { ContainmentHook, HarnessAdapter, InstallReport, PersonaMeta, PersonaRole, StartupDelivery } from "./types";
```

Then wire it into `ensureSessionStartHook` so installation writes both hooks in one pass — replace the body of `ensureSessionStartHook` (lines 44-55) with:

```ts
export async function ensureSessionStartHook(targetDir: string): Promise<void> {
  const claudeDir = join(targetDir, ".claude");
  const settingsPath = join(claudeDir, "settings.json");
  await mkdir(claudeDir, { recursive: true });

  const settings = await readSettings(settingsPath);
  settings.hooks ??= {};
  const sessionStart = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : [];
  if (!hasAipeHook(sessionStart)) sessionStart.push(SESSION_START_HOOK);
  settings.hooks.SessionStart = sessionStart;

  const merged = claudeCodeAdapter.containmentHook()!.merge(settings);
  await writeFile(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}
```

Also add the note to the returned `InstallReport` in `installIntegration` — replace its `notes` array with:

```ts
      notes: [
        "SessionStart hook → aipe session-context",
        "PreToolUse hook → aipe session guard (containment)",
        `${Object.keys(FLOW_SKILLS).length} AIPe skills installed`,
      ],
```

- [ ] **Step 5: Declare the generic adapter not containable**

In `src/harness/generic.ts`, add to the adapter object after `startupDelivery`:

```ts
  // A harness AIPe drives only through files has no block-before-execute
  // mechanism, so it can never be trusted to hold a specialist inside its lane.
  containmentHook(): null {
    return null;
  },
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test src/session/__tests__/containment.test.ts && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — 4 tests, and no type errors

- [ ] **Step 7: Run the full suite — installIntegration changed**

Run: `bun test`
Expected: PASS — no regressions in the harness/hire-specialists/start suites

- [ ] **Step 8: Commit**

```bash
git add src/harness/types.ts src/harness/claude-code.ts src/harness/generic.ts src/session/__tests__/containment.test.ts
git commit -m "feat(harness): containmentHook() por adapter + regra de elegibilidade"
```

---

### Task 6: ledger fields for session dispatches

**Files:**
- Modify: `src/journey/types.ts:49-67`
- Modify: `src/journey/cli.ts` (the `record` subcommand's flag parsing)
- Test: `src/session/__tests__/ledger-fields.test.ts`

**Interfaces:**
- Consumes: `recordDispatch` from `src/journey/ledger.ts`.
- Produces: `JourneyDispatch` gains `mode?: SessionMode`, `intensity?: Intensity`, `harness?: string`, `sessionId?: string`. New `aipe journey record` flags: `--mode`, `--intensity`, `--harness`, `--session-id`.

- [ ] **Step 1: Write the failing test**

Create `src/session/__tests__/ledger-fields.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/session/__tests__/ledger-fields.test.ts`
Expected: FAIL — TypeScript rejects `mode`/`intensity`/`harness`/`sessionId` on `JourneyDispatch`

- [ ] **Step 3: Extend the ledger type**

In `src/journey/types.ts`, add to `JourneyDispatch` after `model?: string;`:

```ts
  // Session-mode dispatch (absent on subagent dispatches and legacy ledgers).
  // `sessionId` is what `aipe session collect` cross-references against
  // `agentop session list --json` to tell "still working" from "died silently".
  mode?: "subagent" | "session";
  intensity?: "normal" | "ultracode";
  harness?: string;
  sessionId?: string;
```

- [ ] **Step 4: Add the record flags**

In `src/journey/cli.ts`, find where the `record` subcommand builds its `JourneyDispatch` and add the four optional fields alongside the existing `--tier`/`--model` handling:

```ts
    ...(getFlag(args, "--mode") ? { mode: getFlag(args, "--mode") as "subagent" | "session" } : {}),
    ...(getFlag(args, "--intensity") ? { intensity: getFlag(args, "--intensity") as "normal" | "ultracode" } : {}),
    ...(getFlag(args, "--harness") ? { harness: getFlag(args, "--harness")! } : {}),
    ...(getFlag(args, "--session-id") ? { sessionId: getFlag(args, "--session-id")! } : {}),
```

Add the flags to that subcommand's usage/help text next to `--tier`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/session/__tests__/ledger-fields.test.ts && bun test src/journey`
Expected: PASS — 2 new tests, journey suite unchanged

- [ ] **Step 6: Commit**

```bash
git add src/journey/types.ts src/journey/cli.ts src/session/__tests__/ledger-fields.test.ts
git commit -m "feat(journey): campos mode/intensity/harness/sessionId no ledger"
```

---

### Task 7: the dispatch law learns about session mode

**Files:**
- Modify: `src/dispatch/types.ts`
- Modify: `src/dispatch/law.ts:5-40`
- Test: `src/dispatch/__tests__/session-mode.test.ts`

**Interfaces:**
- Consumes: `ProbeResult` (Task 1), `isContainable` (Task 5).
- Produces: `DispatchEntry` gains `mode?`, `intensity?`, `harness?`; `SESSION_MAX_CONCURRENT = 4`; `validateBatch(batch, knownRepos, roster, sessionCtx?)` where
  `SessionContext = { agentopOk: boolean; containableHarnesses: string[] }`.
  New rejects: `agentop-unavailable`, `session-cap-exceeded <n>`, `harness-not-containable <id>`.

Passing `sessionCtx` as an optional fourth argument keeps every existing caller and test compiling unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/dispatch/__tests__/session-mode.test.ts`:

```ts
import { expect, test } from "bun:test";
import { validateBatch } from "../law";
import type { PersonaRegistryEntry } from "../types";

const roster: PersonaRegistryEntry[] = [
  { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" },
  { name: "Marina", role: "qa", repo: "embark", path: "./embark/.claude/skills/marina" },
  { name: "Pedro", role: "dev-fullstack", repo: "prontuario", path: "./prontuario/.claude/skills/pedro" },
];
const repos = ["embark", "prontuario"];
const ctx = { agentopOk: true, containableHarnesses: ["claude-code"] };

test("a session-mode batch passes when agentop is ok and the harness is containable", () => {
  const v = validateBatch(
    [{ repo: "embark", specialist: "Joaquim", mode: "session", harness: "claude-code" }],
    repos,
    roster,
    ctx,
  );
  expect(v.ok).toBe(true);
});

test("session mode is rejected when agentop is unavailable", () => {
  const v = validateBatch(
    [{ repo: "embark", specialist: "Joaquim", mode: "session" }],
    repos,
    roster,
    { agentopOk: false, containableHarnesses: ["claude-code"] },
  );
  expect(v.ok).toBe(false);
  expect(v.ok === false && v.rejects).toContain("agentop-unavailable");
});

test("subagent mode is unaffected by agentop being unavailable", () => {
  const v = validateBatch(
    [{ repo: "embark", specialist: "Joaquim" }],
    repos,
    roster,
    { agentopOk: false, containableHarnesses: [] },
  );
  expect(v.ok).toBe(true);
});

test("a non-containable harness is rejected", () => {
  const v = validateBatch(
    [{ repo: "embark", specialist: "Joaquim", mode: "session", harness: "kimi" }],
    repos,
    roster,
    ctx,
  );
  expect(v.ok === false && v.rejects).toContain("harness-not-containable kimi");
});

test("more than four session-mode units is rejected, while 16 subagents pass", () => {
  const five = ["a", "b", "c", "d", "e"].map((p) => ({
    repo: "embark",
    package: p,
    specialist: "Joaquim",
    mode: "session" as const,
    harness: "claude-code",
  }));
  const v = validateBatch(five, repos, roster, ctx);
  expect(v.ok === false && v.rejects).toContain("session-cap-exceeded 5");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/dispatch/__tests__/session-mode.test.ts`
Expected: FAIL — TypeScript rejects `mode` on `DispatchEntry`

- [ ] **Step 3: Extend the dispatch types**

In `src/dispatch/types.ts`, replace `DispatchEntry` and add the cap:

```ts
export interface DispatchEntry {
  repo: string;
  specialist: string;
  package?: string; // the unit within the repo; absent ⇒ the implicit whole-repo package
  tier?: string;
  // How this unit is dispatched. `subagent` (default) is an in-process subagent
  // that returns evidence synchronously; `session` is a real, detached agentop
  // session that records into the ledger instead of returning.
  mode?: "subagent" | "session";
  intensity?: "normal" | "ultracode";
  harness?: string; // defaults to the workspace harness
}

export const MAX_CONCURRENT = 16;

// Session mode's own, far lower ceiling. 16 was calibrated for subagents; 16
// real sessions — each with its own context window, some fanning out under
// ultracode — is a different order of cost entirely.
export const SESSION_MAX_CONCURRENT = 4;

export interface SessionContext {
  agentopOk: boolean;
  containableHarnesses: string[];
}
```

- [ ] **Step 4: Extend the law**

In `src/dispatch/law.ts`, update the import and signature:

```ts
import { MAX_CONCURRENT, SESSION_MAX_CONCURRENT } from "./types";
import type { Batch, PersonaRegistryEntry, SessionContext, Verdict } from "./types";

export function validateBatch(
  batch: Batch,
  knownRepos: string[],
  roster: PersonaRegistryEntry[],
  session?: SessionContext,
): Verdict {
```

Immediately after the existing `if (batch.length > MAX_CONCURRENT)` block, add:

```ts
  const sessionEntries = batch.filter((e) => e.mode === "session");
  if (sessionEntries.length > 0) {
    if (sessionEntries.length > SESSION_MAX_CONCURRENT) {
      rejects.push(`session-cap-exceeded ${sessionEntries.length}`);
    }
    if (session && !session.agentopOk) {
      rejects.push("agentop-unavailable");
    }
    if (session) {
      const containable = new Set(session.containableHarnesses);
      const seenHarness = new Set<string>();
      for (const entry of sessionEntries) {
        const harness = entry.harness ?? session.containableHarnesses[0] ?? "claude-code";
        if (containable.has(harness) || seenHarness.has(harness)) continue;
        seenHarness.add(harness);
        rejects.push(`harness-not-containable ${harness}`);
      }
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/dispatch && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — 5 new tests plus the existing law/lock/cli suites, no type errors

- [ ] **Step 6: Write the failing test for the CLI wiring**

The law now understands `mode`, but `aipe dispatch validate` still strips it: `parseBatch` in `src/dispatch/cli.ts:23-33` rebuilds each entry from `{repo, specialist, package}` only, and `validateBatch` is called with three arguments. Without this step the new rejections are unreachable from the real CLI.

Add to `src/dispatch/__tests__/session-mode.test.ts`:

```ts
import { buildSessionContext, parseBatch } from "../cli";

test("parseBatch preserves the session envelope", () => {
  const batch = parseBatch([
    { repo: "embark", specialist: "Joaquim", mode: "session", intensity: "ultracode", harness: "claude-code" },
  ]);
  expect(batch![0]).toEqual({
    repo: "embark",
    specialist: "Joaquim",
    mode: "session",
    intensity: "ultracode",
    harness: "claude-code",
  });
});

test("parseBatch rejects an unknown mode rather than silently downgrading it", () => {
  expect(parseBatch([{ repo: "embark", specialist: "Joaquim", mode: "telepathy" }])).toBeNull();
});

test("buildSessionContext reports only containable harnesses", async () => {
  const ctx = await buildSessionContext(async () => ({ code: 0, stdout: "agentop v1.9.0", stderr: "" }));
  expect(ctx.agentopOk).toBe(true);
  expect(ctx.containableHarnesses).toEqual(["claude-code"]);
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `bun test src/dispatch/__tests__/session-mode.test.ts`
Expected: FAIL — `parseBatch` and `buildSessionContext` are not exported

- [ ] **Step 8: Wire the dispatch CLI**

In `src/dispatch/cli.ts`, add the imports:

```ts
import { isContainable } from "../harness/types";
import { getAdapter } from "../harness/registry";
import { probe } from "../session/runner";
import { realRunner } from "../session/runner";
import type { AgentopRunner } from "../session/types";
import type { SessionContext } from "./types";
```

Export `parseBatch` and carry the envelope through it — replace its loop body:

```ts
export function parseBatch(value: unknown): Batch | null {
  if (!Array.isArray(value)) return null;
  const batch: DispatchEntry[] = [];
  for (const e of value) {
    if (typeof e !== "object" || e === null) return null;
    const r = e as Record<string, unknown>;
    if (typeof r.repo !== "string" || typeof r.specialist !== "string") return null;
    // An unrecognised mode/intensity is a REJECT, never a silent downgrade to
    // the default: a typo'd "session" must not quietly run as a subagent.
    if (r.mode !== undefined && r.mode !== "subagent" && r.mode !== "session") return null;
    if (r.intensity !== undefined && r.intensity !== "normal" && r.intensity !== "ultracode") return null;
    batch.push({
      repo: r.repo,
      specialist: r.specialist,
      ...(typeof r.package === "string" ? { package: r.package } : {}),
      ...(typeof r.tier === "string" ? { tier: r.tier } : {}),
      ...(r.mode !== undefined ? { mode: r.mode as "subagent" | "session" } : {}),
      ...(r.intensity !== undefined ? { intensity: r.intensity as "normal" | "ultracode" } : {}),
      ...(typeof r.harness === "string" ? { harness: r.harness } : {}),
    });
  }
  return batch;
}
```

Add the context builder next to it:

```ts
// Which harnesses AIPe may start a session on: exactly those whose adapter can
// install a containment hook. Everything else is unreachable by construction.
const KNOWN_HARNESSES = ["claude-code", "generic"];

export async function buildSessionContext(
  runner: AgentopRunner = realRunner,
): Promise<SessionContext> {
  const probed = await probe(runner);
  return {
    agentopOk: probed.ok,
    containableHarnesses: KNOWN_HARNESSES.filter((id) => isContainable(getAdapter(id))),
  };
}
```

In `validateCommand`, build the context only when the batch actually asks for it — probing costs a subprocess, and a pure subagent batch must not pay for it:

```ts
  const sessionCtx = batch.some((e) => e.mode === "session")
    ? await buildSessionContext()
    : undefined;
  const verdict = validateBatch(batch, knownRepos, roster, sessionCtx);
```

(Replace the existing `validateBatch(batch, knownRepos, roster)` call; leave the surrounding REJECT-printing logic untouched.)

- [ ] **Step 9: Run test to verify it passes**

Run: `bun test src/dispatch && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — 8 tests in the session-mode file, existing dispatch suites unchanged

- [ ] **Step 10: Commit**

```bash
git add src/dispatch/types.ts src/dispatch/law.ts src/dispatch/cli.ts src/dispatch/__tests__/session-mode.test.ts
git commit -m "feat(dispatch): eixo de modo na lei, teto de sessão e elegibilidade de harness"
```

---

### Task 8: prompt composition

**Files:**
- Create: `src/session/prompt.ts`
- Test: `src/session/__tests__/prompt.test.ts`

**Interfaces:**
- Consumes: `Intensity` (Task 1).
- Produces:
  ```ts
  interface PromptInput {
    personaBody: string;
    specSlice: string;
    worktree: string;
    packagePath: string | null;
    branch: string;
    journeyId: string;
    workspace: string;
    fqid: string;
    intensity: Intensity;
  }
  composePrompt(input: PromptInput): string
  ```

Two properties matter and are asserted: the `ultracode` keyword appears if and only if `intensity === "ultracode"`, and the contract names no harness-specific construct (no `/`-prefixed slash commands) — a Codex or Gemini session has no `/verify-before-done`.

- [ ] **Step 1: Write the failing test**

Create `src/session/__tests__/prompt.test.ts`:

```ts
import { expect, test } from "bun:test";
import { composePrompt } from "../prompt";

const base = {
  personaBody: "You are Joaquim, the embark fullstack specialist.",
  specSlice: "## Scope\nFix the token store.\n## Acceptance\nTests green.",
  worktree: "/w/.worktrees/j1-joaquim",
  packagePath: null,
  branch: "aipe/j1/joaquim",
  journeyId: "j1",
  workspace: "/w",
  fqid: "embark",
  intensity: "normal" as const,
};

test("the prompt carries persona, spec slice and the return contract", () => {
  const p = composePrompt(base);
  expect(p).toContain("You are Joaquim");
  expect(p).toContain("Fix the token store.");
  expect(p).toContain("aipe journey record");
  expect(p).toContain("--journey j1");
  expect(p).toContain("/w/.worktrees/j1-joaquim");
  expect(p).toContain("aipe/j1/joaquim");
});

test("ultracode appears if and only if the intensity says so", () => {
  expect(composePrompt(base)).not.toContain("ultracode");
  expect(composePrompt({ ...base, intensity: "ultracode" })).toContain("ultracode");
});

test("the prompt names no harness-specific slash command", () => {
  const p = composePrompt({ ...base, intensity: "ultracode" });
  expect(p).not.toMatch(/(^|\s)\/[a-z][a-z-]+/);
});

test("the containment rule is stated, not only enforced", () => {
  const p = composePrompt(base);
  expect(p).toContain("must not open");
  expect(p).toContain("agentop session list");
});

test("a monorepo package narrows the stated lane", () => {
  const p = composePrompt({ ...base, packagePath: "packages/api", fqid: "embark/api" });
  expect(p).toContain("packages/api");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/session/__tests__/prompt.test.ts`
Expected: FAIL — `Cannot find module '../prompt'`

- [ ] **Step 3: Write the implementation**

Create `src/session/prompt.ts`:

```ts
// Composes what a dispatched session is told. A detached session gets no second
// question from the PE, so this text is its entire world: identity, scope, and
// the contract that replaces a subagent's return value.
import type { Intensity } from "./types";

export interface PromptInput {
  personaBody: string;
  specSlice: string;
  worktree: string;
  packagePath: string | null;
  branch: string;
  journeyId: string;
  workspace: string;
  fqid: string;
  intensity: Intensity;
}

export function composePrompt(input: PromptInput): string {
  const lane = input.packagePath
    ? `${input.worktree} — and within it, stay inside ${input.packagePath}`
    : input.worktree;

  const parts: string[] = [];

  if (input.intensity === "ultracode") {
    // The opt-in is a keyword in the prompt; there is no CLI flag for it.
    parts.push("ultracode");
  }

  parts.push(input.personaBody.trim());
  parts.push(`# Your assignment (${input.fqid})\n\n${input.specSlice.trim()}`);

  // Every step below is phrased as an outcome or as an `aipe` subcommand, never
  // as a slash command — a Codex or Gemini session has no `/verify-before-done`.
  parts.push(
    [
      "# How you must work",
      "",
      `- Operate strictly inside ${lane}. Never touch anything outside it.`,
      "- Check `aipe skill match --task-type <type> --size <size>` first; if an SDD kit matches, derive a short package spec + plan and commit it alongside the code.",
      "- Work test-first.",
      "- Verify before claiming done, and gather the evidence: the commands you ran and what their output showed.",
      `- Push \`${input.branch}\` and open a PR.`,
      "",
      "# How you report back",
      "",
      "You are a detached session: nothing you return is read by anyone. The journey ledger is the only channel. Before you stop, record your result:",
      "",
      "```bash",
      `aipe journey record --journey ${input.journeyId} --workspace ${input.workspace} \\`,
      `  --repo <repo> --specialist <you> --branch ${input.branch} --worktree ${input.worktree} \\`,
      "  --status delivered --pr <url> \\",
      '  --evidence-cmd "<command you ran>" --evidence-summary "<what its output showed>"',
      "```",
      "",
      "A `delivered` without evidence is REJECTed by the ledger — that is deliberate. If the assignment is not answerable as written, record `--status escalated` with the reason instead of guessing.",
      "",
      "# Your relationship to agentop",
      "",
      "You are a specialist (`AIPE_ROLE=specialist`). You **must not open** a new agentop session, and you must not kill any session — that authority belongs to the coordinator alone, and a hook enforces it.",
      "You may read: `agentop session list`, `attach`, `note`, `rename` — including to orient yourself about the sibling sessions filed under this journey's task.",
    ].join("\n"),
  );

  return `${parts.join("\n\n---\n\n")}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/session/__tests__/prompt.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/session/prompt.ts src/session/__tests__/prompt.test.ts
git commit -m "feat(session): composição do prompt com contrato de retorno harness-neutro"
```

---

### Task 9: batch argv assembly and `--json` parsing

**Files:**
- Create: `src/session/batch.ts`
- Test: `src/session/__tests__/batch.test.ts`

**Interfaces:**
- Consumes: `AgentopRunner`, `StartedSession` (Task 1).
- Produces:
  ```ts
  interface BatchUnit { harness: string; cwd: string; promptFile: string; model?: string }
  buildBatchArgs(task: string, units: BatchUnit[]): string[]
  parseBatchOutput(stdout: string): StartedSession[]
  startBatch(task: string, units: BatchUnit[], runner: AgentopRunner): Promise<StartedSession[]>
  ```

The prompt reaches agentop as `@<file>` — a path, never inlined text. The test asserts this directly: brief content must never appear in argv.

- [ ] **Step 1: Write the failing test**

Create `src/session/__tests__/batch.test.ts`:

```ts
import { expect, test } from "bun:test";
import { buildBatchArgs, parseBatchOutput, startBatch } from "../batch";
import type { AgentopRunner } from "../types";

const units = [
  { harness: "claude", cwd: "/w/.worktrees/j1-joaquim", promptFile: "/w/.aipe/journeys/j1/prompts/embark.md" },
  { harness: "claude", cwd: "/w/.worktrees/j1-pedro", promptFile: "/w/.aipe/journeys/j1/prompts/prontuario.md" },
];

test("the argv files every session under one task and asks for json", () => {
  const args = buildBatchArgs("aipe/j1", units);
  expect(args.slice(0, 4)).toEqual(["session", "batch", "--task", "aipe/j1"]);
  expect(args).toContain("--json");
  expect(args.filter((a) => a === "--session")).toHaveLength(2);
});

test("each session is addressed as harness@cwd with a prompt FILE", () => {
  const args = buildBatchArgs("aipe/j1", units);
  expect(args).toContain("claude@/w/.worktrees/j1-joaquim: @/w/.aipe/journeys/j1/prompts/embark.md");
});

test("no brief content ever reaches argv", () => {
  const args = buildBatchArgs("aipe/j1", [
    { harness: "claude", cwd: "/w/wt", promptFile: "/w/.aipe/journeys/j1/prompts/embark.md" },
  ]);
  for (const arg of args) {
    expect(arg).not.toContain("You are");
    expect(arg).not.toContain("\n");
  }
});

test("a per-unit model is passed through", () => {
  const args = buildBatchArgs("aipe/j1", [
    { harness: "claude", cwd: "/w/wt", promptFile: "/p.md", model: "claude-opus-4-8" },
  ]);
  expect(args).toContain("--model");
  expect(args).toContain("claude-opus-4-8");
});

test("json output is parsed into started sessions", () => {
  const out = JSON.stringify({
    sessions: [
      { id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" },
      { id: "s-2", harness: "claude", cwd: "/w/.worktrees/j1-pedro" },
    ],
  });
  expect(parseBatchOutput(out)).toEqual([
    { id: "s-1", harness: "claude", cwd: "/w/.worktrees/j1-joaquim" },
    { id: "s-2", harness: "claude", cwd: "/w/.worktrees/j1-pedro" },
  ]);
});

test("a bare json array is accepted too", () => {
  const out = JSON.stringify([{ id: "s-1", harness: "claude", cwd: "/x" }]);
  expect(parseBatchOutput(out)).toHaveLength(1);
});

test("startBatch surfaces a non-zero exit as an error", async () => {
  const failing: AgentopRunner = async () => ({ code: 1, stdout: "", stderr: "boom" });
  await expect(startBatch("aipe/j1", units, failing)).rejects.toThrow("boom");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/session/__tests__/batch.test.ts`
Expected: FAIL — `Cannot find module '../batch'`

- [ ] **Step 3: Write the implementation**

Create `src/session/batch.ts`:

```ts
// Assembles and runs the single `agentop session batch` that starts a wave.
import type { AgentopRunner, StartedSession } from "./types";

export interface BatchUnit {
  harness: string;
  cwd: string;
  promptFile: string;
  model?: string;
}

// The prompt is handed over as `@<file>`. Inlining a 40-line brief into an argv
// string is a quoting bug waiting to happen, and it would leak the whole brief
// into every process listing.
export function buildBatchArgs(task: string, units: BatchUnit[]): string[] {
  const args = ["session", "batch", "--task", task, "--json"];
  for (const unit of units) {
    if (unit.model) args.push("--model", unit.model);
    args.push("--session", `${unit.harness}@${unit.cwd}: @${unit.promptFile}`);
  }
  return args;
}

export function parseBatchOutput(stdout: string): StartedSession[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as any).sessions)
      ? (parsed as any).sessions
      : [];
  const sessions: StartedSession[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    sessions.push({
      id: r.id,
      harness: typeof r.harness === "string" ? r.harness : "claude",
      cwd: typeof r.cwd === "string" ? r.cwd : "",
    });
  }
  return sessions;
}

export async function startBatch(
  task: string,
  units: BatchUnit[],
  runner: AgentopRunner,
): Promise<StartedSession[]> {
  const result = await runner(buildBatchArgs(task, units));
  if (result.code !== 0) {
    throw new Error(result.stderr || `agentop session batch failed (code ${result.code})`);
  }
  return parseBatchOutput(result.stdout);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/session/__tests__/batch.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/session/batch.ts src/session/__tests__/batch.test.ts
git commit -m "feat(session): montagem do argv do batch e parsing do --json"
```

---

### Task 10: wave-state classification

**Files:**
- Create: `src/session/poll.ts`
- Test: `src/session/__tests__/poll.test.ts`

**Interfaces:**
- Consumes: `AgentopRunner`, `UnitState`, `UnitPhase` (Task 1); `JourneyLedger` from `src/journey/types.ts`.
- Produces: `parseSessionList(stdout: string): Set<string>` (ids of live sessions);
  `classify(ledger: JourneyLedger, live: Set<string>): UnitState[]`;
  `pollOnce(workspaceDir, journeyId, runner): Promise<UnitState[]>`.

The three phases: `landed` (a `delivered`/`verified`/`merged` record exists), `running` (session id still in agentop's live list), `dead-silent` (session gone, nothing recorded). The third is the failure mode session dispatch introduces and subagent dispatch never had.

- [ ] **Step 1: Write the failing test**

Create `src/session/__tests__/poll.test.ts`:

```ts
import { expect, test } from "bun:test";
import { classify, parseSessionList } from "../poll";
import type { JourneyLedger } from "../../journey/types";

const ledger: JourneyLedger = {
  id: "j1",
  dispatches: [
    { repo: "embark", specialist: "Joaquim", branch: "b1", worktree: "w1", status: "delivered", mode: "session", sessionId: "s-1",
      evidence: { by: "dev", commands: ["bun test"], summary: "green" } },
    { repo: "prontuario", specialist: "Pedro", branch: "b2", worktree: "w2", status: "dispatched", mode: "session", sessionId: "s-2" },
    { repo: "outro", specialist: "Ana", branch: "b3", worktree: "w3", status: "dispatched", mode: "session", sessionId: "s-3" },
  ],
};

test("live session ids are read out of agentop's json", () => {
  const out = JSON.stringify({ sessions: [{ id: "s-2" }, { id: "s-9" }] });
  expect(parseSessionList(out)).toEqual(new Set(["s-2", "s-9"]));
});

test("a recorded delivery is landed regardless of the session being gone", () => {
  const states = classify(ledger, new Set(["s-2"]));
  expect(states.find((s) => s.fqid === "embark")!.phase).toBe("landed");
});

test("a live session with no record is running", () => {
  const states = classify(ledger, new Set(["s-2"]));
  expect(states.find((s) => s.fqid === "prontuario")!.phase).toBe("running");
});

test("a vanished session with no record is dead-silent, and carries its branch", () => {
  const states = classify(ledger, new Set(["s-2"]));
  const dead = states.find((s) => s.fqid === "outro")!;
  expect(dead.phase).toBe("dead-silent");
  expect(dead.branch).toBe("b3");
  expect(dead.worktree).toBe("w3");
});

test("subagent-mode units are not the poller's business", () => {
  const mixed: JourneyLedger = {
    id: "j2",
    dispatches: [{ repo: "embark", specialist: "J", branch: "b", worktree: "w", status: "dispatched" }],
  };
  expect(classify(mixed, new Set())).toEqual([]);
});

test("a monorepo package is keyed by its fqid", () => {
  const mono: JourneyLedger = {
    id: "j3",
    dispatches: [{ repo: "embark", package: "api", specialist: "J", branch: "b", worktree: "w", status: "dispatched", mode: "session", sessionId: "s-7" }],
  };
  expect(classify(mono, new Set(["s-7"]))[0]!.fqid).toBe("embark/api");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/session/__tests__/poll.test.ts`
Expected: FAIL — `Cannot find module '../poll'`

- [ ] **Step 3: Write the implementation**

Create `src/session/poll.ts`:

```ts
// Cross-references the journey ledger against agentop's live session list. The
// ledger is the source of truth for "did the work land"; agentop is the source
// of truth for "is anyone still working". Only together do they distinguish a
// slow specialist from one that died without a word.
import { packageFqid } from "../context-brain/packages";
import { readLedger } from "../journey/ledger";
import type { JourneyLedger } from "../journey/types";
import type { AgentopRunner, UnitState } from "./types";

const LANDED_STATUSES = new Set(["delivered", "verified", "merged"]);

export function parseSessionList(stdout: string): Set<string> {
  const ids = new Set<string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return ids;
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as any).sessions)
      ? (parsed as any).sessions
      : [];
  for (const entry of list) {
    const id = entry && typeof entry === "object" ? (entry as any).id : null;
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

export function classify(ledger: JourneyLedger, live: Set<string>): UnitState[] {
  const states: UnitState[] = [];
  for (const d of ledger.dispatches) {
    if (d.mode !== "session") continue;
    const phase = LANDED_STATUSES.has(d.status)
      ? "landed"
      : d.sessionId && live.has(d.sessionId)
        ? "running"
        : "dead-silent";
    states.push({
      fqid: packageFqid(d.repo, d.package),
      sessionId: d.sessionId ?? null,
      phase,
      branch: d.branch,
      worktree: d.worktree,
    });
  }
  return states;
}

export async function pollOnce(
  workspaceDir: string,
  journeyId: string,
  runner: AgentopRunner,
): Promise<UnitState[]> {
  const ledger = await readLedger(workspaceDir, journeyId);
  if (!ledger) return [];
  const result = await runner(["session", "list", "--json"]);
  return classify(ledger, result.code === 0 ? parseSessionList(result.stdout) : new Set());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/session/__tests__/poll.test.ts`
Expected: PASS — the full guard suite

- [ ] **Step 5: Commit**

```bash
git add src/session/poll.ts src/session/__tests__/poll.test.ts
git commit -m "feat(session): classificação landed/running/dead-silent da wave"
```

---

### Task 11: `aipe session dispatch`

**Files:**
- Modify: `src/session/cli.ts`
- Test: `src/session/__tests__/cli-dispatch.test.ts`

**Interfaces:**
- Consumes: `composePrompt` (8), `startBatch` (9), `probe` (1), `issueGrant` (3), `readLedger`/`recordDispatch` (journey), `resolveAdapter` (harness).
- Produces: `dispatchCommand(opts): Promise<{ code: number; lines: string[] }>` where
  `opts = { workspace: string; journeyId: string; runner: AgentopRunner }`.

Reads the ledger for units with `mode: "session"` and `status: "dispatched"` that have no `sessionId` yet, writes one prompt file each, starts the batch, then records the returned session ids. Prompt files are kept: they are the audit trail of exactly what each specialist was told.

- [ ] **Step 1: Write the failing test**

Create `src/session/__tests__/cli-dispatch.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchCommand } from "../cli";
import { readLedger, recordDispatch, startJourney } from "../../journey/ledger";
import type { AgentopRunner } from "../types";

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-dispatch-"));
  await mkdir(join(dir, "embark", ".claude", "skills", "joaquim"), { recursive: true });
  await writeFile(
    join(dir, "embark", ".claude", "skills", "joaquim", "SKILL.md"),
    "---\nname: joaquim\n---\n\nYou are Joaquim.\n",
    "utf8",
  );
  await mkdir(join(dir, ".aipe", "journeys", "j1"), { recursive: true });
  await writeFile(join(dir, ".aipe", "journeys", "j1", "orientation.md"), "## embark\nFix it.\n", "utf8");
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim",
    worktree: join(dir, ".worktrees", "j1-joaquim"), status: "dispatched",
    mode: "session", intensity: "ultracode", harness: "claude-code",
  });
  return dir;
}

const okRunner: AgentopRunner = async (args) => {
  if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
  return { code: 0, stdout: JSON.stringify({ sessions: [{ id: "s-1", harness: "claude", cwd: "x" }] }), stderr: "" };
};

test("it writes a prompt file per unit and records the session id", async () => {
  const dir = await fixture();
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(r.code).toBe(0);

  const prompt = await readFile(join(dir, ".aipe", "journeys", "j1", "prompts", "embark.md"), "utf8");
  expect(prompt).toContain("You are Joaquim.");
  expect(prompt).toContain("ultracode");

  const ledger = await readLedger(dir, "j1");
  expect(ledger!.dispatches[0]!.sessionId).toBe("s-1");
});

test("it refuses when agentop is unavailable, and records nothing", async () => {
  const dir = await fixture();
  const missing: AgentopRunner = async () => { throw new Error("ENOENT"); };
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: missing });
  expect(r.code).toBe(1);
  expect(r.lines.join("\n")).toContain("ERROR agentop");
  expect((await readLedger(dir, "j1"))!.dispatches[0]!.sessionId).toBeUndefined();
});

test("a unit already carrying a session id is not dispatched twice", async () => {
  const dir = await fixture();
  await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  const second = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(second.lines.join("\n")).toContain("nothing to dispatch");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/session/__tests__/cli-dispatch.test.ts`
Expected: FAIL — `dispatchCommand is not a function`

- [ ] **Step 3: Write the implementation**

In `src/session/cli.ts`, add the imports:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { packageFqid } from "../context-brain/packages";
import { readLedger, recordDispatch } from "../journey/ledger";
import { resolveAdapter } from "../harness/registry";
import { personaSlug } from "../hire-specialists/render";
import { startBatch, type BatchUnit } from "./batch";
import { composePrompt } from "./prompt";
import { probe, realRunner } from "./runner";
import type { AgentopRunner } from "./types";
```

Add before `run`:

```ts
export interface DispatchOptions {
  workspace: string;
  journeyId: string;
  runner: AgentopRunner;
}

// Pulls this unit's section out of the approved Orientation Spec. Falls back to
// the whole document rather than to nothing: a brief that is too broad is
// recoverable, an empty one silently produces a drifting specialist.
function specSlice(orientation: string, fqid: string): string {
  const lines = orientation.split("\n");
  const start = lines.findIndex((l) => /^#{1,3}\s/.test(l) && l.includes(fqid));
  if (start < 0) return orientation;
  const end = lines.findIndex((l, i) => i > start && /^#{1,3}\s/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

export async function dispatchCommand(
  opts: DispatchOptions,
): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const probed = await probe(opts.runner);
  if (!probed.ok) {
    lines.push(`ERROR agentop: ${probed.reason ?? "unavailable"} — install or upgrade agentop, or dispatch in subagent mode`);
    return { code: 1, lines };
  }

  const ledger = await readLedger(opts.workspace, opts.journeyId);
  if (!ledger) {
    lines.push(`ERROR journey: no ledger for ${opts.journeyId}`);
    return { code: 1, lines };
  }

  const pending = ledger.dispatches.filter(
    (d) => d.mode === "session" && d.status === "dispatched" && !d.sessionId,
  );
  if (pending.length === 0) {
    lines.push("OK nothing to dispatch");
    return { code: 0, lines };
  }

  const journeyDir = join(opts.workspace, ".aipe", "journeys", opts.journeyId);
  const promptsDir = join(journeyDir, "prompts");
  await mkdir(promptsDir, { recursive: true });

  let orientation = "";
  try {
    orientation = await readFile(join(journeyDir, "orientation.md"), "utf8");
  } catch {
    lines.push("ERROR spec: orientation.md not found — write and approve the Orientation Spec first");
    return { code: 1, lines };
  }

  const adapter = await resolveAdapter(opts.workspace);
  const units: BatchUnit[] = [];

  for (const d of pending) {
    const fqid = packageFqid(d.repo, d.package);
    const target = adapter.personaTarget(personaSlug(d.specialist));
    let personaBody = "";
    try {
      personaBody = await readFile(join(opts.workspace, d.repo, target.relDir, target.filename), "utf8");
    } catch {
      lines.push(`ERROR persona: could not read the persona for ${d.specialist}@${d.repo}`);
      return { code: 1, lines };
    }

    const prompt = composePrompt({
      personaBody,
      specSlice: specSlice(orientation, fqid),
      worktree: d.worktree,
      packagePath: d.package ?? null,
      branch: d.branch,
      journeyId: opts.journeyId,
      workspace: opts.workspace,
      fqid,
      intensity: d.intensity === "ultracode" ? "ultracode" : "normal",
    });

    const promptFile = join(promptsDir, `${fqid.replace(/\//g, "--")}.md`);
    await writeFile(promptFile, prompt, "utf8");
    units.push({ harness: "claude", cwd: d.worktree, promptFile, ...(d.model ? { model: d.model } : {}) });
  }

  let result;
  try {
    result = await startBatch(`aipe/${opts.journeyId}`, units, opts.runner);
  } catch (err) {
    lines.push(`ERROR agentop: ${err instanceof Error ? err.message : String(err)}`);
    return { code: 1, lines };
  }
  const started = result.sessions;
  // `malformed` counts entries agentop returned that could not be used. It is
  // NOT an error to abort on — the sessions it did start are already running,
  // and throwing here would orphan them. Report it so the shortfall is visible.
  if (result.malformed > 0) {
    lines.push(`ERROR session: agentop returned ${result.malformed} unusable session record(s)`);
  }

  // Pair by cwd, NOT by position. `parseBatchOutput` returns agentop's list
  // as-is: nothing guarantees it comes back in the order the --session flags
  // went out, or that it is the same length. Zipping by index would write a
  // session id onto the wrong unit, and `collect` would then report the wrong
  // unit dead. Each unit's worktree is unique within a wave, so cwd is a key.
  const byCwd = new Map(started.map((s) => [s.cwd, s]));
  for (const d of pending) {
    const fqid = packageFqid(d.repo, d.package);
    const session = byCwd.get(d.worktree);
    if (!session) {
      lines.push(`ERROR session: agentop reported no session for ${fqid} (${d.worktree})`);
      continue;
    }
    await recordDispatch(opts.workspace, opts.journeyId, { ...d, sessionId: session.id });
    lines.push(`OK ${fqid} → ${session.id}`);
  }
  if (started.length !== pending.length) {
    lines.push(`ERROR session: asked agentop for ${pending.length} sessions, it started ${started.length}`);
    return { code: 1, lines };
  }

  return { code: 0, lines };
}
```

Wire it into `run`'s switch, above `default`:

```ts
    case "dispatch": {
      const workspace = getFlag(rest, "--workspace") ?? process.cwd();
      const journeyId = getFlag(rest, "--journey");
      if (!journeyId) {
        console.log("ERROR journey: --journey <id> is required");
        return 1;
      }
      const { code, lines } = await dispatchCommand({ workspace, journeyId, runner: realRunner });
      for (const line of lines) console.log(line);
      return code;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/session/__tests__/cli-dispatch.test.ts && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — 3 tests, no type errors

- [ ] **Step 5: Commit**

```bash
git add src/session/cli.ts src/session/__tests__/cli-dispatch.test.ts
git commit -m "feat(session): aipe session dispatch inicia a wave e grava os ids"
```

---

### Task 12: `aipe session collect` and `aipe session doctor`

**Files:**
- Modify: `src/session/cli.ts`
- Test: `src/session/__tests__/cli-collect.test.ts`

**Interfaces:**
- Consumes: `pollOnce` (10), `probe` (1).
- Produces: `collectCommand(opts): Promise<{ code: number; lines: string[]; states: UnitState[] }>` where
  `opts = { workspace; journeyId; runner; timeoutMs; intervalMs; now?: () => number; sleep?: (ms) => Promise<void> }`.
  Injecting `now`/`sleep` keeps the timeout test instant — a test that actually waits is a test nobody runs.

Exit codes: `0` when every unit landed; `2` when any unit is `dead-silent` or still `running` at timeout — the coordinator must look, not assume.

- [ ] **Step 1: Write the failing test**

Create `src/session/__tests__/cli-collect.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCommand } from "../cli";
import { recordDispatch, startJourney } from "../../journey/ledger";
import type { AgentopRunner } from "../types";

async function ledgerWith(status: "dispatched" | "delivered"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-collect-"));
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w",
    status, mode: "session", sessionId: "s-1",
    ...(status === "delivered"
      ? { evidence: { by: "dev" as const, commands: ["bun test"], summary: "green" } }
      : {}),
  });
  return dir;
}

const live: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [{ id: "s-1" }] }), stderr: "" });
const gone: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [] }), stderr: "" });

test("a landed wave exits 0", async () => {
  const dir = await ledgerWith("delivered");
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: gone, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  expect(r.code).toBe(0);
  expect(r.lines.join("\n")).toContain("LANDED embark");
});

test("a dead-silent unit exits 2 and names its branch", async () => {
  const dir = await ledgerWith("dispatched");
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: gone, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  expect(r.code).toBe(2);
  const out = r.lines.join("\n");
  expect(out).toContain("DEAD-SILENT embark");
  expect(out).toContain("branch b");
  expect(out).toContain("never re-dispatch blind");
});

test("a still-running unit at timeout exits 2 without killing anything", async () => {
  const dir = await ledgerWith("dispatched");
  let ticks = 0;
  const r = await collectCommand({
    workspace: dir, journeyId: "j1", runner: live,
    timeoutMs: 30, intervalMs: 10,
    now: () => (ticks += 20),
    sleep: async () => {},
  });
  expect(r.code).toBe(2);
  expect(r.lines.join("\n")).toContain("RUNNING embark");
  expect(r.lines.join("\n")).toContain("s-1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/session/__tests__/cli-collect.test.ts`
Expected: FAIL — `collectCommand is not a function`

- [ ] **Step 3: Write the implementation**

In `src/session/cli.ts`, add the import `import { pollOnce } from "./poll";` and `import type { UnitState } from "./types";`, then add:

```ts
export interface CollectOptions {
  workspace: string;
  journeyId: string;
  runner: AgentopRunner;
  timeoutMs: number;
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export async function collectCommand(
  opts: CollectOptions,
): Promise<{ code: number; lines: string[]; states: UnitState[] }> {
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = now() + opts.timeoutMs;

  let states: UnitState[] = [];
  for (;;) {
    states = await pollOnce(opts.workspace, opts.journeyId, opts.runner);
    const settled = states.every((s) => s.phase !== "running");
    if (settled || now() >= deadline) break;
    await sleep(opts.intervalMs);
  }

  const lines: string[] = [];
  for (const s of states) {
    if (s.phase === "landed") {
      lines.push(`LANDED ${s.fqid}`);
    } else if (s.phase === "running") {
      lines.push(`RUNNING ${s.fqid} session ${s.sessionId} — still working past the timeout; the PE decides whether to wait or kill it`);
    } else {
      lines.push(
        `DEAD-SILENT ${s.fqid} branch ${s.branch} worktree ${s.worktree} — the session ended without recording. Inspect the branch read-only (git log) and re-dispatch it to CONTINUE from what is there, or escalate: never re-dispatch blind`,
      );
    }
  }
  const clean = states.every((s) => s.phase === "landed");
  return { code: clean ? 0 : 2, lines, states };
}
```

Add both subcommands to `run`'s switch:

```ts
    case "collect": {
      const workspace = getFlag(rest, "--workspace") ?? process.cwd();
      const journeyId = getFlag(rest, "--journey");
      if (!journeyId) {
        console.log("ERROR journey: --journey <id> is required");
        return 1;
      }
      const timeoutS = Number(getFlag(rest, "--timeout") ?? "1800");
      const { code, lines } = await collectCommand({
        workspace, journeyId, runner: realRunner,
        timeoutMs: timeoutS * 1000, intervalMs: 15_000,
      });
      for (const line of lines) console.log(line);
      return code;
    }

    case "doctor": {
      const probed = await probe(realRunner);
      if (probed.ok) {
        console.log(`OK agentop ${probed.version}`);
        return 0;
      }
      console.log(`ERROR agentop: ${probed.reason ?? "unavailable"}`);
      console.log("Session-mode dispatch needs agentop >= 1.9.0 (agentistics).");
      console.log("It is NOT the npm package named `agentop` — that is an unrelated project.");
      console.log("Install it, then re-run `aipe session doctor`. Subagent-mode dispatch works without it.");
      return 1;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/session && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — the whole session suite, no type errors

- [ ] **Step 5: Commit**

```bash
git add src/session/cli.ts src/session/__tests__/cli-collect.test.ts
git commit -m "feat(session): collect com espera ativa e doctor do agentop"
```

---

### Task 13: register `session` in the unified CLI

**Files:**
- Modify: `src/cli.ts:11-95`
- Test: `src/session/__tests__/cli-registration.test.ts`

**Interfaces:**
- Consumes: `run` from `src/session/cli.ts`.
- Produces: `aipe session …` reachable; the help lists it.

- [ ] **Step 1: Write the failing test**

Create `src/session/__tests__/cli-registration.test.ts`:

```ts
import { expect, test } from "bun:test";
import { dispatch } from "../../cli";

test("`aipe session` is a known command", async () => {
  const original = console.log;
  const out: string[] = [];
  console.log = (...a: unknown[]) => { out.push(a.join(" ")); };
  try {
    const code = await dispatch(["session", "--help"]);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("dispatch specialists as real agentop sessions");
  } finally {
    console.log = original;
  }
});

test("the top-level help advertises it", async () => {
  const original = console.log;
  const out: string[] = [];
  console.log = (...a: unknown[]) => { out.push(a.join(" ")); };
  try {
    await dispatch(["--help"]);
    expect(out.join("\n")).toContain("session ");
  } finally {
    console.log = original;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/session/__tests__/cli-registration.test.ts`
Expected: FAIL — `unknown command "session"`

- [ ] **Step 3: Register it**

In `src/cli.ts`, add the import after line 20:

```ts
import { run as session } from "./session/cli";
```

Add to `SUBCOMMANDS`, after `journey: journey,`:

```ts
  session: session,
```

Add to `HELP`, after the `dispatch` line:

```ts
  "  session            Dispatch specialists as real agentop sessions (detached, own context)",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/session/__tests__/cli-registration.test.ts && bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — 2 new tests, the full suite green, no type errors

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/session/__tests__/cli-registration.test.ts
git commit -m "feat(cli): registra o subcomando session"
```

---

### Task 14: teach the coordinator to use session mode

**Files:**
- Modify: `skills/operate/SKILL.md:178-200` (step 4b/4c) and the step-3.5 spec section
- Test: manual — the skill is prose the coordinator reads, not executable code

**Interfaces:**
- Consumes: everything above.
- Produces: no code surface.

- [ ] **Step 1: Extend the Orientation Spec section (step 3.5)**

In `skills/operate/SKILL.md`, in the step-3.5 block, after the sentence describing what to fill into `orientation.md`, add:

```markdown
   **Per-unit dispatch envelope (the PE approves this too).** Each unit's scope
   section carries three fields:

   - `mode: subagent | session` — `subagent` (default) is in-process and returns
     its evidence directly. `session` is a real detached session with its own
     full context window; choose it when the unit is large enough that a shared
     context would starve it, or when it needs `ultracode`.
   - `intensity: normal | ultracode` — `ultracode` makes the specialist
     orchestrate multi-agent workflows. It multiplies token spend, so it is the
     PE's call, never yours.
   - `harness: claude-code` — the only containable harness today. A harness whose
     adapter cannot install the containment hook is rejected by the law.

   Never raise `mode` or `intensity` on your own judgement after approval. If a
   unit turns out heavier than the spec assumed, go back to the PE.
```

- [ ] **Step 2: Add the session-mode dispatch branch (step 4c)**

In step 4c, after the paragraph describing subagent dispatch, add:

```markdown
   **If the unit's `mode` is `session`:** do not start a subagent. Record the
   dispatch with its envelope, then start the whole wave with one command:

   ```bash
   aipe journey record --journey <id> --repo <repo> [--package <pkg>] \
     --specialist <persona> --branch <branch> --worktree <path> \
     --status dispatched --mode session --intensity <normal|ultracode> \
     --harness claude-code --workspace <workspace>

   aipe session dispatch --journey <id> --workspace <workspace>
   ```

   `aipe session dispatch` composes each specialist's prompt from its persona,
   its slice of the approved spec, and the return contract; writes it to
   `.aipe/journeys/<id>/prompts/` (kept, as the audit trail of what each
   specialist was told); and starts them all under the task `aipe/<id>`.

   Then wait for the wave:

   ```bash
   aipe session collect --journey <id> --timeout <seconds> --workspace <workspace>
   ```

   It prints one line per unit and exits 0 only if every unit landed:

   - `LANDED <fqid>` — the specialist recorded its delivery with evidence.
     Proceed to the QA gate exactly as with a subagent delivery.
   - `RUNNING <fqid> session <id>` — still working past the timeout. Report it
     to the PE with the session id and let **them** decide whether to wait or
     `agentop session kill`. Killing a specialist is never your call.
   - `DEAD-SILENT <fqid> branch <b>` — the session ended without recording.
     Inspect the branch **read-only** (`git log`, `git diff`) and either
     re-dispatch with a brief that says *continue from what is on the branch*,
     or escalate to the PE. **Never re-dispatch blind** — the ledger law that
     forbids re-dispatching merged work applies here too.

   If your session ends while a wave is in flight, the sessions keep running —
   they are detached. On your next turn, read the ledger and run
   `aipe session collect` again; it reconciles from the `aipe/<id>` task.
```

- [ ] **Step 3: State the specialist prohibition in the dispatch-gate section**

In the "The dispatch gate (MUST — non-negotiable)" section, after the list of allowed coordinator actions, add:

```markdown
**Opening sessions is yours alone.** A dispatched specialist is forbidden from
opening an agentop session — a containment hook denies it, and the persona is
told so up front. If a specialist genuinely needs sub-work, it asks you; you
either do it, dispatch it as its own unit, or issue an explicit grant. A
specialist that could spawn specialists is an unbounded token fork-bomb with no
ledger entry for any of it.
```

- [ ] **Step 4: Verify the skill still parses and is installed**

Run: `bun test && bun run typecheck`
Expected: PASS — the skill body is embedded via `src/harness/skills.ts`, so a broken file surfaces here

- [ ] **Step 5: Commit**

```bash
git add skills/operate/SKILL.md
git commit -m "docs(operate): coordenador aprende a despachar e coletar em modo sessão"
```

---

---

### Task 15: session naming, and `redirected` as a first-class status

**Files:**
- Modify: `src/session/batch.ts` (`BatchUnit` gains `name`)
- Modify: `src/session/cli.ts` (`dispatchCommand` supplies it; `collectCommand` surfaces the new phase)
- Modify: `src/session/poll.ts` (`classify` recognises `redirected`)
- Modify: `src/session/types.ts` (`UnitPhase` gains `"redirected"`)
- Modify: `src/journey/types.ts` (`DispatchStatus` gains `"redirected"`)
- Modify: `src/session/prompt.ts` (the MUST in the contract)
- Test: `src/session/__tests__/redirect.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 8–12.
- Produces: `BatchUnit` gains `name: string`; `UnitPhase` becomes `"landed" | "running" | "dead-silent" | "redirected"`; `DispatchStatus` gains `"redirected"`.

Why `redirected` exists: the PE can now `agentop session attach` a live specialist and change its direction. When that happens the approved Orientation Spec stops describing what is being built, and the QA gate would validate against acceptance criteria nobody is following. The status makes that divergence loud instead of silent.

- [ ] **Step 1: Write the failing test**

Create `src/session/__tests__/redirect.test.ts`:

```ts
import { expect, test } from "bun:test";
import { buildBatchArgs } from "../batch";
import { classify } from "../poll";
import { composePrompt } from "../prompt";
import type { JourneyLedger } from "../../journey/types";

test("each session is named <repo>/<persona> so the cockpit is legible", () => {
  const args = buildBatchArgs("aipe/j1", [
    { harness: "claude", cwd: "/w/wt", promptFile: "/p.md", name: "embark/joaquim" },
  ]);
  expect(args).toContain("--name");
  expect(args).toContain("embark/joaquim");
});

test("a redirected unit is its own phase, never mistaken for progress", () => {
  const ledger: JourneyLedger = {
    id: "j1",
    dispatches: [
      { repo: "embark", specialist: "J", branch: "b", worktree: "w", status: "redirected", mode: "session", sessionId: "s-1" },
    ],
  };
  expect(classify(ledger, new Set(["s-1"]))[0]!.phase).toBe("redirected");
});

test("a redirected unit stays redirected even after its session ends", () => {
  const ledger: JourneyLedger = {
    id: "j1",
    dispatches: [
      { repo: "embark", specialist: "J", branch: "b", worktree: "w", status: "redirected", mode: "session", sessionId: "s-1" },
    ],
  };
  expect(classify(ledger, new Set())[0]!.phase).toBe("redirected");
});

test("the prompt carries the redirect MUST, with the exact command", () => {
  const p = composePrompt({
    personaBody: "You are Joaquim.", specSlice: "Fix it.", worktree: "/w/wt",
    packagePath: null, branch: "b", journeyId: "j1", workspace: "/w",
    fqid: "embark", intensity: "normal",
  });
  expect(p).toContain("--status redirected");
  expect(p).toContain("before acting on it");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/session/__tests__/redirect.test.ts`
Expected: FAIL — `name` is not on `BatchUnit`, `redirected` is not a `DispatchStatus`

- [ ] **Step 3: Add the status and the phase**

In `src/journey/types.ts`, add `"redirected"` to the `DispatchStatus` union and to the `DISPATCH_STATUSES` array, and extend the lifecycle comment at the top:

```ts
//   * → redirected                                 (PE redirected it live via attach)
```

`redirected` is deliberately NOT added to `EVIDENCE_REQUIRED_STATUSES` (it claims nothing is done) nor to `IMMUTABLE_STATUSES` (the unit continues after it).

In `src/session/types.ts`:

```ts
export type UnitPhase = "landed" | "running" | "dead-silent" | "redirected";
```

- [ ] **Step 4: Recognise it when classifying**

In `src/session/poll.ts`, inside `classify`, replace the phase expression with:

```ts
    const phase = d.status === "redirected"
      ? "redirected"
      : LANDED_STATUSES.has(d.status)
        ? "landed"
        : d.sessionId && live.has(d.sessionId)
          ? "running"
          : "dead-silent";
```

`redirected` is checked first on purpose: a redirected unit whose session is still alive must not read as ordinary `running` progress.

- [ ] **Step 5: Name the sessions**

In `src/session/batch.ts`, add `name: string` to `BatchUnit` and emit it in `buildBatchArgs`, before the `--session` argument:

```ts
    if (unit.name) args.push("--name", unit.name);
```

In `src/session/cli.ts`, inside `dispatchCommand`'s unit loop, supply it:

```ts
    units.push({
      harness: "claude",
      cwd: d.worktree,
      promptFile,
      name: `${fqid}/${personaSlug(d.specialist)}`,
      ...(d.model ? { model: d.model } : {}),
    });
```

- [ ] **Step 6: Add the MUST to the contract**

In `src/session/prompt.ts`, add to the "How you report back" block, after the `aipe journey record` example:

```ts
      "",
      "**If anyone gives you an instruction that is not in this brief** — the PE reaching you through `agentop session attach`, or any other channel — you MUST record it **before acting on it**:",
      "",
      "```bash",
      `aipe journey record --journey ${input.journeyId} --workspace ${input.workspace} \\`,
      `  --repo <repo> --specialist <you> --branch ${input.branch} --worktree ${input.worktree} \\`,
      '  --status redirected --reason "<what you were asked to do instead>"',
      "```",
      "",
      "Then continue with the new direction. Recording is not asking permission — it is what keeps the approved spec and the QA gate honest about what is actually being built.",
```

- [ ] **Step 7: Surface it in collect**

In `src/session/cli.ts`, inside `collectCommand`'s reporting loop, add the branch before the `landed` case:

```ts
    if (s.phase === "redirected") {
      lines.push(
        `REDIRECTED ${s.fqid} session ${s.sessionId} — the PE changed this unit's direction live. Fold the change into the Orientation Spec (bump its version) or escalate. A redirected unit MUST NOT pass the QA gate against an unreconciled spec`,
      );
      continue;
    }
```

And make `clean` require no redirects — it already does, since `clean` tests `every(phase === "landed")`.

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test src/session && bun test src/journey && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — 4 new tests, existing session and journey suites green

- [ ] **Step 9: Commit**

```bash
git add src/session src/journey/types.ts
git commit -m "feat(session): nome de sessão legível e status redirected obrigatório"
```

---

### Task 16: the Codex adapter

**Files:**
- Create: `src/harness/codex.ts`
- Modify: `src/harness/registry.ts` (register `codex`)
- Test: `src/harness/__tests__/codex.test.ts`

**Interfaces:**
- Consumes: `HarnessAdapter`, `ContainmentHook` (Task 5).
- Produces: `codexAdapter: HarnessAdapter` with `id: "codex"`.

- [ ] **Step 1: Re-verify the conventions before writing anything**

Read the current Codex docs and record what you find in a comment at the top of the new file:

- Hooks: <https://learn.chatgpt.com/docs/hooks> — confirm `PreToolUse`, `matcher: "Bash"`, the `hookSpecificOutput.permissionDecision` shape, and whether `[features] codex_hooks` gating applies to the installed version.
- Skills/AGENTS.md conventions — confirm whether project skills live at `.codex/skills/<slug>/SKILL.md` or `.agents/skills/<slug>/SKILL.md`; sources disagree, so pick what the official docs say **today** and write the URL and date into the file.

If a convention differs from the table in this plan, follow the docs and note the difference — the plan's table is a starting point, not the authority.

- [ ] **Step 2: Write the failing test**

Create `src/harness/__tests__/codex.test.ts`:

```ts
import { expect, test } from "bun:test";
import { codexAdapter } from "../codex";
import { getAdapter, hasAdapter } from "../registry";
import { isContainable } from "../types";

test("codex is registered and containable", () => {
  expect(hasAdapter("codex")).toBe(true);
  expect(getAdapter("codex").id).toBe("codex");
  expect(isContainable(codexAdapter)).toBe(true);
});

test("its containment hook targets a PreToolUse Bash matcher running the guard", () => {
  const hook = codexAdapter.containmentHook()!;
  const merged = JSON.stringify(hook.merge({}));
  expect(merged).toContain("PreToolUse");
  expect(merged).toContain("Bash");
  expect(merged).toContain("aipe session guard");
});

test("merging is idempotent and preserves foreign keys", () => {
  const hook = codexAdapter.containmentHook()!;
  const once = hook.merge({ someOtherSetting: 1 });
  expect(hook.merge(once)).toEqual(once);
  expect((once as any).someOtherSetting).toBe(1);
});

test("a persona is wrapped with frontmatter the harness reads", () => {
  const wrapped = codexAdapter.wrapPersona("You are Joaquim.", {
    slug: "joaquim", role: "dev-fullstack", repo: "embark", package: null, stack: ["ts"],
  });
  expect(wrapped.startsWith("---\n")).toBe(true);
  expect(wrapped).toContain("name: joaquim");
  expect(wrapped).toContain("You are Joaquim.");
});

test("model tiers resolve to real codex model ids", () => {
  expect(codexAdapter.resolveModel("standard")).not.toBeNull();
  expect(codexAdapter.resolveModel("nonsense")).toBeNull();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test src/harness/__tests__/codex.test.ts`
Expected: FAIL — `Cannot find module '../codex'`

- [ ] **Step 4: Implement the adapter**

Create `src/harness/codex.ts`, modelled on `src/harness/claude-code.ts` — same structure, Codex's paths. Implement every `HarnessAdapter` member: `id`, `label`, `installIntegration`, `startupDelivery`, `containmentHook`, `personaTarget`, `flowSkillTarget`, `wrapPersona`, `mcpConfigPath`, `resolveModel`.

Constraints that are not negotiable:
- `containmentHook()` returns a real hook whose command is exactly `aipe session guard` — the same guard every harness calls.
- `startupDelivery` returns `{ mode: "file", path: "AGENTS.md", content: awareness }` if Codex has no session-start hook equivalent; return the hook form only if the docs show one.
- `resolveModel` maps the four tiers (`fast`, `standard`, `reasoning`, `frontier`) to model ids you verified in the docs. Do not invent ids.

- [ ] **Step 5: Register it**

In `src/harness/registry.ts`, add the import and the `ADAPTERS` entry:

```ts
import { codexAdapter } from "./codex";
// …
  codex: codexAdapter,
```

Then in `src/dispatch/cli.ts`, add `"codex"` to `KNOWN_HARNESSES`.

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test src/harness && bun test src/dispatch && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — 5 new tests; `buildSessionContext` now reports `["claude-code", "codex"]`, so update that assertion in `src/dispatch/__tests__/session-mode.test.ts`

- [ ] **Step 7: Commit**

```bash
git add src/harness/codex.ts src/harness/registry.ts src/harness/__tests__/codex.test.ts src/dispatch
git commit -m "feat(harness): adapter do Codex CLI com contenção"
```

---

### Task 17: the Gemini and Copilot adapters

**Files:**
- Create: `src/harness/gemini.ts`, `src/harness/copilot.ts`
- Modify: `src/harness/registry.ts`, `src/dispatch/cli.ts` (`KNOWN_HARNESSES`)
- Test: `src/harness/__tests__/gemini.test.ts`, `src/harness/__tests__/copilot.test.ts`

**Interfaces:**
- Consumes: same as Task 16.
- Produces: `geminiAdapter` (`id: "gemini"`), `copilotAdapter` (`id: "copilot"`).

- [ ] **Step 1: Re-verify both harnesses' conventions**

- Gemini: <https://geminicli.com/docs/hooks/> and <https://geminicli.com/docs/reference/configuration/> — confirm the `BeforeTool` event name, the matcher syntax, the `type: "command"` shape, and that the hook script must print **only** JSON on stdout (this differs from Claude Code and Codex, and `aipe session guard` already satisfies it: it prints the decision or nothing at all). Confirm `.gemini/settings.json` is where project hooks live.
- Copilot: <https://docs.github.com/en/copilot/reference/hooks-reference> and the CLI config-dir reference — confirm `preToolUse`, the repo-level `.github/hooks/` location, and the `hooks` key shape in settings.

Record each URL and the verification date in a comment at the top of each file.

- [ ] **Step 2: Write the failing tests**

Create `src/harness/__tests__/gemini.test.ts` and `src/harness/__tests__/copilot.test.ts`, each mirroring the five tests from Task 16 with that harness's id, containment shape and model tiers. Repeat the test bodies rather than sharing a helper — each harness's expected containment output is different, and a shared helper would hide exactly the difference these tests exist to pin down.

Gemini's containment test additionally asserts the event name is `BeforeTool`, not `PreToolUse`:

```ts
test("gemini's hook uses its own event name", () => {
  const merged = JSON.stringify(geminiAdapter.containmentHook()!.merge({}));
  expect(merged).toContain("BeforeTool");
  expect(merged).not.toContain("PreToolUse");
  expect(merged).toContain("aipe session guard");
});
```

Copilot's asserts the lowercase event name:

```ts
test("copilot's hook uses its own event name", () => {
  const merged = JSON.stringify(copilotAdapter.containmentHook()!.merge({}));
  expect(merged).toContain("preToolUse");
  expect(merged).toContain("aipe session guard");
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `bun test src/harness/__tests__/gemini.test.ts src/harness/__tests__/copilot.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement both adapters**

Same structure and the same non-negotiables as Task 16: the containment command is exactly `aipe session guard`; model ids come from the docs, never from memory; every `HarnessAdapter` member is implemented.

- [ ] **Step 5: Register both**

In `src/harness/registry.ts` add `gemini: geminiAdapter` and `copilot: copilotAdapter`; in `src/dispatch/cli.ts` extend `KNOWN_HARNESSES` to `["claude-code", "generic", "codex", "gemini", "copilot"]`.

- [ ] **Step 6: Verify the eligibility rule end to end**

Add to `src/dispatch/__tests__/session-mode.test.ts`:

```ts
test("every containable harness is eligible, and kimi still is not", async () => {
  const ctx = await buildSessionContext(async () => ({ code: 0, stdout: "agentop v1.9.0", stderr: "" }));
  expect(ctx.containableHarnesses.sort()).toEqual(["claude-code", "codex", "copilot", "gemini"]);
  const v = validateBatch(
    [{ repo: "embark", specialist: "Joaquim", mode: "session", harness: "kimi" }],
    repos, roster, ctx,
  );
  expect(v.ok === false && v.rejects).toContain("harness-not-containable kimi");
});
```

- [ ] **Step 7: Run the full suite**

Run: `bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — everything green, `generic` still not containable

- [ ] **Step 8: Commit**

```bash
git add src/harness src/dispatch
git commit -m "feat(harness): adapters do Gemini e do Copilot com contenção"
```

---

### Task 18: teach the coordinator about attach, redirects and cross-model QA

**Files:**
- Modify: `skills/operate/SKILL.md`

**Interfaces:** none — prose.

- [ ] **Step 1: Add the redirect handling to the collect branch**

In the `aipe session collect` output list added by Task 14, add a fourth bullet:

```markdown
   - `REDIRECTED <fqid> session <id>` — the PE talked to this specialist directly
     and changed its direction. You **MUST** do one of two things before this
     unit can proceed: fold the change into the Orientation Spec and bump its
     version, or escalate to the PE that the change conflicts with the approved
     scope. A redirected unit **MUST NOT** pass the QA gate while the spec still
     describes something else — the QA would be validating against acceptance
     criteria nobody is following.
```

- [ ] **Step 2: Document the PE's direct channel**

Add a section after the dispatch-gate section:

```markdown
## The PE's direct line to a specialist

Every session-mode dispatch is named `<repo>/<persona>` and filed under the task
`aipe/<journey>`, and its `sessionId` is in the ledger. The PE can therefore open
a live conversation with any specialist at any time:

```bash
agentop session list          # what is running, and what each has spent
agentop session attach <id>   # talk to that specialist directly
```

This is the PE's channel, not yours — you neither need permission to be told
about it nor authority to prevent it. What you **MUST** do is reconcile: any unit
that comes back `REDIRECTED` had its direction changed outside your brief, and
the spec is now stale until you update it or escalate.

**You still never open a session you did not dispatch, and you never kill one.**
Killing is the PE's call.
```

- [ ] **Step 3: Document cross-model QA**

In the QA gate section (step 4e), add:

```markdown
   **Cross-model QA (recommended for high-risk units).** A QA persona dispatched
   in session mode may run on a *different harness* from the dev — `codex`,
   `gemini` or `copilot` instead of `claude-code`. A reviewer on a different
   model does not inherit the dev's blind spots, which is what "independent
   skeptic" was always supposed to mean. Set the QA unit's `harness` in the
   Orientation Spec; the PE approves it with the rest of the envelope. The law
   rejects any harness whose adapter cannot install the containment hook.
```

- [ ] **Step 4: Verify**

Run: `bun test && bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add skills/operate/SKILL.md
git commit -m "docs(operate): canal direto do PE, reconciliação de redirect e QA cross-model"
```

---

## Deviations from the spec, and why

- **The preflight lives at `aipe session doctor`, not `aipe doctor`.** The spec
  named `aipe doctor`; no such command exists in this CLI (`src/cli.ts:36-60`),
  and inventing a top-level one is a bigger surface than this feature earns.
  `aipe session doctor` reports availability with install instructions, which is
  the behaviour the spec asked for.
- **The agentop-side briefing is not implemented here.** The spec places the
  "what you may do with agentop" briefing in agentop, so it also covers sessions
  AIPe did not start. This plan puts the equivalent text in the composed prompt
  (Task 8), which covers every session AIPe *does* start. The agentop-side
  version is a change to that project — see below.

## Follow-up, not in this plan

- **Cost attribution for worktree sessions.** A session whose cwd is `<repo>/.worktrees/…` should be attributed to the parent repository, resolved via `git rev-parse --git-common-dir` rather than the worktree path. This is an agentop change, and fixing it there fixes attribution for every worktree-based tool.
- **Two changes in agentop itself** (the agentistics repo, not this one): stamping `AGENTOP_SESSION_ID` into the session environment, which the grant counter needs — without it a grant simply never applies and the guard denies, which is the safe failure — and briefing every session it opens on what it may and may not do with agentop.
- **A dedicated supervisor session per journey.** The coordinator waits actively instead, so the PE's session is occupied during a wave.
