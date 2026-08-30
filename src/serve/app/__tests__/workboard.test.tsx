// The Atividade board moved into "Agora" as the collapsible section (approved
// map, SDD §5). These tests follow the move (j-20260827-s9 reconciliation) — the
// board machinery is unchanged, so they now drive the extracted <WorkBoard/>
// component directly instead of the removed /activity screen. Nothing about the
// board's behavior (grouping, filters, Integrados merge-truth, envelope, copy
// command) regresses.
import "./setup";
import { test, expect, afterEach, beforeEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { WorkBoard } from "../components/WorkBoard";
import { applySnapshot, snapshot } from "../runtime/store";
import { resetBoardConfig, BOARD_CONFIG_KEY, boardConfig, readConfig } from "../runtime/activity";
import { setLang, t } from "../runtime/i18n";
import type { RawSnapshot } from "../runtime/store";

const EMPTY = snapshot.value;

// A snapshot with the full spread of states + envelopes + a merge-truth item.
const snap: RawSnapshot = {
  ok: true,
  context: { name: "demo", coordinator: "Coord" },
  journeys: [
    {
      id: "j-1",
      dispatches: [
        { repo: "aipe", specialist: "Ana", task: "kanban-scroll", branch: "b", worktree: "/wt", status: "dispatched", mode: "session", sessionId: "s1", liveness: "running", harness: "claude-code", model: "claude-opus-4-8", intensity: "normal" },
        { repo: "embark", specialist: "Bruno", task: "gate-pr9", branch: "b", worktree: "/wt", status: "delivered", pr: "https://github.com/x/y/pull/9", harness: "claude-code", model: "claude-opus-4-8", intensity: "normal" },
        { repo: "aipe", specialist: "Carla", task: "cross-repo", branch: "b", worktree: "/wt", status: "escalated", harness: "claude-code", model: "claude-opus-4-8", intensity: "normal" },
        { repo: "aipe", specialist: "Dora", task: "ready-thing", branch: "b", worktree: "/wt", status: "verified", liveness: "landed", harness: "codex", model: "claude-opus-4-8", intensity: "ultracode" }, // ready + envelope EXCEPTION
        { repo: "embark", specialist: "Eli", task: "done-thing", branch: "b", worktree: "/wt", status: "verified", liveness: "landed", integrated: true }, // integrated by merge-truth, legacy envelope
      ] as unknown[],
    },
  ],
} as RawSnapshot;

beforeEach(() => {
  try { localStorage.removeItem(BOARD_CONFIG_KEY); } catch {}
  boardConfig.value = readConfig(); // = factory
  applySnapshot(snap, 1_700_000_000_000);
});
afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  resetBoardConfig();
  setLang("en");
});

test("factory default: grouped by state, only the living work (Integrados hidden) — item 3", () => {
  const { container } = render(<WorkBoard />);
  const titles = [...container.querySelectorAll(".acol-name")].map((n) => n.textContent);
  expect(titles).toEqual([t("board_col_working"), t("board_col_needs_you"), t("board_col_in_review"), t("board_col_ready")]);
  // Eli (integrated) is NOT on the default board — history is one toggle away.
  expect(container.textContent).not.toContain("Eli");
  // ...but Dora (verified, NOT integrated) IS in "ready".
  expect(container.querySelector(".bcol-ready")!.textContent).toContain("Dora");
});

test("every column header states its count (item 1 — never silent elision)", () => {
  const { container } = render(<WorkBoard />);
  const ready = container.querySelector(".bcol-ready")!;
  expect(ready.querySelector(".acol-count")!.textContent).toBe("1");
});

test("show-completed reveals the Integrados column with the merged-truth item", () => {
  const { container } = render(<WorkBoard />);
  const toggle = [...container.querySelectorAll(".actbar-toggle input")].find((el) => (el.parentElement!.textContent || "").includes(t("act_show_completed")))! as HTMLInputElement;
  fireEvent.click(toggle);
  expect(container.querySelector(".bcol-integrated")).not.toBeNull();
  expect(container.querySelector(".bcol-integrated")!.textContent).toContain("Eli");
});

test("build-your-own-board: grouping by repo pivots the columns, and it persists", () => {
  const { container } = render(<WorkBoard />);
  const repoBtn = [...container.querySelectorAll(".seg-btn")].find((b) => b.textContent === t("act_group_repo"))! as HTMLButtonElement;
  fireEvent.click(repoBtn);
  const titles = [...container.querySelectorAll(".acol-name")].map((n) => n.textContent);
  expect(titles).toEqual(["aipe", "embark"]);
  // persisted to localStorage so a reload keeps the PE's board (item 4)
  expect(readConfig().groupBy).toBe("repo");
});

test("reset returns to the factory default and clears the stored config", () => {
  const { container } = render(<WorkBoard />);
  fireEvent.click([...container.querySelectorAll(".seg-btn")].find((b) => b.textContent === t("act_group_persona"))! as HTMLButtonElement);
  expect(readConfig().groupBy).toBe("persona");
  fireEvent.click([...container.querySelectorAll("button")].find((b) => (b.textContent || "").includes(t("act_reset")))! as HTMLButtonElement);
  const titles = [...container.querySelectorAll(".acol-name")].map((n) => n.textContent);
  expect(titles[0]).toBe(t("board_col_working"));
  expect(boardConfig.value.groupBy).toBe("state");
});

test("the card carries who + status + title + repo, reading clean without AIPe jargon", () => {
  const { container } = render(<WorkBoard />);
  const card = container.querySelector(".bcol-needs-you .acard")!; // Carla, escalated
  expect(card.textContent).toContain("Carla");
  expect(card.textContent).toContain("cross repo"); // de-slugged task title
  expect(card.textContent).toContain("aipe"); // repo
  expect(card.querySelector(".chip")).not.toBeNull(); // status chip
});

test("the envelope shows the exception and mutes the common (Dora: codex + ultra)", () => {
  const { container } = render(<WorkBoard />);
  const ready = container.querySelector(".bcol-ready")!; // Dora
  const exc = [...ready.querySelectorAll(".ac-env-i.is-exc")].map((e) => e.textContent);
  expect(exc.join(" ")).toContain("codex"); // non-default harness flagged
  expect(ready.textContent).toContain(t("ac_effort_ultra")); // ultracode flagged
});

test("a needs-you card offers a copyable next-step command (console stays read-only)", () => {
  const { container } = render(<WorkBoard />);
  const needs = container.querySelector(".bcol-needs-you .acard")!;
  // Carla has no sessionId → the copyable command is `cd <worktree>`
  expect(needs.querySelector(".ic-cmd-text")!.textContent).toContain("cd /wt");
});

// re-gate B2 follow-up: cache frio não pode afirmar o que não estabeleceu. Um
// verified com merge-status ainda não conferido (integrationPending) aparece em
// "ready" MAS com a nota "verificando", não como confirmado-pendente.
test("um card com integração pendente diz 'verificando', não afirma pendência", () => {
  const pendSnap = {
    ok: true,
    context: { name: "demo", coordinator: "C" },
    journeys: [{ id: "j-p", dispatches: [
      { repo: "aipe", specialist: "Gwen", task: "cold-cache", branch: "b", worktree: "/wt", status: "verified", liveness: "landed", pr: "https://github.com/x/y/pull/40", integrationPending: true },
    ] as unknown[] }],
  } as RawSnapshot;
  applySnapshot(pendSnap, 1_700_000_000_000);
  const { container } = render(<WorkBoard />);
  const ready = container.querySelector(".bcol-ready")!;
  expect(ready.textContent).toContain("Gwen");
  expect(ready.textContent).toContain(t("ac_checking_merge"));
});
