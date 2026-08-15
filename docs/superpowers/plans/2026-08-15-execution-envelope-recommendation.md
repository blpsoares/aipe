# Execution-envelope recommendation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AIPe coordinator arrive at the existing Orientation-Spec gate with a filled, justified, priced execution envelope per unit — instead of an empty one the PE fills in from nothing.

**Architecture:** Three modules. `src/capabilities/` probes which harness binaries this machine actually has and stores them with a PE confirmation that outranks the probe. `src/execution/` reads a policy file (sibling of the existing `model-policy.yaml`), prices each viable envelope with a coarse cost index, and emits a proposal. Eligibility is never re-decided — `propose` consults `isContainable`/`validateBatch`, the existing single authority.

**Tech Stack:** TypeScript (strict), Bun (`bun test`, `Bun.spawn`), `yaml`. No new npm dependencies.

## Global Constraints

- **Cost is a coarse relative index, NEVER currency.** The cheapest envelope — subagent + `fast` tier + `normal` intensity — is `1`; every other combination is a whole multiple. The reference is the cheapest envelope, not a mid-tier one, so every tier stays a distinct integer. AIPe cannot know a token price, plan or rate limit; any surface showing the number must label it an index. A dollar figure anywhere is a plan failure.
- **Eligibility is not reimplemented.** Whether a harness may be session-dispatched is decided by `isContainable` (`src/harness/types.ts`) and adjudicated by `validateBatch` (`src/dispatch/law.ts`). `propose` consults them and never keeps a second opinion.
- **A probe result is a claim with a date, not a fact.** A binary on `PATH` is not an authenticated binary. `capabilities.yaml` records what was detected, how, when, and whether the PE confirmed it. **A PE confirmation outranks a probe.**
- **Policy defaults, when the file is absent or malformed:** session ceiling `4` (never above the dispatch law's `SESSION_MAX_CONCURRENT`); gated always: `ultracode`, tier `frontier`, and any wave above `2` concurrent sessions.
- **No test executes a real harness binary.** All probing goes through an injectable runner. `agentop`, `claude` and possibly others ARE installed on this machine — a test that forgets the fake passes here and fails everywhere else.
- **One real-binary argv check is mandatory** for any command this feature assembles (Task 2). At `--version`/`--help` level, starting nothing. The predecessor branch shipped 890 green tests over a dispatch path that had never once run, because every test injected a fake runner accepting any argv.
- **Exact assertions.** On the predecessor branch every `toContain` carrying a guarantee proved too weak under mutation.
- **Code style:** follow the repo's module conventions — `run(args: string[]): Promise<number>` per CLI, the local `getFlag` helper, `OK …` / `ERROR <field>: …` output lines. Commit messages in Portuguese, Conventional Commits.

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/capabilities/types.ts` | `HarnessCapability`, `Capabilities`, `BinaryProbe`, `ProbeRunner` |
| `src/capabilities/probe.ts` | Detect harness binaries behind an injectable runner |
| `src/capabilities/store.ts` | Read/write `.aipe/capabilities.yaml`; confirmation outranks probe; drift detection |
| `src/capabilities/cli.ts` | `aipe capabilities probe \| show \| confirm` |
| `src/execution/types.ts` | `ExecutionPolicy`, `Envelope`, `PricedEnvelope`, `Proposal` |
| `src/execution/policy.ts` | Read `.aipe/execution-policy.yaml` with conservative defaults |
| `src/execution/cost.ts` | The cost index — pure arithmetic |
| `src/execution/propose.ts` | Viability × policy × eligibility → priced, gate-marked options |
| `src/execution/waves.ts` | Group units into waves by model; signal an extra wave |
| `src/execution/cli.ts` | `aipe execution propose` |

**Modified:**

| File | Change |
| --- | --- |
| `src/cli.ts` | Register `capabilities` and `execution`; two help lines |
| `skills/operate/SKILL.md` | Step 3.5: the coordinator proposes rather than the PE inventing |

---

### Task 1: Capability types and the binary probe

**Files:**
- Create: `src/capabilities/types.ts`
- Create: `src/capabilities/probe.ts`
- Test: `src/capabilities/__tests__/probe.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ProbeRunner = (bin: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>`; `realProbeRunner: ProbeRunner`; `PROBED_HARNESSES: { id: string; bin: string }[]`; `probeBinary(bin, runner): Promise<BinaryProbe>`; `probeAll(runner): Promise<BinaryProbe[]>`.

- [ ] **Step 1: Write the failing test**

Create `src/capabilities/__tests__/probe.test.ts`:

```ts
import { expect, test } from "bun:test";
import { probeAll, probeBinary } from "../probe";
import type { ProbeRunner } from "../types";

const ok = (out: string): ProbeRunner => async () => ({ code: 0, stdout: out, stderr: "" });
const missing: ProbeRunner = async () => { throw new Error("ENOENT"); };
const failing: ProbeRunner = async () => ({ code: 127, stdout: "", stderr: "not found" });

test("a present binary reports its version", async () => {
  const p = await probeBinary("gemini", ok("gemini 3.1.0"));
  expect(p).toEqual({ bin: "gemini", present: true, version: "3.1.0" });
});

test("a version string with no number is present but unversioned", async () => {
  const p = await probeBinary("gemini", ok("gemini (dev build)"));
  expect(p).toEqual({ bin: "gemini", present: true, version: null });
});

test("a missing binary is absent, never a throw", async () => {
  expect(await probeBinary("codex", missing)).toEqual({ bin: "codex", present: false, version: null });
});

test("a non-zero exit is absent, not a false positive", async () => {
  expect(await probeBinary("codex", failing)).toEqual({ bin: "codex", present: false, version: null });
});

test("probeAll covers every harness AIPe knows how to start", async () => {
  const all = await probeAll(ok("x 1.0.0"));
  expect(all.map((p) => p.bin).sort()).toEqual(["claude", "codex", "copilot", "gemini"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/capabilities/__tests__/probe.test.ts`
Expected: FAIL — `Cannot find module '../probe'`

- [ ] **Step 3: Write the types**

Create `src/capabilities/types.ts`:

```ts
// What this machine can actually run. A probe result is a CLAIM WITH A DATE,
// not a fact: a binary on PATH is not an authenticated binary, and a harness
// that was usable last month may not be after a CLI update. Everything here
// keeps provenance so a stale claim is distinguishable from a fresh one.

export type ProbeRunner = (
  bin: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface BinaryProbe {
  bin: string;
  present: boolean;
  version: string | null;
}

// `source` is what makes a confirmation outrank a probe: the PE's word is
// recorded as such, so a later probe cannot silently overwrite it.
export type CapabilitySource = "probe" | "pe-confirmed";

export interface HarnessCapability {
  id: string; // adapter id: claude-code, gemini, codex, copilot
  bin: string;
  present: boolean;
  version: string | null;
  source: CapabilitySource;
  checkedAt: string; // ISO date
}

export interface Capabilities {
  harnesses: HarnessCapability[];
  confirmed: boolean; // has the PE ever confirmed this file?
}
```

- [ ] **Step 4: Write the probe**

Create `src/capabilities/probe.ts`:

```ts
import type { BinaryProbe, ProbeRunner } from "./types";

export const realProbeRunner: ProbeRunner = async (bin, args) => {
  const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
};

// Adapter id -> the binary agentop would actually start. `claude-code` is the
// adapter's id; `claude` is the binary. They are different namespaces and
// conflating them is a bug this repo has already paid for once.
export const PROBED_HARNESSES: { id: string; bin: string }[] = [
  { id: "claude-code", bin: "claude" },
  { id: "gemini", bin: "gemini" },
  { id: "codex", bin: "codex" },
  { id: "copilot", bin: "copilot" },
];

export async function probeBinary(bin: string, runner: ProbeRunner): Promise<BinaryProbe> {
  let out: { code: number; stdout: string };
  try {
    out = await runner(bin, ["--version"]);
  } catch {
    return { bin, present: false, version: null };
  }
  if (out.code !== 0) return { bin, present: false, version: null };
  const m = out.stdout.match(/(\d+\.\d+\.\d+)/);
  return { bin, present: true, version: m ? m[1]! : null };
}

export async function probeAll(runner: ProbeRunner): Promise<BinaryProbe[]> {
  return Promise.all(PROBED_HARNESSES.map((h) => probeBinary(h.bin, runner)));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/capabilities/__tests__/probe.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 6: Commit**

```bash
git add src/capabilities/types.ts src/capabilities/probe.ts src/capabilities/__tests__/probe.test.ts
git commit -m "feat(capabilities): sonda de binários de harness atrás de runner injetável"
```

---

### Task 2: The capabilities store, and the one real-binary check

**Files:**
- Create: `src/capabilities/store.ts`
- Test: `src/capabilities/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `BinaryProbe`, `Capabilities`, `HarnessCapability`, `PROBED_HARNESSES`, `probeAll`.
- Produces: `readCapabilities(workspaceDir): Promise<Capabilities | null>`; `writeCapabilities(workspaceDir, caps): Promise<string>`; `fromProbes(probes, now): Capabilities`; `confirm(caps, now): Capabilities`; `drift(recorded, fresh): string[]`.

`drift` is why the file stores provenance: it names each harness whose freshly-probed presence disagrees with what was recorded, so a proposal built on a stale claim can be caught instead of silently trusted.

- [ ] **Step 1: Write the failing test**

Create `src/capabilities/__tests__/store.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirm, drift, fromProbes, readCapabilities, writeCapabilities } from "../store";

const NOW = "2026-08-15T00:00:00.000Z";

test("a missing file reads as null, never a throw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-caps-"));
  expect(await readCapabilities(dir)).toBeNull();
});

test("probes become capabilities tagged as unconfirmed probe results", async () => {
  const caps = fromProbes([{ bin: "claude", present: true, version: "5.0.0" }], NOW);
  expect(caps.confirmed).toBe(false);
  expect(caps.harnesses).toEqual([
    { id: "claude-code", bin: "claude", present: true, version: "5.0.0", source: "probe", checkedAt: NOW },
  ]);
});

test("capabilities round-trip through the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-caps-"));
  const caps = fromProbes([{ bin: "gemini", present: true, version: "3.1.0" }], NOW);
  await writeCapabilities(dir, caps);
  expect(await readCapabilities(dir)).toEqual(caps);
});

test("confirming marks every entry as the PE's word, not a probe's", () => {
  const caps = confirm(fromProbes([{ bin: "claude", present: true, version: "5.0.0" }], NOW), NOW);
  expect(caps.confirmed).toBe(true);
  expect(caps.harnesses[0]!.source).toBe("pe-confirmed");
});

test("drift names a harness whose fresh probe disagrees with the record", () => {
  const recorded = fromProbes([
    { bin: "claude", present: true, version: "5.0.0" },
    { bin: "gemini", present: true, version: "3.1.0" },
  ], NOW);
  const fresh = [
    { bin: "claude", present: true, version: "5.0.0" },
    { bin: "gemini", present: false, version: null },
  ];
  expect(drift(recorded, fresh)).toEqual(["gemini"]);
});

test("drift is empty when the record and a fresh probe agree", () => {
  const recorded = fromProbes([{ bin: "claude", present: true, version: "5.0.0" }], NOW);
  expect(drift(recorded, [{ bin: "claude", present: true, version: "5.0.0" }])).toEqual([]);
});

test("a version change alone is not drift — only presence is", () => {
  const recorded = fromProbes([{ bin: "claude", present: true, version: "5.0.0" }], NOW);
  expect(drift(recorded, [{ bin: "claude", present: true, version: "5.1.0" }])).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/capabilities/__tests__/store.test.ts`
Expected: FAIL — `Cannot find module '../store'`

- [ ] **Step 3: Write the store**

Create `src/capabilities/store.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { PROBED_HARNESSES } from "./probe";
import type { BinaryProbe, Capabilities, HarnessCapability } from "./types";

function capsPath(workspaceDir: string): string {
  return join(workspaceDir, ".aipe", "capabilities.yaml");
}

export async function readCapabilities(workspaceDir: string): Promise<Capabilities | null> {
  try {
    const parsed = parse(await readFile(capsPath(workspaceDir), "utf8"));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.harnesses)) return null;
    return { harnesses: parsed.harnesses as HarnessCapability[], confirmed: parsed.confirmed === true };
  } catch {
    return null;
  }
}

export async function writeCapabilities(workspaceDir: string, caps: Capabilities): Promise<string> {
  const path = capsPath(workspaceDir);
  await mkdir(join(workspaceDir, ".aipe"), { recursive: true });
  await writeFile(path, stringify(caps), "utf8");
  return path;
}

// `now` is a parameter, not Date.now(): the stored timestamp is the whole point
// of provenance, and a test that cannot pin it cannot assert on it.
export function fromProbes(probes: BinaryProbe[], now: string): Capabilities {
  const harnesses: HarnessCapability[] = [];
  for (const p of probes) {
    const known = PROBED_HARNESSES.find((h) => h.bin === p.bin);
    if (!known) continue;
    harnesses.push({
      id: known.id,
      bin: p.bin,
      present: p.present,
      version: p.version,
      source: "probe",
      checkedAt: now,
    });
  }
  return { harnesses, confirmed: false };
}

// The PE's word outranks a probe. Recording that as the entry's `source` is
// what stops a later probe from silently overwriting a correction.
export function confirm(caps: Capabilities, now: string): Capabilities {
  return {
    confirmed: true,
    harnesses: caps.harnesses.map((h) => ({ ...h, source: "pe-confirmed", checkedAt: now })),
  };
}

// Only PRESENCE counts as drift. A version bump is normal and constant; a
// harness appearing or disappearing changes what may be dispatched.
export function drift(recorded: Capabilities, fresh: BinaryProbe[]): string[] {
  const out: string[] = [];
  for (const f of fresh) {
    const r = recorded.harnesses.find((h) => h.bin === f.bin);
    if (r && r.present !== f.present) out.push(f.bin);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/capabilities/__tests__/store.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: The mandatory real-binary check**

This feature spawns real harness binaries. The predecessor branch shipped a whole dispatch path that had never once run, because every test used a fake runner that accepted any argv. Do this once, by hand, and record the output in your report:

```bash
bun -e 'import { probeAll, realProbeRunner } from "./src/capabilities/probe";
console.log(await probeAll(realProbeRunner));'
```

Expected: a `BinaryProbe[]` with one entry per harness, `present: true` for those actually installed on this machine and `present: false` (never a throw, never a crash) for those absent. **Report exactly what came back.** If a binary is present but the version regex misses it, fix the regex — that is precisely the class of defect this step exists to catch.

- [ ] **Step 6: Commit**

```bash
git add src/capabilities/store.ts src/capabilities/__tests__/store.test.ts
git commit -m "feat(capabilities): store com proveniência e detecção de deriva"
```

---

### Task 3: `aipe capabilities` CLI

**Files:**
- Create: `src/capabilities/cli.ts`
- Test: `src/capabilities/__tests__/cli.test.ts`

**Interfaces:**
- Consumes: `probeAll`, `realProbeRunner`, `readCapabilities`, `writeCapabilities`, `fromProbes`, `confirm`, `drift`.
- Produces: `probeCommand(workspaceDir, runner, now): Promise<{ code: number; lines: string[] }>`; `showCommand(workspaceDir, runner, now)`; `confirmCommand(workspaceDir, now)`; `run(args): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Create `src/capabilities/__tests__/cli.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirmCommand, probeCommand, showCommand } from "../cli";
import { readCapabilities } from "../store";
import type { ProbeRunner } from "../types";

const NOW = "2026-08-15T00:00:00.000Z";
const only = (present: string[]): ProbeRunner => async (bin) =>
  present.includes(bin) ? { code: 0, stdout: `${bin} 1.2.3`, stderr: "" } : { code: 127, stdout: "", stderr: "" };

test("probe writes the file and reports what it found", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  const r = await probeCommand(dir, only(["claude", "gemini"]), NOW);
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "OK claude-code claude 1.2.3",
    "OK gemini gemini 1.2.3",
    "-- codex codex absent",
    "-- copilot copilot absent",
    "NOTE capabilities: probed, not confirmed — a binary on PATH is not an authenticated binary. Run `aipe capabilities confirm` once you have checked.",
  ]);
  const caps = await readCapabilities(dir);
  expect(caps!.confirmed).toBe(false);
});

test("confirm marks the file as the PE's word", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  await probeCommand(dir, only(["claude"]), NOW);
  const r = await confirmCommand(dir, NOW);
  expect(r.code).toBe(0);
  expect(r.lines).toEqual(["OK capabilities confirmed 4 harnesses"]);
  const caps = await readCapabilities(dir);
  expect(caps!.confirmed).toBe(true);
  expect(caps!.harnesses.every((h) => h.source === "pe-confirmed")).toBe(true);
});

test("confirm with no file errors rather than confirming nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  const r = await confirmCommand(dir, NOW);
  expect(r.code).toBe(1);
  expect(r.lines).toEqual(["ERROR capabilities: nothing to confirm — run `aipe capabilities probe` first"]);
});

test("show reports drift when a recorded harness has since disappeared", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  await probeCommand(dir, only(["claude", "gemini"]), NOW);
  const r = await showCommand(dir, only(["claude"]), NOW);
  expect(r.code).toBe(2);
  expect(r.lines).toContain("DRIFT gemini — recorded present, now absent. Re-run `aipe capabilities probe`.");
});

test("show with no drift exits 0", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  await probeCommand(dir, only(["claude"]), NOW);
  const r = await showCommand(dir, only(["claude"]), NOW);
  expect(r.code).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/capabilities/__tests__/cli.test.ts`
Expected: FAIL — `Cannot find module '../cli'`

- [ ] **Step 3: Write the CLI**

Create `src/capabilities/cli.ts`:

```ts
#!/usr/bin/env bun
// `aipe capabilities <probe|show|confirm>` — what this machine can actually run.
import { probeAll, realProbeRunner } from "./probe";
import { confirm, drift, fromProbes, readCapabilities, writeCapabilities } from "./store";
import type { ProbeRunner } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

const UNCONFIRMED_NOTE =
  "NOTE capabilities: probed, not confirmed — a binary on PATH is not an authenticated binary. Run `aipe capabilities confirm` once you have checked.";

export async function probeCommand(
  workspaceDir: string,
  runner: ProbeRunner,
  now: string,
): Promise<{ code: number; lines: string[] }> {
  const caps = fromProbes(await probeAll(runner), now);
  await writeCapabilities(workspaceDir, caps);
  const lines = caps.harnesses.map((h) =>
    h.present ? `OK ${h.id} ${h.bin} ${h.version ?? "unversioned"}` : `-- ${h.id} ${h.bin} absent`,
  );
  lines.push(UNCONFIRMED_NOTE);
  return { code: 0, lines };
}

export async function confirmCommand(
  workspaceDir: string,
  now: string,
): Promise<{ code: number; lines: string[] }> {
  const caps = await readCapabilities(workspaceDir);
  if (!caps) {
    return {
      code: 1,
      lines: ["ERROR capabilities: nothing to confirm — run `aipe capabilities probe` first"],
    };
  }
  await writeCapabilities(workspaceDir, confirm(caps, now));
  return { code: 0, lines: [`OK capabilities confirmed ${caps.harnesses.length} harnesses`] };
}

export async function showCommand(
  workspaceDir: string,
  runner: ProbeRunner,
  now: string,
): Promise<{ code: number; lines: string[] }> {
  const caps = await readCapabilities(workspaceDir);
  if (!caps) {
    return { code: 1, lines: ["ERROR capabilities: no record — run `aipe capabilities probe` first"] };
  }
  const lines = caps.harnesses.map(
    (h) => `${h.present ? "OK" : "--"} ${h.id} ${h.bin} ${h.version ?? "unversioned"} (${h.source} ${h.checkedAt})`,
  );
  if (!caps.confirmed) lines.push(UNCONFIRMED_NOTE);
  const drifted = drift(caps, await probeAll(runner));
  for (const bin of drifted) {
    const rec = caps.harnesses.find((h) => h.bin === bin)!;
    lines.push(
      `DRIFT ${bin} — recorded ${rec.present ? "present" : "absent"}, now ${rec.present ? "absent" : "present"}. Re-run \`aipe capabilities probe\`.`,
    );
  }
  return { code: drifted.length > 0 ? 2 : 0, lines };
}

const HELP = [
  "aipe capabilities — what this machine can actually run",
  "",
  "  probe    [--workspace <dir>]   Detect harness binaries and record them",
  "  show     [--workspace <dir>]   Print the record and flag any drift",
  "  confirm  [--workspace <dir>]   Mark the record as checked by you",
].join("\n");

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  const workspace = getFlag(rest, "--workspace") ?? process.cwd();
  const now = new Date().toISOString();
  let result: { code: number; lines: string[] } | null = null;
  switch (sub) {
    case "probe":
      result = await probeCommand(workspace, realProbeRunner, now);
      break;
    case "show":
      result = await showCommand(workspace, realProbeRunner, now);
      break;
    case "confirm":
      result = await confirmCommand(workspace, now);
      break;
    default:
      console.log(HELP);
      return sub === undefined || sub === "--help" ? 0 : 1;
  }
  for (const line of result.lines) console.log(line);
  return result.code;
}
```

Note: do **not** import `PROBED_HARNESSES` here — `store.ts` owns that mapping and `cli.ts` has no use for it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/capabilities && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — 5 tests, no type errors

- [ ] **Step 5: Commit**

```bash
git add src/capabilities/cli.ts src/capabilities/__tests__/cli.test.ts
git commit -m "feat(capabilities): subcomando probe/show/confirm com aviso de não-confirmado"
```

---

### Task 4: Execution policy

**Files:**
- Create: `src/execution/types.ts`
- Create: `src/execution/policy.ts`
- Test: `src/execution/__tests__/policy.test.ts`

**Interfaces:**
- Consumes: `ModelTier` from `src/model/types.ts`.
- Produces: `ExecutionPolicy`; `defaultExecutionPolicy(): ExecutionPolicy`; `readExecutionPolicy(workspaceDir): Promise<ExecutionPolicy>`.

This mirrors `src/model/policy.ts` deliberately — same shape, same conservative-fallback discipline. Read that file before writing this one.

- [ ] **Step 1: Write the failing test**

Create `src/execution/__tests__/policy.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultExecutionPolicy, readExecutionPolicy } from "../policy";

async function ws(yaml?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-execpol-"));
  if (yaml !== undefined) {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "execution-policy.yaml"), yaml, "utf8");
  }
  return dir;
}

test("the defaults are conservative", () => {
  expect(defaultExecutionPolicy()).toEqual({
    maxSessionsPerWave: 4,
    gateAboveSessions: 2,
    gatedIntensities: ["ultracode"],
    gatedTiers: ["frontier"],
    maxCostIndexPerWave: 24,
  });
});

test("an absent file yields the defaults", async () => {
  expect(await readExecutionPolicy(await ws())).toEqual(defaultExecutionPolicy());
});

test("a malformed file yields the defaults rather than throwing", async () => {
  expect(await readExecutionPolicy(await ws("]["))).toEqual(defaultExecutionPolicy());
});

test("a partial file overrides only what it names", async () => {
  const p = await readExecutionPolicy(await ws("gateAboveSessions: 1\n"));
  expect(p.gateAboveSessions).toBe(1);
  expect(p.maxSessionsPerWave).toBe(4);
});

test("maxSessionsPerWave is clamped to the dispatch law's ceiling, never raised past it", async () => {
  const p = await readExecutionPolicy(await ws("maxSessionsPerWave: 99\n"));
  expect(p.maxSessionsPerWave).toBe(4);
});

test("a nonsensical value is ignored rather than accepted", async () => {
  const p = await readExecutionPolicy(await ws("maxCostIndexPerWave: -5\n"));
  expect(p.maxCostIndexPerWave).toBe(24);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/execution/__tests__/policy.test.ts`
Expected: FAIL — `Cannot find module '../policy'`

- [ ] **Step 3: Write the types**

Create `src/execution/types.ts`:

```ts
import type { ModelTier } from "../model/types";
// Reuse, never redefine: `src/session/types.ts` already owns these two unions
// and the ledger is written against them. A second copy here would diverge the
// first time one of them gains a member.
import type { Intensity, SessionMode } from "../session/types";

export type { Intensity, SessionMode };

// The limits the PE does not negotiate. Sibling of ModelPolicy: same shape,
// same conservative fallback, and gating is expressed here ONCE rather than in
// a second vocabulary.
export interface ExecutionPolicy {
  maxSessionsPerWave: number;
  gateAboveSessions: number;
  gatedIntensities: Intensity[];
  gatedTiers: ModelTier[];
  maxCostIndexPerWave: number;
}

// One concrete way to run one unit.
export interface Envelope {
  mode: SessionMode;
  harness: string;
  tier: ModelTier;
  intensity: Intensity;
}

export interface PricedEnvelope {
  envelope: Envelope;
  costIndex: number;
  gated: boolean;
  gateReasons: string[];
}

export interface UnitProposal {
  fqid: string;
  options: PricedEnvelope[];
  excluded: { harness: string; reason: string }[];
}

export interface Proposal {
  units: UnitProposal[];
  notes: string[];
}
```

- [ ] **Step 4: Write the policy loader**

Create `src/execution/policy.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { SESSION_MAX_CONCURRENT } from "../dispatch/types";
import { isTier, type ModelTier } from "../model/types";
import type { ExecutionPolicy, Intensity } from "./types";

export function defaultExecutionPolicy(): ExecutionPolicy {
  return {
    maxSessionsPerWave: SESSION_MAX_CONCURRENT,
    gateAboveSessions: 2,
    gatedIntensities: ["ultracode"],
    gatedTiers: ["frontier"],
    maxCostIndexPerWave: 24,
  };
}

function positive(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export async function readExecutionPolicy(workspaceDir: string): Promise<ExecutionPolicy> {
  const base = defaultExecutionPolicy();
  let parsed: unknown;
  try {
    parsed = parse(await readFile(join(workspaceDir, ".aipe", "execution-policy.yaml"), "utf8"));
  } catch {
    return base;
  }
  if (!parsed || typeof parsed !== "object") return base;
  const p = parsed as Record<string, unknown>;
  const merged: ExecutionPolicy = { ...base };

  // Clamped, never raised: the dispatch law's ceiling is the hard limit and a
  // policy file must not be able to talk past it.
  const maxSessions = positive(p.maxSessionsPerWave);
  if (maxSessions !== null) merged.maxSessionsPerWave = Math.min(maxSessions, SESSION_MAX_CONCURRENT);

  const gateAbove = positive(p.gateAboveSessions);
  if (gateAbove !== null) merged.gateAboveSessions = gateAbove;

  const maxCost = positive(p.maxCostIndexPerWave);
  if (maxCost !== null) merged.maxCostIndexPerWave = maxCost;

  if (Array.isArray(p.gatedTiers)) {
    const tiers = p.gatedTiers.filter(isTier) as ModelTier[];
    if (tiers.length > 0) merged.gatedTiers = tiers;
  }
  if (Array.isArray(p.gatedIntensities)) {
    const list = p.gatedIntensities.filter(
      (i): i is Intensity => i === "normal" || i === "ultracode",
    );
    if (list.length > 0) merged.gatedIntensities = list;
  }
  return merged;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/execution/__tests__/policy.test.ts && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — 6 tests, no type errors

- [ ] **Step 6: Commit**

```bash
git add src/execution/types.ts src/execution/policy.ts src/execution/__tests__/policy.test.ts
git commit -m "feat(execution): política de execução com defaults conservadores"
```

---

### Task 5: The cost index

**Files:**
- Create: `src/execution/cost.ts`
- Test: `src/execution/__tests__/cost.test.ts`

**Interfaces:**
- Consumes: `Envelope` from `src/execution/types.ts`.
- Produces: `MODE_MULTIPLIER`, `TIER_MULTIPLIER`, `INTENSITY_MULTIPLIER`; `costIndex(envelope): number`; `waveCostIndex(envelopes): number`.

**This is an index, not money.** The cheapest envelope — subagent + `fast` + `normal` — is `1`. AIPe cannot know a token price, a plan, or a rate limit. Every surface that displays this number labels it an index. A currency symbol anywhere in this task is a failure.

- [ ] **Step 1: Write the failing test**

Create `src/execution/__tests__/cost.test.ts`:

```ts
import { expect, test } from "bun:test";
import { costIndex, waveCostIndex } from "../cost";
import type { Envelope } from "../types";

const base: Envelope = { mode: "subagent", harness: "claude-code", tier: "fast", intensity: "normal" };

test("the cheapest envelope is the unit of measure", () => {
  expect(costIndex(base)).toBe(1);
});

test("every tier is a distinct integer — none collapse onto another", () => {
  const seen = (["fast", "standard", "reasoning", "frontier"] as const).map((tier) => costIndex({ ...base, tier }));
  expect(new Set(seen).size).toBe(4);
});

test("a session costs more than a subagent, all else equal", () => {
  expect(costIndex({ ...base, mode: "session" })).toBeGreaterThan(costIndex(base));
});

test("tiers are ordered fast < standard < reasoning < frontier", () => {
  const c = (tier: Envelope["tier"]) => costIndex({ ...base, tier });
  expect(c("fast")).toBeLessThan(c("standard"));
  expect(c("standard")).toBeLessThan(c("reasoning"));
  expect(c("reasoning")).toBeLessThan(c("frontier"));
});

test("ultracode is the single largest multiplier — it fans out into many agents", () => {
  const withUltra = costIndex({ ...base, intensity: "ultracode" });
  const withFrontier = costIndex({ ...base, tier: "frontier" });
  const withSession = costIndex({ ...base, mode: "session" });
  expect(withUltra).toBeGreaterThan(withFrontier);
  expect(withUltra).toBeGreaterThan(withSession);
});

test("the index is a whole number — it is coarse by design", () => {
  expect(Number.isInteger(costIndex({ mode: "session", harness: "gemini", tier: "frontier", intensity: "ultracode" }))).toBe(true);
});

test("a wave costs the sum of its units", () => {
  expect(waveCostIndex([base, base, base])).toBe(3);
});

test("the reference values are the documented ones", () => {
  expect(costIndex({ ...base, tier: "standard" })).toBe(2);
  expect(costIndex({ ...base, mode: "session", tier: "standard" })).toBe(4);
  expect(costIndex({ mode: "session", harness: "x", tier: "frontier", intensity: "ultracode" })).toBe(96);
});

test("an empty wave costs nothing", () => {
  expect(waveCostIndex([])).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/execution/__tests__/cost.test.ts`
Expected: FAIL — `Cannot find module '../cost'`

- [ ] **Step 3: Write the cost index**

Create `src/execution/cost.ts`:

```ts
// A COARSE RELATIVE INDEX, never currency. The CHEAPEST envelope — subagent +
// `fast` + `normal` — is 1, and every other combination is a whole multiple of
// it. The reference is the cheapest rather than a mid-tier one so that every
// tier stays a distinct integer: anchoring at `standard` and dividing collapses
// `fast` and `standard` onto the same value.
// AIPe cannot know a token price, a plan, or a rate limit, so any
// figure that looked like money would be fabricated. The index exists to make
// RELATIVE choices legible — that ultracode across four session units is an
// order of magnitude above one subagent — not to predict a bill.
import type { Envelope, Intensity } from "./types";
import type { ModelTier } from "../model/types";

// A detached session carries its own full context window, so it reads and
// re-reads more than a subagent sharing the coordinator's.
export const MODE_MULTIPLIER: Record<Envelope["mode"], number> = {
  subagent: 1,
  session: 2,
};

export const TIER_MULTIPLIER: Record<ModelTier, number> = {
  fast: 1,
  standard: 2,
  reasoning: 4,
  frontier: 6,
};

// ultracode makes the specialist orchestrate multi-agent workflows: it does not
// scale the unit, it multiplies the number of agents inside it.
export const INTENSITY_MULTIPLIER: Record<Intensity, number> = {
  normal: 1,
  ultracode: 8,
};

export function costIndex(envelope: Envelope): number {
  // No normalisation: every multiplier is a whole number and the cheapest
  // envelope already lands on 1, so the product is the index.
  return (
    MODE_MULTIPLIER[envelope.mode] *
    TIER_MULTIPLIER[envelope.tier] *
    INTENSITY_MULTIPLIER[envelope.intensity]
  );
}

export function waveCostIndex(envelopes: Envelope[]): number {
  return envelopes.reduce((sum, e) => sum + costIndex(e), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/execution/__tests__/cost.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/execution/cost.ts src/execution/__tests__/cost.test.ts
git commit -m "feat(execution): índice de custo relativo, explicitamente não-moeda"
```

---

### Task 6: The proposal

**Files:**
- Create: `src/execution/propose.ts`
- Test: `src/execution/__tests__/propose.test.ts`

**Interfaces:**
- Consumes: `ExecutionPolicy`, `Envelope`, `PricedEnvelope`, `UnitProposal` (Task 4); `costIndex` (Task 5); `Capabilities` (Task 1); `isContainable`, `getAdapter` from `src/harness/`.
- Produces: `proposeForUnit(fqid, caps, policy, opts): UnitProposal`.

**Eligibility is consulted, never re-decided.** `isContainable` is the single authority on whether a harness may be session-dispatched. A proposal that offered something `validateBatch` would then reject is worse than no proposal.

- [ ] **Step 1: Write the failing test**

Create `src/execution/__tests__/propose.test.ts`:

```ts
import { expect, test } from "bun:test";
import { proposeForUnit } from "../propose";
import { defaultExecutionPolicy } from "../policy";
import type { Capabilities } from "../../capabilities/types";

const NOW = "2026-08-15T00:00:00.000Z";
const caps = (present: string[]): Capabilities => ({
  confirmed: true,
  harnesses: [
    { id: "claude-code", bin: "claude", present: present.includes("claude-code"), version: "1", source: "pe-confirmed", checkedAt: NOW },
    { id: "gemini", bin: "gemini", present: present.includes("gemini"), version: "1", source: "pe-confirmed", checkedAt: NOW },
    { id: "codex", bin: "codex", present: present.includes("codex"), version: "1", source: "pe-confirmed", checkedAt: NOW },
  ],
});

test("an absent harness never appears as an option", () => {
  const p = proposeForUnit("embark", caps(["claude-code"]), defaultExecutionPolicy(), {});
  expect(p.options.some((o) => o.envelope.harness === "gemini")).toBe(false);
});

test("a present but non-containable harness is excluded from SESSION mode, with the reason stated", () => {
  const p = proposeForUnit("embark", caps(["claude-code", "codex"]), defaultExecutionPolicy(), {});
  expect(p.options.some((o) => o.envelope.harness === "codex" && o.envelope.mode === "session")).toBe(false);
  expect(p.excluded).toContainEqual({
    harness: "codex",
    reason: "not containable — AIPe never starts a session it cannot govern",
  });
});

test("ultracode and frontier are marked gated, with their reasons", () => {
  const p = proposeForUnit("embark", caps(["claude-code"]), defaultExecutionPolicy(), {});
  const ultra = p.options.find((o) => o.envelope.intensity === "ultracode")!;
  expect(ultra.gated).toBe(true);
  expect(ultra.gateReasons).toContain("intensity ultracode requires your authorization");
  const frontier = p.options.find((o) => o.envelope.tier === "frontier" && o.envelope.intensity === "normal")!;
  expect(frontier.gateReasons).toEqual(["tier frontier requires your authorization"]);
});

test("an ordinary envelope is not gated", () => {
  const p = proposeForUnit("embark", caps(["claude-code"]), defaultExecutionPolicy(), {});
  const plain = p.options.find(
    (o) => o.envelope.mode === "subagent" && o.envelope.tier === "standard" && o.envelope.intensity === "normal",
  )!;
  expect(plain.gated).toBe(false);
  expect(plain.gateReasons).toEqual([]);
});

test("options are ordered cheapest first, so the default reading is the cheap one", () => {
  const p = proposeForUnit("embark", caps(["claude-code"]), defaultExecutionPolicy(), {});
  const costs = p.options.map((o) => o.costIndex);
  expect([...costs].sort((a, b) => a - b)).toEqual(costs);
});

test("every option carries a cost index", () => {
  const p = proposeForUnit("embark", caps(["claude-code"]), defaultExecutionPolicy(), {});
  expect(p.options.every((o) => Number.isInteger(o.costIndex) && o.costIndex > 0)).toBe(true);
});

test("with no harness present at all, there are no options and the reason says so", () => {
  const p = proposeForUnit("embark", caps([]), defaultExecutionPolicy(), {});
  expect(p.options).toEqual([]);
  expect(p.excluded.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/execution/__tests__/propose.test.ts`
Expected: FAIL — `Cannot find module '../propose'`

- [ ] **Step 3: Write the proposer**

Create `src/execution/propose.ts`:

```ts
// Enumerates and PRICES the viable ways to run one unit. It never chooses —
// the choice, and the reasoning behind it, belong to the coordinator.
import { getAdapter } from "../harness/registry";
import { isContainable } from "../harness/types";
import { TIERS, type ModelTier } from "../model/types";
import type { Capabilities } from "../capabilities/types";
import { costIndex } from "./cost";
import type { Envelope, ExecutionPolicy, Intensity, PricedEnvelope, UnitProposal } from "./types";

const MODES: Envelope["mode"][] = ["subagent", "session"];
const INTENSITIES: Intensity[] = ["normal", "ultracode"];

function gateReasonsFor(env: Envelope, policy: ExecutionPolicy): string[] {
  const reasons: string[] = [];
  if (policy.gatedIntensities.includes(env.intensity)) {
    reasons.push(`intensity ${env.intensity} requires your authorization`);
  }
  if (policy.gatedTiers.includes(env.tier)) {
    reasons.push(`tier ${env.tier} requires your authorization`);
  }
  return reasons;
}

export interface ProposeOptions {
  // Restrict to these harness ids (e.g. the PE pinned one). Absent = all present.
  harnesses?: string[];
}

export function proposeForUnit(
  fqid: string,
  caps: Capabilities,
  policy: ExecutionPolicy,
  opts: ProposeOptions,
): UnitProposal {
  const options: PricedEnvelope[] = [];
  const excluded: { harness: string; reason: string }[] = [];

  for (const cap of caps.harnesses) {
    if (opts.harnesses && !opts.harnesses.includes(cap.id)) continue;
    if (!cap.present) {
      excluded.push({ harness: cap.id, reason: "not present on this machine" });
      continue;
    }
    // Consult the single authority; never keep a second opinion.
    const containable = isContainable(getAdapter(cap.id));
    if (!containable) {
      excluded.push({
        harness: cap.id,
        reason: "not containable — AIPe never starts a session it cannot govern",
      });
    }
    for (const mode of MODES) {
      if (mode === "session" && !containable) continue;
      for (const tier of TIERS as ModelTier[]) {
        for (const intensity of INTENSITIES) {
          const envelope: Envelope = { mode, harness: cap.id, tier, intensity };
          const reasons = gateReasonsFor(envelope, policy);
          options.push({
            envelope,
            costIndex: costIndex(envelope),
            gated: reasons.length > 0,
            gateReasons: reasons,
          });
        }
      }
    }
  }

  // Cheapest first: the default reading of this list should be the cheap one.
  options.sort((a, b) => a.costIndex - b.costIndex);
  return { fqid, options, excluded };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/execution/__tests__/propose.test.ts && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — 7 tests, no type errors

- [ ] **Step 5: Commit**

```bash
git add src/execution/propose.ts src/execution/__tests__/propose.test.ts
git commit -m "feat(execution): proposta enumera e precifica sem escolher"
```

---

### Task 7: Grouping units into waves by model

**Files:**
- Create: `src/execution/waves.ts`
- Test: `src/execution/__tests__/waves.test.ts`

**Interfaces:**
- Consumes: `Envelope`, `ExecutionPolicy` (Task 4); `waveCostIndex` (Task 5).
- Produces: `ChosenUnit`, `Wave`, `groupIntoWaves(chosen, policy): { waves: Wave[]; notes: string[] }`.

**Why this exists:** in session mode `agentop` treats `--model` as a **batch-level** flag, and `startBatch` refuses a wave whose units disagree. So per-unit models require splitting into waves. When that split costs an extra wave, say so — the PE decides whether finer model choice is worth the extra round.

**This task also wires the two wave-level policy fields.** `maxCostIndexPerWave` and `gateAboveSessions` are loaded by Task 4 and consulted by nothing until here. A policy field that is read and never enforced is worse than no field: it reads as a limit while permitting everything. Each wave therefore carries its own cost index and its own gate reasons.

- [ ] **Step 1: Write the failing test**

Create `src/execution/__tests__/waves.test.ts`:

```ts
import { expect, test } from "bun:test";
import { groupIntoWaves } from "../waves";
import { defaultExecutionPolicy } from "../policy";
import type { Envelope } from "../types";

const session = (harness = "claude-code"): Envelope => ({ mode: "session", harness, tier: "standard", intensity: "normal" });
const subagent: Envelope = { mode: "subagent", harness: "claude-code", tier: "standard", intensity: "normal" };
const ultra: Envelope = { mode: "session", harness: "claude-code", tier: "frontier", intensity: "ultracode" };

test("session units sharing a model form one wave", () => {
  const r = groupIntoWaves(
    [
      { fqid: "a", envelope: session(), model: "m1" },
      { fqid: "b", envelope: session(), model: "m1" },
    ],
    defaultExecutionPolicy(),
  );
  expect(r.waves).toHaveLength(1);
  expect(r.waves[0]!.model).toBe("m1");
  expect(r.waves[0]!.units).toEqual(["a", "b"]);
  expect(r.notes).toEqual([]);
});

test("session units wanting different models split, and the extra wave is stated", () => {
  const r = groupIntoWaves(
    [
      { fqid: "a", envelope: session(), model: "m1" },
      { fqid: "b", envelope: session(), model: "m2" },
    ],
    defaultExecutionPolicy(),
  );
  expect(r.waves.map((w) => [w.model, w.units])).toEqual([
    ["m1", ["a"]],
    ["m2", ["b"]],
  ]);
  expect(r.notes).toEqual([
    "2 waves instead of 1: agentop binds --model per batch, so units wanting different models cannot share a wave. Subagent mode binds the model per unit if one wave matters more than the finer choice.",
  ]);
});

test("subagent units never force a split — the model binds per unit there", () => {
  const r = groupIntoWaves(
    [
      { fqid: "a", envelope: subagent, model: "m1" },
      { fqid: "b", envelope: subagent, model: "m2" },
    ],
    defaultExecutionPolicy(),
  );
  expect(r.waves.map((w) => [w.model, w.units])).toEqual([[null, ["a", "b"]]]);
  expect(r.notes).toEqual([]);
});

test("a session wave above the policy ceiling is split and the split is stated", () => {
  const units = ["a", "b", "c", "d", "e"].map((fqid) => ({ fqid, envelope: session(), model: "m1" }));
  const r = groupIntoWaves(units, { ...defaultExecutionPolicy(), maxSessionsPerWave: 2 });
  expect(r.waves.map((w) => w.units)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  expect(r.notes).toContain("3 waves instead of 1: the policy caps a wave at 2 concurrent sessions.");
});

test("mixed modes keep session and subagent units in separate waves", () => {
  const r = groupIntoWaves(
    [
      { fqid: "a", envelope: session(), model: "m1" },
      { fqid: "b", envelope: subagent, model: "m2" },
    ],
    defaultExecutionPolicy(),
  );
  expect(r.waves.map((w) => [w.model, w.units])).toEqual([
    ["m1", ["a"]],
    [null, ["b"]],
  ]);
});

// --- the two wave-level policy fields, which nothing consulted before this ---

test("a wave carries its own cost index", () => {
  const r = groupIntoWaves(
    [
      { fqid: "a", envelope: session(), model: "m1" },
      { fqid: "b", envelope: session(), model: "m1" },
    ],
    defaultExecutionPolicy(),
  );
  expect(r.waves[0]!.costIndex).toBe(8); // two session/standard/normal units at 4 each
});

test("a wave above gateAboveSessions is gated, naming the count", () => {
  const units = ["a", "b", "c"].map((fqid) => ({ fqid, envelope: session(), model: "m1" }));
  const r = groupIntoWaves(units, defaultExecutionPolicy());
  expect(r.waves[0]!.gated).toBe(true);
  expect(r.waves[0]!.gateReasons).toContain("3 concurrent sessions exceeds the policy's gate of 2 — needs your authorization");
});

test("a wave at or below gateAboveSessions is not gated on session count", () => {
  const units = ["a", "b"].map((fqid) => ({ fqid, envelope: session(), model: "m1" }));
  const r = groupIntoWaves(units, defaultExecutionPolicy());
  expect(r.waves[0]!.gateReasons.some((g) => g.includes("concurrent sessions"))).toBe(false);
});

test("a wave over the cost ceiling is gated, naming the index and the ceiling", () => {
  const r = groupIntoWaves([{ fqid: "a", envelope: ultra, model: "m1" }], {
    ...defaultExecutionPolicy(),
    maxCostIndexPerWave: 10,
  });
  expect(r.waves[0]!.gated).toBe(true);
  expect(r.waves[0]!.gateReasons).toContain("cost-index 96 exceeds the policy ceiling of 10 — needs your authorization");
});

test("a subagent wave is not gated on session count, however many units it has", () => {
  const units = ["a", "b", "c", "d", "e"].map((fqid) => ({ fqid, envelope: subagent, model: null }));
  const r = groupIntoWaves(units, defaultExecutionPolicy());
  expect(r.waves[0]!.gateReasons.some((g) => g.includes("concurrent sessions"))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/execution/__tests__/waves.test.ts`
Expected: FAIL — `Cannot find module '../waves'`

- [ ] **Step 3: Write the grouper**

Create `src/execution/waves.ts`:

```ts
// agentop binds --model per BATCH, not per session, and startBatch refuses a
// wave whose units disagree. So per-unit model choice in session mode costs
// extra waves. That trade is the PE's to make, so it is stated, never hidden.
//
// This module is also where the two WAVE-LEVEL policy fields are enforced.
// `maxCostIndexPerWave` and `gateAboveSessions` are loaded by policy.ts and
// consulted nowhere else; a policy field that is read and never enforced reads
// as a limit while permitting everything.
import { costIndex } from "./cost";
import type { Envelope, ExecutionPolicy } from "./types";

export interface ChosenUnit {
  fqid: string;
  envelope: Envelope;
  model: string | null;
}

export interface Wave {
  model: string | null; // null for subagent waves — the model binds per unit there
  units: string[];
  costIndex: number;
  gated: boolean;
  gateReasons: string[];
}

function buildWave(
  model: string | null,
  members: ChosenUnit[],
  policy: ExecutionPolicy,
  isSession: boolean,
): Wave {
  const cost = members.reduce((sum, m) => sum + costIndex(m.envelope), 0);
  const gateReasons: string[] = [];
  // Session count only gates SESSION waves: subagent concurrency is governed by
  // the dispatch law's MAX_CONCURRENT, not by this ceiling.
  if (isSession && members.length > policy.gateAboveSessions) {
    gateReasons.push(
      `${members.length} concurrent sessions exceeds the policy's gate of ${policy.gateAboveSessions} — needs your authorization`,
    );
  }
  if (cost > policy.maxCostIndexPerWave) {
    gateReasons.push(
      `cost-index ${cost} exceeds the policy ceiling of ${policy.maxCostIndexPerWave} — needs your authorization`,
    );
  }
  return {
    model,
    units: members.map((m) => m.fqid),
    costIndex: cost,
    gated: gateReasons.length > 0,
    gateReasons,
  };
}

export function groupIntoWaves(
  chosen: ChosenUnit[],
  policy: ExecutionPolicy,
): { waves: Wave[]; notes: string[] } {
  const notes: string[] = [];

  const sessionUnits = chosen.filter((c) => c.envelope.mode === "session");
  const subagentUnits = chosen.filter((c) => c.envelope.mode === "subagent");

  // Session units group by model, preserving first-seen order.
  const byModel = new Map<string | null, ChosenUnit[]>();
  for (const c of sessionUnits) {
    const list = byModel.get(c.model) ?? [];
    list.push(c);
    byModel.set(c.model, list);
  }

  const waves: Wave[] = [];
  let capped = false;
  for (const [model, members] of byModel) {
    for (let i = 0; i < members.length; i += policy.maxSessionsPerWave) {
      waves.push(buildWave(model, members.slice(i, i + policy.maxSessionsPerWave), policy, true));
      if (i > 0) capped = true;
    }
  }

  if (byModel.size > 1) {
    notes.push(
      `${byModel.size} waves instead of 1: agentop binds --model per batch, so units wanting different models cannot share a wave. Subagent mode binds the model per unit if one wave matters more than the finer choice.`,
    );
  }
  if (capped) {
    notes.push(
      `${waves.length} waves instead of 1: the policy caps a wave at ${policy.maxSessionsPerWave} concurrent sessions.`,
    );
  }

  // Subagent units share one wave: the model binds per unit, so nothing forces
  // a split, and their concurrency is governed by MAX_CONCURRENT, not this cap.
  if (subagentUnits.length > 0) {
    waves.push(buildWave(null, subagentUnits, policy, false));
  }

  return { waves, notes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/execution/__tests__/waves.test.ts && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — 5 tests, no type errors

- [ ] **Step 5: Commit**

```bash
git add src/execution/waves.ts src/execution/__tests__/waves.test.ts
git commit -m "feat(execution): agrupa units em waves por modelo e declara a wave extra"
```

---

### Task 8: `aipe execution propose` CLI

**Files:**
- Create: `src/execution/cli.ts`
- Test: `src/execution/__tests__/cli.test.ts`

**Interfaces:**
- Consumes: `readCapabilities` (Task 2), `readExecutionPolicy` (Task 4), `proposeForUnit` (Task 6), `readLedger` from `src/journey/ledger.ts`, `packageFqid` from `src/context-brain/packages.ts`.
- Produces: `proposeCommand(opts): Promise<{ code: number; lines: string[] }>` where `opts = { workspace: string; journeyId: string }`; `run(args): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Create `src/execution/__tests__/cli.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proposeCommand } from "../cli";
import { writeCapabilities } from "../../capabilities/store";
import { recordDispatch, startJourney } from "../../journey/ledger";
import type { Capabilities } from "../../capabilities/types";

const NOW = "2026-08-15T00:00:00.000Z";
const caps: Capabilities = {
  confirmed: true,
  harnesses: [
    { id: "claude-code", bin: "claude", present: true, version: "1", source: "pe-confirmed", checkedAt: NOW },
  ],
};

async function fixture(withCaps = true): Promise<{ dir: string; journey: string }> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-execcli-"));
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched",
  });
  if (withCaps) await writeCapabilities(dir, caps);
  return { dir, journey: "j1" };
}

test("it proposes options per unit, cheapest first", async () => {
  const { dir, journey } = await fixture();
  const r = await proposeCommand({ workspace: dir, journeyId: journey });
  expect(r.code).toBe(0);
  expect(r.lines[0]).toBe("UNIT embark");
  expect(r.lines[1]).toContain("subagent claude-code fast normal");
  expect(r.lines.some((l) => l.includes("cost-index"))).toBe(true);
});

test("gated options are marked so, with the reason", async () => {
  const { dir, journey } = await fixture();
  const r = await proposeCommand({ workspace: dir, journeyId: journey });
  const gatedLine = r.lines.find((l) => l.includes("ultracode"))!;
  expect(gatedLine).toContain("GATED");
  expect(gatedLine).toContain("requires your authorization");
});

test("without capabilities it refuses rather than guessing", async () => {
  const { dir, journey } = await fixture(false);
  const r = await proposeCommand({ workspace: dir, journeyId: journey });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    "ERROR capabilities: no record — run `aipe capabilities probe` then `aipe capabilities confirm`",
  ]);
});

test("an unknown journey errors", async () => {
  const { dir } = await fixture();
  const r = await proposeCommand({ workspace: dir, journeyId: "nope" });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual(["ERROR journey: no ledger for nope"]);
});

test("unconfirmed capabilities still propose, but say so", async () => {
  const { dir, journey } = await fixture(false);
  await writeCapabilities(dir, { ...caps, confirmed: false });
  const r = await proposeCommand({ workspace: dir, journeyId: journey });
  expect(r.code).toBe(0);
  expect(r.lines).toContain(
    "NOTE capabilities: this record was probed but never confirmed by you — a binary on PATH is not an authenticated binary.",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/execution/__tests__/cli.test.ts`
Expected: FAIL — `Cannot find module '../cli'`

- [ ] **Step 3: Write the CLI**

Create `src/execution/cli.ts`:

```ts
#!/usr/bin/env bun
// `aipe execution propose --journey <id>` — the checkable half of the envelope
// decision. It enumerates and prices; the coordinator chooses and justifies.
import { packageFqid } from "../context-brain/packages";
import { readCapabilities } from "../capabilities/store";
import { readLedger } from "../journey/ledger";
import { readExecutionPolicy } from "./policy";
import { proposeForUnit } from "./propose";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export interface ProposeCommandOptions {
  workspace: string;
  journeyId: string;
}

export async function proposeCommand(
  opts: ProposeCommandOptions,
): Promise<{ code: number; lines: string[] }> {
  const caps = await readCapabilities(opts.workspace);
  if (!caps) {
    return {
      code: 1,
      lines: [
        "ERROR capabilities: no record — run `aipe capabilities probe` then `aipe capabilities confirm`",
      ],
    };
  }
  const ledger = await readLedger(opts.workspace, opts.journeyId);
  if (!ledger) {
    return { code: 1, lines: [`ERROR journey: no ledger for ${opts.journeyId}`] };
  }

  const policy = await readExecutionPolicy(opts.workspace);
  const lines: string[] = [];

  for (const d of ledger.dispatches) {
    const fqid = packageFqid(d.repo, d.package);
    const proposal = proposeForUnit(fqid, caps, policy, {});
    lines.push(`UNIT ${fqid}`);
    for (const o of proposal.options) {
      const e = o.envelope;
      const gate = o.gated ? ` GATED (${o.gateReasons.join("; ")})` : "";
      lines.push(`  ${e.mode} ${e.harness} ${e.tier} ${e.intensity} cost-index=${o.costIndex}${gate}`);
    }
    for (const x of proposal.excluded) {
      lines.push(`  -- ${x.harness} excluded: ${x.reason}`);
    }
  }

  if (!caps.confirmed) {
    lines.push(
      "NOTE capabilities: this record was probed but never confirmed by you — a binary on PATH is not an authenticated binary.",
    );
  }
  lines.push(
    "NOTE cost-index is a COARSE RELATIVE INDEX, not currency: the cheapest envelope (subagent, fast tier, normal intensity) is 1.",
  );
  return { code: 0, lines };
}

const HELP = [
  "aipe execution — price the ways a unit could be run",
  "",
  "  propose --journey <id> [--workspace <dir>]   Enumerate and price the viable envelopes",
].join("\n");

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== "propose") {
    console.log(HELP);
    return sub === undefined || sub === "--help" ? 0 : 1;
  }
  const workspace = getFlag(rest, "--workspace") ?? process.cwd();
  const journeyId = getFlag(rest, "--journey");
  if (!journeyId) {
    console.log("ERROR journey: --journey <id> is required");
    return 1;
  }
  const { code, lines } = await proposeCommand({ workspace, journeyId });
  for (const line of lines) console.log(line);
  return code;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/execution && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — 5 tests, no type errors

- [ ] **Step 5: Commit**

```bash
git add src/execution/cli.ts src/execution/__tests__/cli.test.ts
git commit -m "feat(execution): subcomando propose lista envelopes viáveis e precificados"
```

---

### Task 9: Register both commands

**Files:**
- Modify: `src/cli.ts`
- Test: `src/execution/__tests__/registration.test.ts`

**Interfaces:**
- Consumes: `run` from `src/capabilities/cli.ts` and `src/execution/cli.ts`.
- Produces: `aipe capabilities …` and `aipe execution …` reachable; both listed in the top-level help.

- [ ] **Step 1: Write the failing test**

Create `src/execution/__tests__/registration.test.ts`:

```ts
import { expect, test } from "bun:test";
import { dispatch } from "../../cli";

async function capture(argv: string[]): Promise<{ code: number; out: string }> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try {
    const code = await dispatch(argv);
    return { code, out: lines.join("\n") };
  } finally {
    console.log = original;
  }
}

test("`aipe capabilities` is a known command", async () => {
  const { code, out } = await capture(["capabilities", "--help"]);
  expect(code).toBe(0);
  expect(out).toContain("what this machine can actually run");
});

test("`aipe execution` is a known command", async () => {
  const { code, out } = await capture(["execution", "--help"]);
  expect(code).toBe(0);
  expect(out).toContain("price the ways a unit could be run");
});

test("an unknown subcommand of either does not exit 0", async () => {
  expect((await capture(["capabilities", "bogus"])).code).toBe(1);
  expect((await capture(["execution", "bogus"])).code).toBe(1);
});

test("the top-level help lists both, distinctly", async () => {
  const { out } = await capture(["--help"]);
  expect(out).toContain("  capabilities  ");
  expect(out).toContain("  execution     ");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/execution/__tests__/registration.test.ts`
Expected: FAIL — `unknown command "capabilities"`

- [ ] **Step 3: Register them**

In `src/cli.ts`, add the imports next to the other module imports:

```ts
import { run as capabilities } from "./capabilities/cli";
import { run as execution } from "./execution/cli";
```

Add to `SUBCOMMANDS`:

```ts
  capabilities: capabilities,
  execution: execution,
```

Add to `HELP`, after the `dispatch` line, matching the existing column alignment:

```ts
  "  capabilities       Detect and record which harness binaries this machine has",
  "  execution          Price the viable ways to run each unit of a journey",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/execution/__tests__/registration.test.ts && bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — 4 new tests, the full suite green, no type errors

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/execution/__tests__/registration.test.ts
git commit -m "feat(cli): registra os subcomandos capabilities e execution"
```

---

### Task 10: Teach the coordinator to propose

**Files:**
- Modify: `skills/operate/SKILL.md` (the step-3.5 envelope block)

**Interfaces:** none — prose.

- [ ] **Step 1: Read the current envelope block**

Read `skills/operate/SKILL.md` in full. The block beginning **"Per-unit dispatch envelope (the PE approves this too)"** currently tells the coordinator which fields exist. It does not tell it to propose them, because until now it had no way to know what was available or what anything cost.

- [ ] **Step 2: Replace that block's opening with the proposal instruction**

Keep every existing MUST and the field descriptions. Add, before them:

```markdown
   **Propose the envelope — do not hand the PE a blank one.** Before writing this
   section, run:

   ```bash
   aipe execution propose --journey <id> --workspace <workspace>
   ```

   It prints, per unit, the envelopes that are actually viable on this machine,
   each with a `cost-index` and marked `GATED` where the policy requires the PE's
   signature. It enumerates and prices; it does **not** choose. Choosing is yours.

   For each unit, write the envelope you chose **and why**, plus the alternatives
   you discarded. The reasoning is not decoration — without it the PE can only
   accept or reject blind, which is the situation this exists to end. Write it
   like this:

   > `session / gemini / fast / normal` — session because the unit touches 40
   > files and a shared context would starve it; gemini because this is the QA and
   > the dev ran on claude-code; fast because this is a mechanical rename, not
   > design. Discarded ultracode: there is no solution space to explore here.

   **`cost-index` is a coarse relative index, never money.** The cheapest envelope
   — subagent, `fast` tier, normal intensity — is 1. Never present it as currency and never convert it —
   AIPe does not know the PE's token price, plan or rate limits.

   **The gated line.** An envelope printed `GATED` needs the PE's explicit
   approval; below that line you record your choice and proceed. This is what
   keeps the PE from approving thirty obvious envelopes to reach the one that
   mattered.

   **If `propose` fails**, it names the constraint that bit — no capabilities
   record, no containable harness, everything above the policy ceiling. Say which,
   and fall back to subagent mode. Never dispatch on a guess about what this
   machine can run.
```

- [ ] **Step 3: Add the wave-split note to the sequencing step**

In step 3 (sequencing into waves), add:

```markdown
   **Session mode binds the model per WAVE, not per unit** — `agentop` treats
   `--model` as a batch-level flag and `aipe session dispatch` refuses a wave whose
   units disagree. So units wanting different models must go in different waves.
   `aipe execution propose` tells you when that split costs an extra wave; if one
   wave matters more than the finer model choice, subagent mode binds the model
   per unit and does not force the split. That trade is the PE's — surface it in
   the spec rather than deciding it silently.
```

- [ ] **Step 4: Verify the skill still builds**

Run: `bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: PASS — the skill body is embedded via `src/harness/skills.ts`, so a broken file surfaces in the suite

- [ ] **Step 5: Commit**

```bash
git add skills/operate/SKILL.md
git commit -m "docs(operate): coordenador propõe o envelope em vez de entregá-lo em branco"
```

---

## Deviations from the spec, and why

- **`aipe capabilities` is its own top-level command**, not a subcommand of `execution`. The spec described the module but not its CLI shape. Capabilities are a property of the machine, consulted by `execution` but also meaningful alone (`aipe capabilities show` answers "why is Gemini not being offered?"), so folding it under `execution` would hide it.
- **`propose` does not read the relations graph or the diff size.** The spec lists those among the signals the coordinator weighs; they stay with the coordinator, which already reads `graph.yaml` in step 3. `propose` covers only what is machine-checkable — availability, eligibility, gating, cost. Pulling judgement signals into the CLI would make it choose, which the spec forbids.

## Follow-up, not in this plan

- Recording the chosen envelope's justification into the ledger as structured data. Today it lives in the Orientation Spec prose, which is where the PE reads it; making it queryable is a separate concern.
- Cost accounting across journeys. `propose` prices the wave in front of it and keeps no books, per the spec's out-of-scope list.
- Wiring `capabilities` into `/aipe-start` so a new workspace probes on creation. Worth doing, but it touches onboarding, which this plan otherwise leaves alone.
