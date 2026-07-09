import "./setup";
import { test, expect, afterEach, beforeEach } from "bun:test";
import { cvOf, dispatchesOf, repoOf, kindOf, worktreeOf, cvWork, unitLines } from "../runtime/selectors";
import { snapshot, dispatches } from "../runtime/store";

const EMPTY = snapshot.value;

beforeEach(() => {
  snapshot.value = {
    ...EMPTY,
    repos: [
      { name: "app", stack: [], kind: "service", packages: [] },
      { name: "mono", stack: [], kind: "", packages: [{ name: "core", stack: [], kind: "lib", group: undefined }] },
    ],
    packages: [{ repo: "mono", package: "core", kind: "lib" }],
    cvs: [{ name: "Ana", title: "Dev", bio: "bio here", competences: ["ts", "react"] }],
  };
  dispatches.value = [
    { repo: "app", specialist: "Ana", status: "dispatched", journey: "j1" },
    { repo: "app", specialist: "ana", status: "delivered", journey: "j2" },
    { repo: "app", specialist: "Ana", status: "removed", journey: "j3" },
    { repo: "app", specialist: "Other", status: "dispatched", journey: "j4" },
  ];
});

afterEach(() => {
  snapshot.value = EMPTY;
  dispatches.value = [];
});

test("cvOf finds by name, falls back to empty CV", () => {
  expect(cvOf("Ana")).toEqual({ name: "Ana", title: "Dev", bio: "bio here", competences: ["ts", "react"] });
  expect(cvOf("Nobody")).toEqual({ title: "", bio: "", competences: [] });
});

test("dispatchesOf filters case-insensitively by specialist", () => {
  const ds = dispatchesOf("ANA");
  expect(ds.length).toBe(3);
  expect(ds.every((d) => (d.specialist as string).toLowerCase() === "ana")).toBe(true);
});

test("repoOf finds a repo by name", () => {
  expect(repoOf("app")?.kind).toBe("service");
  expect(repoOf("nope")).toBeUndefined();
});

test("kindOf: worker with package looks up DATA.packages by {repo,package}", () => {
  expect(kindOf({ repo: "mono", package: "core" })).toBe("lib");
  expect(kindOf({ repo: "mono", package: "missing" })).toBe("");
});

test("kindOf: worker without package falls back to repoOf(w.repo).kind", () => {
  expect(kindOf({ repo: "app" })).toBe("service");
  expect(kindOf({ repo: "unknown-repo" })).toBe("");
});

test("worktreeOf: prefers a dispatch with .worktree, else the first dispatch's .branch, else null", () => {
  dispatches.value = [
    { repo: "app", specialist: "Bob", status: "dispatched", branch: "feat/x" },
    { repo: "app", specialist: "Bob", status: "delivered", worktree: "/home/x/wt/feat-y" },
  ];
  expect(worktreeOf("Bob")).toBe("feat-y");

  dispatches.value = [{ repo: "app", specialist: "Carol", status: "dispatched", branch: "feat/z" }];
  expect(worktreeOf("Carol")).toBe("feat/z");

  expect(worktreeOf("Nobody")).toBeNull();
});

test("worktreeOf falls back to '—' rendering via unitLines when null", () => {
  dispatches.value = [];
  expect(worktreeOf("Nobody")).toBeNull();
  const rows = unitLines({ name: "Nobody", repo: "app" });
  expect(rows.find((r) => r.key === "worktree")?.value).toBe("—");
});

test("cvWork buckets delivered(+merged) and inprog(dispatched+escalated); removed is excluded from both", () => {
  dispatches.value = [
    { repo: "app", specialist: "Ana", status: "delivered" },
    { repo: "app", specialist: "Ana", status: "merged" },
    { repo: "app", specialist: "Ana", status: "dispatched" },
    { repo: "app", specialist: "Ana", status: "escalated" },
    { repo: "app", specialist: "Ana", status: "removed" },
  ];
  const work = cvWork("Ana");
  expect(work.delivered.length).toBe(2);
  expect(work.inprog.length).toBe(2);
  expect(work.delivered.some((d) => d.status === "removed")).toBe(false);
  expect(work.inprog.some((d) => d.status === "removed")).toBe(false);
});

test("unitLines: monorepo worker gets monorepo+package rows; plain repo worker gets repo row", () => {
  const monoRows = unitLines({ name: "Ana", repo: "mono", package: "core" });
  expect(monoRows.map((r) => r.key)).toEqual(["monorepo", "package", "type", "worktree"]);
  expect(monoRows.find((r) => r.key === "monorepo")?.value).toBe("mono");
  expect(monoRows.find((r) => r.key === "package")?.value).toBe("core");

  const plainRows = unitLines({ name: "Ana", repo: "app" });
  expect(plainRows.map((r) => r.key)).toEqual(["repo", "type", "worktree"]);
  expect(plainRows.find((r) => r.key === "repo")?.value).toBe("app");
});

test("unitLines: monorepo worker without .package omits the package row", () => {
  const rows = unitLines({ name: "Ana", repo: "mono" });
  expect(rows.map((r) => r.key)).toEqual(["monorepo", "type", "worktree"]);
});
