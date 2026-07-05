import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { readState, formatFields } from "../read-state";

async function ws(brain?: unknown, state?: unknown, rawBrain?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rs-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  if (rawBrain !== undefined) await writeFile(join(dir, ".aipe", "brain.yaml"), rawBrain, "utf8");
  else if (brain !== undefined) await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  if (state !== undefined) await writeFile(join(dir, ".aipe", "state.yaml"), stringify(state), "utf8");
  return dir;
}

const fullBrain = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" },
    { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario" },
  ],
};
const doneState = { phase: { brain: "done", workspace: "done", relationship: "done", specialists: "done" } };

test("brain+state complete (everything done)", async () => {
  const dir = await ws(fullBrain, doneState);
  try {
    const f = await readState(dir);
    expect(f.brain).toBe("present");
    expect(f.contextName).toBe("opvibes");
    expect(f.coordinator).toBe("Nicolas");
    expect(f.repos).toEqual(["embark", "prontuario"]);
    expect(f.phaseWorkspace).toBe("done");
    expect(f.phaseSpecialists).toBe("done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("brain absent → state 1 (absent)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rs-"));
  try {
    const f = await readState(dir);
    expect(f.brain).toBe("absent");
    expect(f.repos).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("partial state (workspace pending) reflects the phases", async () => {
  const dir = await ws(fullBrain, { phase: { brain: "done", workspace: "pending", relationship: "pending", specialists: "pending" } });
  try {
    const f = await readState(dir);
    expect(f.phaseWorkspace).toBe("pending");
    expect(f.phaseBrain).toBe("done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("state absent with brain present → non-brain phases = pending", async () => {
  const dir = await ws(fullBrain);
  try {
    const f = await readState(dir);
    expect(f.brain).toBe("present");
    expect(f.phaseBrain).toBe("done");
    expect(f.phaseWorkspace).toBe("pending");
    expect(f.phaseRelationship).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("hand-edited brain (quotes + comment) still extracts", async () => {
  const raw = `# team context\ncontext:\n  name: "opvibes"\n  coordinator: 'Nicolas'\nrepos:\n  - name: embark\n    url: git@github.com:opvibes/embark.git\n    path: ./embark\n`;
  const dir = await ws(undefined, undefined, raw);
  try {
    const f = await readState(dir);
    expect(f.brain).toBe("present");
    expect(f.contextName).toBe("opvibes");
    expect(f.coordinator).toBe("Nicolas");
    expect(f.repos).toEqual(["embark"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed brain (invalid YAML) degrades to absent, without throwing", async () => {
  const dir = await ws(undefined, undefined, ": : not : yaml :");
  try {
    const f = await readState(dir);
    expect(f.brain).toBe("absent");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("formatFields sanitizes arbitrary C0 control characters (not just CR/LF/TAB)", async () => {
  const raw = 'context:\n  name: "op\\u000Bvibes"\n  coordinator: "Nic\\u000Bolas"\nrepos: []\n';
  const dir = await ws(undefined, undefined, raw);
  try {
    const f = await readState(dir);
    // biome-ignore lint: needs to explicitly test C0 control characters
    expect(/[\x00-\x1f]/.test(f.contextName)).toBe(false);
    // biome-ignore lint: needs to explicitly test C0 control characters
    expect(/[\x00-\x1f]/.test(f.coordinator)).toBe(false);
    const out = formatFields(f);
    expect(out).toContain("CONTEXT_NAME=op vibes");
    expect(out).toContain("COORDINATOR=Nic olas");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("formatFields sanitizes line breaks and serializes KEY=value", async () => {
  const dir = await ws({ context: { name: "op\nvibes", coordinator: "Nic" }, repos: [{ name: "a", url: "u", path: "./a" }] }, doneState);
  try {
    const out = formatFields(await readState(dir));
    expect(out).toContain("BRAIN=present");
    expect(out).toContain("CONTEXT_NAME=op vibes");
    expect(out).toContain("REPOS=a");
    expect(out.split("\n").length).toBe(8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
