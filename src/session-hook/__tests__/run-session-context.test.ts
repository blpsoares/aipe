// End-to-end over the composed CLI path: runSessionContext (read-state →
// persona-context → awareness → JSON on stdout) against a real temp workspace,
// in both directions — root (coordinator) and repo (persona).
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { runSessionContext } from "../read-state";

async function capture(fn: () => Promise<unknown>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rsc-"));
  await mkdir(join(dir, ".aipe", "relations"), { recursive: true });
  await mkdir(join(dir, "embark"), { recursive: true });
  await mkdir(join(dir, "prontuario"), { recursive: true });
  await writeFile(
    join(dir, ".aipe", "brain.yaml"),
    stringify({
      context: { name: "opvibes", coordinator: "Nicolas", pe: "Bruno" },
      repos: [
        { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" },
        { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario" },
      ],
    }),
    "utf8",
  );
  await writeFile(
    join(dir, ".aipe", "state.yaml"),
    stringify({ phase: { brain: "done", workspace: "done", relationship: "done", specialists: "done" } }),
    "utf8",
  );
  await writeFile(
    join(dir, ".aipe", "personas.yaml"),
    stringify({
      personas: [
        { name: "Nicolas", role: "coordinator", repo: null, path: null },
        { name: "Alice", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/alice" },
      ],
    }),
    "utf8",
  );
  await writeFile(
    join(dir, ".aipe", "relations", "graph.yaml"),
    stringify({
      nodes: [],
      edges: [
        {
          from: "embark",
          to: "prontuario",
          type: "consumes",
          perspectives: [{ detail: "calls the payments API", evidence: "x.ts:1" }],
        },
      ],
    }),
    "utf8",
  );
  return dir;
}

test("runSessionContext at the workspace root emits coordinator-mode JSON", async () => {
  const dir = await makeWorkspace();
  try {
    const out = await capture(() => runSessionContext(["--workspace", dir]));
    const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain("You ARE Nicolas");
    expect(ctx).toContain("DISPATCH GATE");
    expect(ctx).not.toContain("Alice");
    expect(ctx).not.toContain("opened directly inside");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSessionContext --release removes this coordinator's registered entry and emits inert JSON (the SessionEnd path)", async () => {
  const dir = await makeWorkspace();
  const coordDir = join(dir, ".aipe", "runtime", "coordinators");
  try {
    // SessionStart registers the coordinator entry.
    await capture(() => runSessionContext(["--workspace", dir]));
    expect((await readdir(coordDir)).length).toBeGreaterThan(0);

    // SessionEnd releases it — clean close leaves no ghost, and the hook output
    // is inert (SessionEnd cannot inject context).
    const out = await capture(() => runSessionContext(["--workspace", dir, "--release"]));
    expect(out.trim()).toBe("{}");
    expect(await readdir(coordDir).catch(() => [])).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSessionContext inside a declared repo emits persona-mode JSON", async () => {
  const dir = await makeWorkspace();
  try {
    const out = await capture(() => runSessionContext(["--workspace", join(dir, "embark")]));
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const ctx = parsed.hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain("opened directly inside the embark repo");
    expect(ctx).toContain("Alice");
    expect(ctx).toContain("You work for Bruno");
    expect(ctx).toContain("calls the payments API");
    expect(ctx).not.toContain("DISPATCH GATE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("coordinator JSON carries the item-8 STATE block and the follow-preference (item 10 inv.8)", async () => {
  const dir = await makeWorkspace();
  try {
    const out = await capture(() => runSessionContext(["--workspace", dir]));
    const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain("STATUS UPDATES: auto-push is OFF"); // brain has no statusUpdates → default off
    expect(ctx).toContain("CURRENT STATE"); // the item-8 state summary
    expect(ctx).toContain("aipe status");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the in-repo persona context does NOT get the coordinator STATE block", async () => {
  const dir = await makeWorkspace();
  try {
    const out = await capture(() => runSessionContext(["--workspace", join(dir, "embark")]));
    const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(ctx).not.toContain("CURRENT STATE");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a coordinator session whose brain sets statusUpdates auto:true is told to auto-push", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rsc-auto-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "brain.yaml"),
      stringify({
        context: { name: "opvibes", coordinator: "Nicolas", statusUpdates: { auto: true, format: "compact" } },
        repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
      }),
      "utf8",
    );
    await writeFile(
      join(dir, ".aipe", "state.yaml"),
      stringify({ phase: { brain: "done", workspace: "done", relationship: "done", specialists: "done" } }),
      "utf8",
    );
    const out = await capture(() => runSessionContext(["--workspace", dir]));
    const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain("auto-push is ON (compact)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSessionContext rehydrates a stale workspace before emitting JSON, and stamps the current version", async () => {
  const dir = await makeWorkspace();
  try {
    const out = await capture(() => runSessionContext(["--workspace", dir]));
    // Still emits valid, complete JSON — rehydrating must not corrupt stdout.
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    // The workspace had no .aipe/toolchain.yaml before this call (makeWorkspace()
    // doesn't create one) — confirm the wiring actually ran ensureRehydrated and
    // it stamped the running binary's version.
    const stamped = await readFile(join(dir, ".aipe", "toolchain.yaml"), "utf8");
    expect(stamped).toContain("aipeVersion");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
