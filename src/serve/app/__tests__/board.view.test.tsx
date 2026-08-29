import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { Board } from "../components/Board";
import { setLang, t } from "../runtime/i18n";
import type { Dispatch } from "../runtime/store";
import type { SessionInfo } from "../../sessions";

afterEach(() => {
  cleanup();
  setLang("en");
});

const d = (over: Partial<Dispatch>): Dispatch =>
  ({ repo: "core", specialist: "Bruno", branch: "feat/x", status: "dispatched", mode: "session", ...over }) as Dispatch;

test("renders the five columns (incl. Integrados), each with its plain-language sub-line", () => {
  const { container } = render(<Board dispatches={[]} sessions={[]} />);
  const cols = [...container.querySelectorAll(".bcol")];
  expect(cols.length).toBe(5);
  expect(container.textContent).toContain(t("board_col_working_sub"));
  expect(container.textContent).toContain(t("board_col_needs_you_sub"));
  expect(container.textContent).toContain(t("board_col_integrated_sub"));
});

test("a card keeps task, persona, branch and PR TOGETHER (no screen switch to complete it)", () => {
  const dispatches = [d({ specialist: "Bruno", status: "delivered", task: "api-limits", branch: "feat/limits", pr: "https://github.com/x/y/pull/9", liveness: "landed" })];
  const { container } = render(<Board dispatches={dispatches} sessions={[]} />);
  const card = container.querySelector(".bcol-in-review .bcard")!;
  expect(card.textContent).toContain("Bruno");
  expect(card.textContent).toContain("api-limits");
  expect(card.textContent).toContain("feat/limits");
  expect(card.querySelector(".bc-pr")!.getAttribute("href")).toBe("https://github.com/x/y/pull/9");
});

test("a needs-you card names who acts next (recedes what isn't the PE's)", () => {
  const dispatches = [d({ specialist: "Bruno", status: "blocked", liveness: "waiting" })];
  const { container } = render(<Board dispatches={dispatches} sessions={[]} />);
  const card = container.querySelector(".bcol-needs-you .bcard")!;
  expect(card.textContent).toContain(t("board_actor_pre"));
  expect(card.textContent).toContain(t("board_actor_coord"));
});

test("a waiting-approval session card flags that it is waiting on YOU (armadilha 1)", () => {
  const dispatches = [d({ specialist: "Bruno", status: "dispatched", liveness: "running", worktree: "/wt" })];
  const sessions: SessionInfo[] = [{ id: "s", status: "running", activity: "waiting", cwd: "/wt" }];
  const { container } = render(<Board dispatches={dispatches} sessions={sessions} />);
  const needs = container.querySelector(".bcol-needs-you")!;
  expect(needs.textContent).toContain("Bruno");
  expect(needs.textContent).toContain(t("board_waiting_approval"));
});
