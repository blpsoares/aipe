import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { buildSnapshot } from "../snapshot";
import { renderDashboard } from "../render";
import type { BrainFile } from "../../context-brain/types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-dash-"));
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: "u", path: "./embark" }],
  };
  await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "personas.yaml"),
    stringify({
      personas: [
        { name: "Nicolas", role: "coordinator", repo: null, path: null },
        { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "p" },
        { name: "Marina", role: "qa", repo: "embark", path: "p" },
      ],
    }),
    "utf8",
  );
  return dir;
}

test("buildSnapshot derives worker status from journey dispatches", async () => {
  const dir = await ws();
  try {
    // Joaquim is mid-dispatch; Marina has nothing → available
    await writeFile(
      join(dir, ".aipe", "journeys", "j1.yaml"),
      stringify({ id: "j1", dispatches: [{ repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched" }] }),
      "utf8",
    );
    const snap = await buildSnapshot(dir);
    expect(snap.ok).toBe(true);
    const joaquim = snap.workers.find((w) => w.name === "Joaquim");
    const marina = snap.workers.find((w) => w.name === "Marina");
    expect(joaquim?.status).toBe("active");
    expect(joaquim?.journey).toBe("j1");
    expect(marina?.status).toBe("available");
    expect(snap.counts).toMatchObject({ hired: 2, active: 1, available: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("delivered dispatch surfaces the PR and status", async () => {
  const dir = await ws();
  try {
    await writeFile(
      join(dir, ".aipe", "journeys", "j1.yaml"),
      stringify({ id: "j1", dispatches: [{ repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", pr: "http://pr/1", status: "delivered" }] }),
      "utf8",
    );
    const snap = await buildSnapshot(dir);
    const joaquim = snap.workers.find((w) => w.name === "Joaquim");
    expect(joaquim?.status).toBe("delivered");
    expect(joaquim?.pr).toBe("http://pr/1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderDashboard (no color) shows the sections and coordinator", async () => {
  const dir = await ws();
  try {
    const snap = await buildSnapshot(dir);
    const frame = renderDashboard(snap, { color: false, now: "updated 2026-07-05 10:00:00" });
    expect(frame).toContain("AIPe · opvibes");
    expect(frame).toContain("Nicolas");
    expect(frame).toContain("WORKERS");
    expect(frame).toContain("PIPELINE");
    expect(frame).toContain("Joaquim");
    // no ANSI escapes when color is off
    expect(frame.includes("\x1b[")).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderDashboard shows the module tag for a monorepo module persona", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-dash-"));
  try {
    const brain: BrainFile = {
      context: { name: "opvibes", coordinator: "Nicolas" },
      repos: [{ name: "prontuario", url: "u", path: "./prontuario" }],
    };
    await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
    await writeFile(
      join(dir, ".aipe", "personas.yaml"),
      stringify({
        personas: [
          { name: "Nicolas", role: "coordinator", repo: null, module: null, fqid: null, path: null },
          { name: "Ana", role: "dev-fullstack", repo: "prontuario", module: "api", fqid: "prontuario/api", path: "p" },
        ],
      }),
      "utf8",
    );
    const snap = await buildSnapshot(dir);
    const ana = snap.workers.find((w) => w.name === "Ana");
    expect(ana?.module).toBe("api");
    expect(ana?.fqid).toBe("prontuario/api");
    const frame = renderDashboard(snap, { color: false });
    expect(frame).toContain("Ana");
    expect(frame).toContain("[api]");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderDashboard shows the model/tier a dispatch ran on", async () => {
  const dir = await ws();
  try {
    await writeFile(
      join(dir, ".aipe", "journeys", "j1.yaml"),
      stringify({ id: "j1", dispatches: [{ repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched", tier: "reasoning", model: "claude-opus-4-8" }] }),
      "utf8",
    );
    const snap = await buildSnapshot(dir);
    const frame = renderDashboard(snap, { color: false });
    expect(frame).toContain("reasoning:claude-opus-4-8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildSnapshot reports not-onboarded without a brain", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-dash-"));
  try {
    const snap = await buildSnapshot(dir);
    expect(snap.ok).toBe(false);
    const frame = renderDashboard(snap, { color: false });
    expect(frame).toContain("not an onboarded workspace");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
