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

// Finding A (whole-branch review): `redirected` used to map to "available"
// ("specialist free again") — the exact opposite of what it means. A human
// just talked to this specialist mid-flight and changed its direction; that
// must render as busy/attention-needed, never as idle.
test("a redirected dispatch renders as 'redirected', never as 'available', and is counted", async () => {
  const dir = await ws();
  try {
    await writeFile(
      join(dir, ".aipe", "journeys", "j1.yaml"),
      stringify({
        id: "j1",
        dispatches: [{
          repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w",
          status: "redirected", redirectReason: "PE changed direction mid-flight",
        }],
      }),
      "utf8",
    );
    const snap = await buildSnapshot(dir);
    expect(snap.ok).toBe(true);
    const joaquim = snap.workers.find((w) => w.name === "Joaquim");
    expect(joaquim?.status).toBe("redirected");
    expect(joaquim?.status).not.toBe("available");
    expect(snap.counts).toMatchObject({ hired: 2, redirected: 1, active: 0, available: 1 });
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

test("renderDashboard shows a redirected worker with the redirected glyph, never the available one", async () => {
  const dir = await ws();
  try {
    await writeFile(
      join(dir, ".aipe", "journeys", "j1.yaml"),
      stringify({
        id: "j1",
        dispatches: [{
          repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w",
          status: "redirected", redirectReason: "PE changed direction mid-flight",
        }],
      }),
      "utf8",
    );
    const snap = await buildSnapshot(dir);
    const frame = renderDashboard(snap, { color: false });
    const workerLine = frame.split("\n").find((l) => l.includes("Joaquim"));
    expect(workerLine).toBe("    ↻ Joaquim dev-fullstack (j1)");
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
