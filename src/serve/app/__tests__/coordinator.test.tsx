import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { coordinatorView } from "../runtime/coordinator";
import { CoordinatorPanel } from "../components/CoordinatorPanel";
import { snapshot, applySnapshot } from "../runtime/store";
import type { JourneyLike } from "../runtime/floor";
import { setLang, t } from "../runtime/i18n";

const EMPTY = snapshot.value;
afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  setLang("en");
});

function j(dispatches: { specialist: string; status: string; repo?: string }[]): JourneyLike {
  return { id: "j", dispatches: dispatches.map((d) => ({ repo: d.repo ?? "aipe", specialist: d.specialist, branch: "b", worktree: "w", status: d.status })) } as JourneyLike;
}

test("coordinatorView separates what the coordinator waits on from what the PE must act on", () => {
  const v = coordinatorView(
    j([
      { specialist: "Jesse", status: "delivered" }, // waiting on QA
      { specialist: "Mike", status: "dispatched" }, // waiting on the dev
      { specialist: "Ana", status: "verified" }, // next: merge
      { specialist: "Sky", status: "failed" }, // next: re-dispatch
      { specialist: "Lee", status: "escalated" }, // → PE inbox, NOT a coordinator wait
    ]),
    2, // inbox count (PE must act)
  );
  expect(v.waiting.map((w) => w.whatKey).sort()).toEqual(["co_wait_dev", "co_wait_qa"]);
  expect(v.next.map((n) => n.actionKey).sort()).toEqual(["co_next_merge", "co_next_redispatch"]);
  // escalations belong to the PE inbox, kept separate from the coordinator's waits
  expect(v.needsPE).toBe(2);
  expect(v.waiting.some((w) => w.who === "Lee")).toBe(false);
});

test("the panel renders one coordinator identity and shows open sessions as a session fact (5.5)", () => {
  applySnapshot(
    {
      ok: true,
      context: { name: "demo", coordinator: "Heisenberg" },
      journeys: [{ id: "j", dispatches: [{ repo: "aipe", specialist: "Jesse", branch: "b", worktree: "w", status: "dispatched" }] }],
      coordinatorSessions: [
        { id: "a", status: "running", cwd: "/ws" },
        { id: "b", status: "running", cwd: "/ws" },
        { id: "c", status: "running", cwd: "/ws" },
      ],
    } as any,
    Date.now(),
  );
  const { container } = render(<CoordinatorPanel />);
  // exactly ONE coordinator name…
  expect(container.querySelectorAll(".co-name").length).toBe(1);
  expect(container.querySelector(".co-name")!.textContent).toBe("Heisenberg");
  // …and the open sessions shown as a count, not as N coordinators.
  expect(container.querySelector(".co-sessions")!.textContent).toContain("3");
  expect(container.textContent).toContain(t("co_sessions"));
});
