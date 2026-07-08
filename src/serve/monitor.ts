// Live specialist monitor: tails the Claude Code harness transcripts of the
// dispatched subagents so the web console can show, in realtime, what each
// specialist is "typing" (assistant text + the commands it runs) and which files
// it is changing. READ-ONLY — aipe writes none of these files; the harness does,
// under ~/.claude/projects/<workspace-slug>/<parentSession>/subagents/agent-*.jsonl
// (with an agent-*.meta.json sidecar labelling the persona). We only read/tail
// them; we never change how the orchestration records transcripts.
import { watch } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// A single event surfaced to the UI. `kind` picks the panel: `say` (left stream:
// the agent's text/reasoning), `tool` (left stream: a command/tool it ran), or
// `file` (right panel: a file it created/edited).
export interface MonitorEvent {
  agent: string; // agent id (agent-<id>)
  persona: string; // human label from the meta sidecar (falls back to the id)
  kind: "say" | "tool" | "file";
  tool?: string; // tool name for kind tool/file
  file?: string; // file path for kind file
  cmd?: string; // command line for a Bash tool
  text?: string; // text for kind say / a short tool summary
  at: number; // ms epoch when observed
}

export interface AgentRef {
  id: string; // agent-<id>
  persona: string; // meta.description or the id
  path: string; // absolute path to the agent-*.jsonl transcript
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

// The persona label from an agent's meta sidecar (agent-<id>.meta.json). Falls
// back to the agent id when absent/unreadable.
async function personaFor(jsonlPath: string, agentId: string): Promise<string> {
  const metaPath = jsonlPath.replace(/\.jsonl$/, ".meta.json");
  try {
    const raw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(raw) as Record<string, unknown>;
    const desc = meta.description;
    if (typeof desc === "string" && desc.trim()) return desc.trim();
  } catch {
    // no sidecar / malformed — fall through
  }
  return agentId;
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
      refs.push({ id, persona: await personaFor(path, id), path });
    }
  }
  return refs;
}

export interface MonitorTail {
  close(): void;
}

// Tail every subagent transcript, emitting events as new JSONL lines land. Rescans
// for newly-dispatched agents on the filesystem watcher + a slow reconcile timer.
// Backlog is capped so a huge transcript can't flood the client on first attach.
export function startMonitor(
  workspaceAbs: string,
  onEvent: (ev: MonitorEvent) => void,
  opts: { home?: string; backlogPerAgent?: number; rescanMs?: number } = {},
): MonitorTail {
  const home = opts.home ?? homedir();
  const backlog = opts.backlogPerAgent ?? 40;
  const rescanMs = opts.rescanMs ?? 2000;
  const offsets = new Map<string, number>(); // path → bytes consumed
  const persona = new Map<string, string>(); // path → label
  let closed = false;
  let watcher: ReturnType<typeof watch> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const drain = async (ref: AgentRef, isNew: boolean): Promise<void> => {
    let size = 0;
    try {
      size = (await stat(ref.path)).size;
    } catch {
      return;
    }
    const from = offsets.get(ref.path) ?? 0;
    if (size <= from) {
      offsets.set(ref.path, size);
      return;
    }
    let text: string;
    try {
      text = await readFile(ref.path, "utf8");
    } catch {
      return;
    }
    offsets.set(ref.path, Buffer.byteLength(text, "utf8"));
    let lines = text.split("\n");
    // On first sight, only replay the tail so a long transcript doesn't flood.
    if (isNew && lines.length > backlog) lines = lines.slice(-backlog);
    for (const line of lines) {
      if (closed) return;
      for (const ev of parseTranscriptLine(line, { agent: ref.id, persona: ref.persona })) onEvent(ev);
    }
  };

  const scan = async (): Promise<void> => {
    if (closed) return;
    const refs = await discoverAgents(workspaceAbs, home);
    for (const ref of refs) {
      const known = offsets.has(ref.path);
      persona.set(ref.path, ref.persona);
      await drain(ref, !known);
    }
  };

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
