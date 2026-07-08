import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile, appendFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgents, parseTranscriptLine, projectSlug, startMonitor, type MonitorEvent } from "../monitor";

test("projectSlug matches Claude Code's dir slugification", () => {
  expect(projectSlug("/home/u/aipe-blpsoares")).toBe("-home-u-aipe-blpsoares");
  expect(projectSlug("/a/b.c_d")).toBe("-a-b-c-d");
});

test("parseTranscriptLine extracts assistant text as a 'say' event", () => {
  const line = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "  working on it  " }] } });
  const evs = parseTranscriptLine(line, { agent: "agent-1", persona: "Brand", at: 1 });
  expect(evs).toEqual([{ agent: "agent-1", persona: "Brand", at: 1, kind: "say", text: "working on it" }]);
});

test("parseTranscriptLine maps Edit/Write tool_use to a 'file' event", () => {
  const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/x/app.html" } }] } });
  const evs = parseTranscriptLine(line, { agent: "a", persona: "P", at: 2 });
  expect(evs).toEqual([{ agent: "a", persona: "P", at: 2, kind: "file", tool: "Edit", file: "/x/app.html" }]);
});

test("parseTranscriptLine maps Bash tool_use to a 'tool' event with the command", () => {
  const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "bun test" } }] } });
  const evs = parseTranscriptLine(line, { agent: "a", persona: "P", at: 3 });
  expect(evs).toEqual([{ agent: "a", persona: "P", at: 3, kind: "tool", tool: "Bash", cmd: "bun test" }]);
});

test("parseTranscriptLine ignores non-JSON, non-assistant, and empty lines", () => {
  expect(parseTranscriptLine("", { agent: "a", persona: "P" })).toEqual([]);
  expect(parseTranscriptLine("not json", { agent: "a", persona: "P" })).toEqual([]);
  const userLine = JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "hi" }] } });
  expect(parseTranscriptLine(userLine, { agent: "a", persona: "P" })).toEqual([]);
});

test("discoverAgents finds subagent transcripts and reads the persona + agentType sidecar", async () => {
  const home = await mkdtemp(join(tmpdir(), "aipe-mon-home-"));
  const workspace = "/tmp/aipe-ws-example";
  const subDir = join(home, ".claude", "projects", projectSlug(workspace), "sess-1", "subagents");
  await mkdir(subDir, { recursive: true });
  await writeFile(join(subDir, "agent-abc.jsonl"), "", "utf8");
  await writeFile(join(subDir, "agent-abc.meta.json"), JSON.stringify({ description: "Persona Brand aipe dev", agentType: "general-purpose" }), "utf8");
  try {
    const refs = await discoverAgents(workspace, home);
    expect(refs.length).toBe(1);
    expect(refs[0]!.id).toBe("agent-abc");
    expect(refs[0]!.persona).toBe("Persona Brand aipe dev");
    expect(refs[0]!.agentType).toBe("general-purpose");
    expect(refs[0]!.mtimeMs).toBeGreaterThan(0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("discoverAgents returns empty when the project dir is absent", async () => {
  const home = await mkdtemp(join(tmpdir(), "aipe-mon-empty-"));
  try {
    expect(await discoverAgents("/no/such/ws", home)).toEqual([]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// ── The regression that PR-C exists to kill ──────────────────────────────────
// Before the fix, drain() re-read the whole transcript on every growth and
// re-emitted every line, so a 3-append transcript surfaced each event 2–3×.
// The fix reads only the new byte range, so each line is emitted exactly once.
const sayLine = (text: string) => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } }) + "\n";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) return;
    await sleep(20);
  }
}

test("growing transcript emits each line exactly once (no SSE duplication)", async () => {
  const home = await mkdtemp(join(tmpdir(), "aipe-mon-grow-"));
  const workspace = "/tmp/aipe-ws-grow";
  const subDir = join(home, ".claude", "projects", projectSlug(workspace), "sess-1", "subagents");
  await mkdir(subDir, { recursive: true });
  const jsonl = join(subDir, "agent-grow.jsonl");
  await writeFile(jsonl, sayLine("first"), "utf8");
  await writeFile(join(subDir, "agent-grow.meta.json"), JSON.stringify({ description: "Grower", agentType: "claude" }), "utf8");

  const says: string[] = [];
  const tail = startMonitor(
    workspace,
    (ev: MonitorEvent) => {
      if (ev.kind === "say") says.push(ev.text ?? "");
    },
    { home, rescanMs: 40, activeWindowMs: 10 * 60_000 },
  );
  try {
    await waitFor(() => says.includes("first"));
    await appendFile(jsonl, sayLine("second"));
    await waitFor(() => says.includes("second"));
    await appendFile(jsonl, sayLine("third"));
    await waitFor(() => says.includes("third"));
    // let a couple more scans run to expose any re-emission of old lines
    await sleep(180);

    const count = (t: string) => says.filter((s) => s === t).length;
    expect(count("first")).toBe(1);
    expect(count("second")).toBe(1);
    expect(count("third")).toBe(1);
  } finally {
    tail.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("only active specialists get a lane; stale agents enter the roster inactive with no backlog", async () => {
  const home = await mkdtemp(join(tmpdir(), "aipe-mon-active-"));
  const workspace = "/tmp/aipe-ws-active";
  const subDir = join(home, ".claude", "projects", projectSlug(workspace), "sess-1", "subagents");
  await mkdir(subDir, { recursive: true });

  const freshJsonl = join(subDir, "agent-fresh.jsonl");
  await writeFile(freshJsonl, sayLine("live work"), "utf8");
  await writeFile(join(subDir, "agent-fresh.meta.json"), JSON.stringify({ description: "Fresh dev repo task", agentType: "claude" }), "utf8");

  const staleJsonl = join(subDir, "agent-stale.jsonl");
  await writeFile(staleJsonl, sayLine("old work"), "utf8");
  await writeFile(join(subDir, "agent-stale.meta.json"), JSON.stringify({ description: "Stale dev repo done", agentType: "claude" }), "utf8");
  // Push the stale transcript's mtime well outside the active window.
  const old = new Date(Date.now() - 60 * 60_000);
  await utimes(staleJsonl, old, old);

  const roster = new Map<string, boolean>();
  const content: MonitorEvent[] = [];
  const tail = startMonitor(
    workspace,
    (ev: MonitorEvent) => {
      if (ev.kind === "agent") roster.set(ev.agent, ev.active === true);
      else content.push(ev);
    },
    { home, rescanMs: 40, activeWindowMs: 5 * 60_000 },
  );
  try {
    await waitFor(() => roster.has("agent-fresh") && roster.has("agent-stale"));
    await sleep(120);

    expect(roster.get("agent-fresh")).toBe(true);
    expect(roster.get("agent-stale")).toBe(false);
    // The fresh agent's line streams; the stale agent's backlog is never replayed.
    expect(content.some((e) => e.agent === "agent-fresh" && e.text === "live work")).toBe(true);
    expect(content.some((e) => e.agent === "agent-stale")).toBe(false);
  } finally {
    tail.close();
    await rm(home, { recursive: true, force: true });
  }
});
