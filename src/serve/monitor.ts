// Live specialist monitor: tails the Claude Code harness transcripts of the
// dispatched subagents so the web console can show, in realtime, what each
// specialist is "typing" (assistant text + the commands it runs) and which files
// it is changing. READ-ONLY — aipe writes none of these files; the harness does,
// under ~/.claude/projects/<workspace-slug>/<parentSession>/subagents/agent-*.jsonl
// (with an agent-*.meta.json sidecar labelling the persona). We only read/tail
// them; we never change how the orchestration records transcripts.
//
// Two things this module guarantees, and why:
//   1) No duplication. drain() reads only the *new* byte range [from, size) of a
//      growing transcript and only up to the last complete line, so each JSONL
//      line is parsed and emitted exactly once even as the file keeps growing.
//   2) Only active specialists, one lane each. Besides the content events
//      (say/tool/file) we emit a per-agent roster event (kind "agent") carrying
//      the persona label, the harness agentType, and whether the agent is
//      currently active (its transcript was touched within activeWindowMs). The
//      web console builds one lane per active specialist from that roster and
//      hides historical/finished agents by default.
import { watch } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// A single event surfaced to the UI. `kind` picks the panel: `say` (left stream:
// the agent's text/reasoning), `tool` (left stream: a command/tool it ran),
// `file` (right panel: a file it created/edited), or `agent` (roster/identity +
// liveness for the lane header — carries no stream/file content).
export interface MonitorEvent {
  agent: string; // agent id (agent-<id>)
  persona: string; // human label from the meta sidecar (falls back to the id)
  kind: "say" | "tool" | "file" | "agent";
  agentType?: string; // harness agent type (e.g. general-purpose | claude | Explore)
  active?: boolean; // roster only: is this specialist currently active?
  tool?: string; // tool name for kind tool/file
  file?: string; // file path for kind file
  cmd?: string; // command line for a Bash tool
  text?: string; // text for kind say / a short tool summary
  at: number; // ms epoch when observed
}

export interface AgentRef {
  id: string; // agent-<id>
  persona: string; // meta.description or the id
  agentType?: string; // meta.agentType, when present
  path: string; // absolute path to the agent-*.jsonl transcript
  mtimeMs: number; // last-modified time of the transcript (liveness signal)
}

// Claude Code slugifies a project dir by replacing every non-alphanumeric char
// with a dash (e.g. /home/u/aipe-blpsoares → -home-u-aipe-blpsoares).
export function projectSlug(workspaceAbs: string): string {
  return workspaceAbs.replace(/[^a-zA-Z0-9]/g, "-");
}

export function projectsRoot(home: string = homedir()): string {
  return join(home, ".claude", "projects");
}

// Turn one JSONL transcript line into zero or more UI events. Pure + tested.
// Tolerates non-JSON lines and unknown shapes (returns []).
export function parseTranscriptLine(line: string, ctx: { agent: string; persona: string; at?: number }): MonitorEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (typeof obj !== "object" || obj === null) return [];
  const rec = obj as Record<string, unknown>;
  const msg = rec.message as Record<string, unknown> | undefined;
  // Only assistant turns carry the agent's own text + tool calls.
  const role = (rec.type as string) || (msg?.role as string);
  if (role !== "assistant") return [];
  const content = msg?.content;
  if (!Array.isArray(content)) return [];
  const at = ctx.at ?? Date.now();
  const base = { agent: ctx.agent, persona: ctx.persona, at };
  const out: MonitorEvent[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      const text = p.text.trim();
      if (text) out.push({ ...base, kind: "say", text });
    } else if (p.type === "tool_use") {
      const tool = typeof p.name === "string" ? p.name : "tool";
      const input = (p.input as Record<string, unknown>) || {};
      const file = (input.file_path || input.path || input.notebook_path) as string | undefined;
      if (file && /^(Edit|Write|MultiEdit|NotebookEdit|Update|Create)$/i.test(tool)) {
        out.push({ ...base, kind: "file", tool, file });
      } else if (/^Bash$/i.test(tool) && typeof input.command === "string") {
        out.push({ ...base, kind: "tool", tool, cmd: input.command });
      } else {
        const summary = typeof input.description === "string" ? input.description : file || tool;
        out.push({ ...base, kind: "tool", tool, text: summary });
      }
    }
  }
  return out;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

// The persona label + agentType from an agent's meta sidecar
// (agent-<id>.meta.json). Persona falls back to the agent id when absent.
async function metaFor(jsonlPath: string, agentId: string): Promise<{ persona: string; agentType?: string }> {
  const metaPath = jsonlPath.replace(/\.jsonl$/, ".meta.json");
  try {
    const raw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(raw) as Record<string, unknown>;
    const desc = meta.description;
    const agentType = typeof meta.agentType === "string" ? meta.agentType : undefined;
    if (typeof desc === "string" && desc.trim()) return { persona: desc.trim(), agentType };
    return { persona: agentId, agentType };
  } catch {
    // no sidecar / malformed — fall back to the id
    return { persona: agentId };
  }
}

// Discover every dispatched subagent transcript for this workspace.
export async function discoverAgents(workspaceAbs: string, home: string = homedir()): Promise<AgentRef[]> {
  const projDir = join(projectsRoot(home), projectSlug(workspaceAbs));
  const sessions = await safeReaddir(projDir);
  const refs: AgentRef[] = [];
  for (const session of sessions) {
    const subDir = join(projDir, session, "subagents");
    for (const name of await safeReaddir(subDir)) {
      if (!name.startsWith("agent-") || !name.endsWith(".jsonl")) continue;
      const id = name.replace(/\.jsonl$/, "");
      const path = join(subDir, name);
      const { persona, agentType } = await metaFor(path, id);
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat(path)).mtimeMs;
      } catch {
        // transcript vanished between readdir and stat — skip it
        continue;
      }
      refs.push({ id, persona, agentType, path, mtimeMs });
    }
  }
  return refs;
}

export interface MonitorTail {
  close(): void;
}

// Tail every subagent transcript, emitting events as new JSONL lines land. Rescans
// for newly-dispatched agents on the filesystem watcher + a slow reconcile timer.
// Backlog is capped so a huge transcript can't flood the client on first attach,
// and an agent that is already stale when first discovered has its history skipped
// entirely (it enters the roster as inactive) — the console shows active work.
export function startMonitor(
  workspaceAbs: string,
  onEvent: (ev: MonitorEvent) => void,
  opts: { home?: string; backlogPerAgent?: number; rescanMs?: number; activeWindowMs?: number } = {},
): MonitorTail {
  const home = opts.home ?? homedir();
  const backlog = opts.backlogPerAgent ?? 40;
  const rescanMs = opts.rescanMs ?? 2000;
  const activeWindowMs = opts.activeWindowMs ?? 180_000;
  const offsets = new Map<string, number>(); // path → bytes consumed (up to last full line)
  const rosterKey = new Map<string, string>(); // path → last roster signature (dedupe)
  const draining = new Set<string>(); // paths with an in-flight drain (serialize watcher+timer)
  let closed = false;
  let watcher: ReturnType<typeof watch> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const emitRoster = (ref: AgentRef, active: boolean): void => {
    const key = `${active ? "1" : "0"}|${ref.persona}|${ref.agentType ?? ""}`;
    if (rosterKey.get(ref.path) === key) return; // nothing changed — stay quiet
    rosterKey.set(ref.path, key);
    onEvent({
      agent: ref.id,
      persona: ref.persona,
      agentType: ref.agentType,
      kind: "agent",
      active,
      at: Date.now(),
    });
  };

  // Read only the new tail of a growing transcript. THE fix for SSE duplication:
  // we slice [from, size) instead of re-reading the whole file, and only consume
  // up to the last newline so a half-written final line waits for the next drain.
  const drain = async (ref: AgentRef, isNew: boolean): Promise<void> => {
    if (draining.has(ref.path)) return; // a concurrent drain owns this path
    draining.add(ref.path);
    try {
      let size = 0;
      try {
        size = (await stat(ref.path)).size;
      } catch {
        return;
      }
      const from = offsets.get(ref.path) ?? 0;
      if (size <= from) {
        // File truncated/rotated or no growth — realign the offset, emit nothing.
        offsets.set(ref.path, size);
        return;
      }
      let chunk: string;
      try {
        chunk = await Bun.file(ref.path).slice(from, size).text();
      } catch {
        return;
      }
      const lastNl = chunk.lastIndexOf("\n");
      if (lastNl < 0) {
        // Only a partial line so far — leave the offset put and wait for the rest.
        if (!offsets.has(ref.path)) offsets.set(ref.path, from);
        return;
      }
      const consumed = chunk.slice(0, lastNl + 1);
      offsets.set(ref.path, from + Buffer.byteLength(consumed, "utf8"));
      let lines = consumed.split("\n");
      // On first sight, only replay the tail so a long transcript doesn't flood.
      if (isNew && lines.length > backlog) lines = lines.slice(-backlog);
      for (const line of lines) {
        if (closed) return;
        for (const ev of parseTranscriptLine(line, { agent: ref.id, persona: ref.persona })) {
          onEvent({ ...ev, agentType: ref.agentType });
        }
      }
    } finally {
      draining.delete(ref.path);
    }
  };

  const scan = async (): Promise<void> => {
    if (closed) return;
    const refs = await discoverAgents(workspaceAbs, home);
    for (const ref of refs) {
      if (closed) return;
      const known = offsets.has(ref.path);
      const active = Date.now() - ref.mtimeMs < activeWindowMs;
      if (!known && !active) {
        // Historical at discovery time: register its size so we never replay its
        // backlog, and surface it as an inactive roster entry (hidden by default).
        offsets.set(ref.path, ref.mtimeMs > 0 ? await currentSize(ref.path) : 0);
        emitRoster(ref, false);
        continue;
      }
      emitRoster(ref, active);
      await drain(ref, !known);
    }
  };

  async function currentSize(path: string): Promise<number> {
    try {
      return (await stat(path)).size;
    } catch {
      return 0;
    }
  }

  void scan();
  try {
    const projDir = join(projectsRoot(home), projectSlug(workspaceAbs));
    watcher = watch(projDir, { recursive: true }, () => void scan());
  } catch {
    // project dir may not exist yet — the reconcile timer still covers it
  }
  timer = setInterval(() => void scan(), rescanMs);

  return {
    close(): void {
      closed = true;
      watcher?.close();
      if (timer) clearInterval(timer);
    },
  };
}
