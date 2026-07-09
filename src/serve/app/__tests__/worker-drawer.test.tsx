import "./setup";
import { test, expect, afterEach, beforeEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { WorkerDrawer } from "../components/WorkerDrawer";
import { openWorkerName, snapshot, dispatches } from "../runtime/store";
import { setLang } from "../runtime/i18n";

const EMPTY = snapshot.value;

const baseWorker = { name: "Ana", role: "dev", repo: "app", package: null, status: "active" };

beforeEach(() => {
  snapshot.value = {
    ...EMPTY,
    workers: [baseWorker],
    repos: [{ name: "app", stack: [], kind: "service", packages: [] }],
    relations: [
      { from: "app", to: "other", type: "depends" },
      { from: "unrelated-a", to: "unrelated-b", type: "depends" },
    ],
    worktrees: [{ repo: "app", branch: "feat/x" }],
    cvs: [{ name: "Ana", title: "Developer", bio: "", competences: [] }],
  };
});

afterEach(() => {
  cleanup();
  openWorkerName.value = null;
  snapshot.value = EMPTY;
  setLang("en");
});

test("closed by default (openWorkerName null): no 'on' class", () => {
  const { container } = render(<WorkerDrawer />);
  expect(container.querySelector(".drawer.on")).toBeNull();
  expect(container.querySelector(".scrim.on")).toBeNull();
});

test("opens when openWorkerName matches a store worker", () => {
  openWorkerName.value = "Ana";
  const { container } = render(<WorkerDrawer />);
  expect(container.querySelector(".drawer.on")).toBeTruthy();
  expect(container.querySelector(".scrim.on")).toBeTruthy();
  expect(container.querySelector("h3")!.textContent).toBe("Ana");
});

test("no-op when openWorkerName does not match any store worker", () => {
  openWorkerName.value = "Ghost";
  const { container } = render(<WorkerDrawer />);
  expect(container.querySelector(".drawer.on")).toBeNull();
  expect(container.querySelector("h3")).toBeNull();
});

test("sub2 shows cv.title||role · fqid(w)", () => {
  openWorkerName.value = "Ana";
  const { container } = render(<WorkerDrawer />);
  expect(container.querySelector(".sub2")!.textContent).toBe("Developer · app");
});

test("journey/pr rows appear only when present", () => {
  openWorkerName.value = "Ana";
  const { container, rerender } = render(<WorkerDrawer />);
  expect(container.textContent).not.toContain("journey");

  snapshot.value = { ...snapshot.value, workers: [{ ...baseWorker, journey: "j1", pr: "https://pr/1" }] };
  rerender(<WorkerDrawer />);
  const dl = container.querySelector("dl.dl")!;
  expect(dl.textContent).toContain("j1");
  expect(container.querySelector("dl.dl a.link")).toBeTruthy();
});

test("bio paragraph appears only when cv.bio is set", () => {
  openWorkerName.value = "Ana";
  const { container, rerender } = render(<WorkerDrawer />);
  expect(container.querySelector(".cvbio")).toBeNull();

  snapshot.value = { ...snapshot.value, cvs: [{ name: "Ana", title: "Developer", bio: "Ships things.", competences: [] }] };
  rerender(<WorkerDrawer />);
  expect(container.querySelector(".cvbio")!.textContent).toBe("Ships things.");
});

test("worktree section appears only when DATA.worktrees has rows for the worker's repo", () => {
  openWorkerName.value = "Ana";
  const { container, rerender } = render(<WorkerDrawer />);
  const headers = () => [...container.querySelectorAll(".sec-h")].map((h) => h.textContent);
  expect(headers().some((h) => h!.startsWith("Worktree"))).toBe(true);
  expect(container.textContent).toContain("feat/x");

  snapshot.value = { ...snapshot.value, worktrees: [] };
  rerender(<WorkerDrawer />);
  expect(headers().some((h) => h!.startsWith("Worktree"))).toBe(false);
});

test("relations are filtered by repo (from===w.repo || to===w.repo), not by worker name", () => {
  openWorkerName.value = "Ana";
  const { container } = render(<WorkerDrawer />);
  expect(container.textContent).toContain("app → other");
  expect(container.textContent).not.toContain("unrelated-a");
});

test("relations section falls back to 'none' when empty", () => {
  snapshot.value = { ...snapshot.value, relations: [] };
  openWorkerName.value = "Ana";
  const { container } = render(<WorkerDrawer />);
  const relHeader = [...container.querySelectorAll(".sec-h")].find((h) => h.textContent?.includes("Unit relations"))!;
  expect(relHeader.nextElementSibling!.textContent).toBe("none");
});

test("competences render with NO max (unlike the card's max=4)", () => {
  snapshot.value = {
    ...snapshot.value,
    cvs: [{ name: "Ana", title: "Developer", bio: "", competences: ["a", "b", "c", "d", "e", "f"] }],
  };
  openWorkerName.value = "Ana";
  const { container } = render(<WorkerDrawer />);
  expect(container.querySelectorAll(".comp").length).toBe(6);
  expect(container.querySelector(".comp.more")).toBeNull();
});

test("in-progress and delivered rows render via chip+journey+pr", () => {
  dispatches.value = [
    { repo: "app", package: null, specialist: "Ana", status: "dispatched", journey: "j-in", pr: null },
    { repo: "app", package: null, specialist: "Ana", status: "delivered", journey: "j-done", pr: "https://pr/9" },
  ];
  openWorkerName.value = "Ana";
  const { container } = render(<WorkerDrawer />);
  expect(container.textContent).toContain("j-in");
  expect(container.textContent).toContain("j-done");
  const links = container.querySelectorAll("a.link");
  expect([...links].some((a) => a.getAttribute("href") === "https://pr/9")).toBe(true);
  dispatches.value = [];
});

test("closing: clicking the close button and the scrim both set openWorkerName to null", () => {
  openWorkerName.value = "Ana";
  const { container } = render(<WorkerDrawer />);
  fireEvent.click(container.querySelector(".icon-btn")!);
  expect(openWorkerName.value).toBeNull();

  openWorkerName.value = "Ana";
  const { container: c2 } = render(<WorkerDrawer />);
  fireEvent.click(c2.querySelector(".scrim")!);
  expect(openWorkerName.value).toBeNull();
});
