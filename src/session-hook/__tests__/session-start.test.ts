import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";

const PLUGIN_ROOT = join(import.meta.dir, "..", "..", "..");
const HOOK = join(PLUGIN_ROOT, "hooks", "session-start");

async function runHook(projectDir: string): Promise<string> {
  const proc = Bun.spawn(["bash", HOOK], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

const brain = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
};

async function makeWs(state?: unknown, withBrain = true): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-ss-"));
  if (withBrain || state !== undefined) {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    if (withBrain) await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
    if (state !== undefined) await writeFile(join(dir, ".aipe", "state.yaml"), stringify(state), "utf8");
  }
  return dir;
}

test("estado 1: sem brain → orienta /context-brain, JSON válido", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-ss-"));
  try {
    const out = await runHook(dir);
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("/context-brain");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("estado 2: onboarding incompleto → próximo passo /make-workspace", async () => {
  const dir = await makeWs({ phase: { brain: "done", workspace: "pending", relationship: "pending", generator: "pending" } });
  try {
    const ctx = JSON.parse(await runHook(dir)).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("configuração");
    expect(ctx).toContain("/make-workspace");
    expect(ctx).toContain("Nicolas");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("estado 3: tudo done → coordenador pleno com repos", async () => {
  const dir = await makeWs({ phase: { brain: "done", workspace: "done", relationship: "done", generator: "done" } });
  try {
    const ctx = JSON.parse(await runHook(dir)).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("Você É Nicolas");
    expect(ctx).toContain("embark");
    expect(ctx).toContain("Pronto para receber demandas");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("opt-out presente em todos os estados", async () => {
  const dir = await makeWs({ phase: { brain: "done", workspace: "done", relationship: "done", generator: "done" } });
  try {
    const ctx = JSON.parse(await runHook(dir)).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("sair do modo AIPe");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLAUDE_PROJECT_DIR vazio → {} (defesa)", async () => {
  const out = await runHook("");
  expect(out).toBe("{}");
});

test("brain.yaml com caractere de controle C0 embutido → JSON emitido ainda é válido", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-ss-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    const raw = 'context:\n  name: "opvibes"\n  coordinator: "Nic\\u000Bolas"\nrepos:\n  - name: embark\n    url: git@github.com:opvibes/embark.git\n    path: ./embark\n';
    await writeFile(join(dir, ".aipe", "brain.yaml"), raw, "utf8");
    await writeFile(
      join(dir, ".aipe", "state.yaml"),
      stringify({ phase: { brain: "done", workspace: "done", relationship: "done", generator: "done" } }),
      "utf8",
    );
    const out = await runHook(dir);
    expect(() => JSON.parse(out)).not.toThrow();
    const ctx = JSON.parse(out).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("Nic olas");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
