import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgents, parseTranscriptLine, projectSlug } from "../monitor";

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

test("discoverAgents finds subagent transcripts and reads the persona sidecar", async () => {
  const home = await mkdtemp(join(tmpdir(), "aipe-mon-home-"));
  const workspace = "/tmp/aipe-ws-example";
  const subDir = join(home, ".claude", "projects", projectSlug(workspace), "sess-1", "subagents");
  await mkdir(subDir, { recursive: true });
  await writeFile(join(subDir, "agent-abc.jsonl"), "", "utf8");
  await writeFile(join(subDir, "agent-abc.meta.json"), JSON.stringify({ description: "Persona Brand aipe dev" }), "utf8");
  try {
    const refs = await discoverAgents(workspace, home);
    expect(refs.length).toBe(1);
    expect(refs[0]!.id).toBe("agent-abc");
    expect(refs[0]!.persona).toBe("Persona Brand aipe dev");
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
