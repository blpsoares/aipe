import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { ActivityFeed } from "../components/ActivityFeed";
import { diffActivity, type Dispatch } from "../runtime/store";

const idT = (k: string) => k;

afterEach(cleanup);

// #9 — enrich activity beyond "who was dispatched to what": carry WHO / WHAT /
// WHERE (repo/package, branch, worktree) structurally so the feed can show it.
test("diffActivity carries structured WHERE (repo/pkg/branch/worktree) for every status", () => {
  const cur: Dispatch[] = [
    {
      repo: "core",
      package: "api",
      specialist: "Bruno",
      status: "delivered",
      journey: "j-core-1",
      branch: "feat/bruno-api-limits",
      worktree: ".worktrees/core-api-bruno",
      pr: "https://github.com/example/core/pull/12",
    },
  ];
  const { activity } = diffActivity(null, cur, 1000, idT);
  expect(activity).toHaveLength(1);
  const e = activity[0]!;
  expect(e.repo).toBe("core");
  expect(e.pkg).toBe("api");
  expect(e.branch).toBe("feat/bruno-api-limits");
  expect(e.worktree).toBe("core-api-bruno"); // last path segment
  expect(e.pr).toBe("https://github.com/example/core/pull/12");
  expect(e.journey).toBe("j-core-1");
});

test("ActivityFeed renders the WHERE line (repo/pkg + branch) not only for 'dispatched'", () => {
  const events = [
    {
      w: "Bruno",
      status: "delivered",
      m: "delivered · PR · j-core-1",
      at: 1000,
      repo: "core",
      pkg: "api",
      branch: "feat/bruno-api-limits",
      pr: "https://github.com/example/core/pull/12",
    },
  ];
  const { container } = render(<ActivityFeed events={events} />);
  const where = container.querySelector(".ev-where");
  expect(where).not.toBeNull();
  expect(where!.textContent).toContain("core/api");
  expect(where!.textContent).toContain("feat/bruno-api-limits");
  expect(container.querySelector(".ev-where a.link")).not.toBeNull(); // PR link
});

test("ActivityFeed: no WHERE line when the event has no location fields", () => {
  const events = [{ w: "X", status: "escalated", m: "escalated", at: 1000 }];
  const { container } = render(<ActivityFeed events={events} />);
  expect(container.querySelector(".ev-where")).toBeNull();
});
