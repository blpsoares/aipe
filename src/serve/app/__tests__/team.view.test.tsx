import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { route } from "../views/team.view";
import { snapshot, counts, dispatches, openWorkerName } from "../runtime/store";
import { setLang } from "../runtime/i18n";
import { cvWork } from "../runtime/selectors";
import { loadFixture } from "./fixtures";

const TeamView = route.component;
const EMPTY = snapshot.value;
const EMPTY_COUNTS = counts.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  counts.value = EMPTY_COUNTS;
  dispatches.value = [];
  openWorkerName.value = null;
  setLang("en");
});

test("route contract: path/order/icon preserved", () => {
  expect(route.path).toBe("/team");
  expect(route.nav).toEqual({ label: "nav_workers", icon: "team", order: 3 });
});

test("renders one card per worker (coordinator already excluded upstream)", () => {
  loadFixture();
  const { container } = render(<TeamView />);
  const cards = [...container.querySelectorAll(".cvgrid .cvcard")];
  expect(cards.length).toBe(snapshot.value.workers.length);
  expect(snapshot.value.workers.some((w) => w.role === "coordinator")).toBe(false);
});

test("subtitle interpolates hired/active/idle from counts", () => {
  loadFixture();
  const { container } = render(<TeamView />);
  const sub = container.querySelector(".between .sub")!.textContent!;
  expect(sub).toBe(`${counts.value.hired} hired · ${counts.value.active} active · ${counts.value.idle} available`);
});

// #4 — the dead "All"/"+Dispatch" buttons were replaced by a real group-by
// control (the serve console is read-only by design; dispatching is CLI-only).
test("header has a group-by control, not the old All/+Dispatch buttons", () => {
  loadFixture();
  const { container } = render(<TeamView />);
  const btns = [...container.querySelectorAll(".row button")].map((b) => b.textContent);
  expect(btns).toEqual(["Project", "Activity", "Specialty"]);
  expect(btns).not.toContain("+ Dispatch");
});

test("cvname/cvtitle: falls back to role when persona CV has no title", () => {
  loadFixture();
  // Clear Diego's CV title to exercise the `cv.title || w.role` fallback.
  snapshot.value = {
    ...snapshot.value,
    cvs: snapshot.value.cvs.map((c: any) => (c.name === "Diego" ? { ...c, title: "" } : c)),
  };
  const { container } = render(<TeamView />);
  const cards = [...container.querySelectorAll(".cvcard")];
  const diego = cards.find((c) => c.querySelector(".cvname")!.textContent === "Diego")!;
  expect(diego).toBeTruthy();
  expect(diego.querySelector(".cvtitle")!.textContent).toBe("dev");
  const ana = cards.find((c) => c.querySelector(".cvname")!.textContent === "Ana")!;
  expect(ana.querySelector(".cvtitle")!.textContent).toBe("Frontend Developer");
});

// Finding A (whole-branch review): the "group by Activity" section order had
// no entry for "redirected" — it fell through the `?? 99` default, sorting
// it dead LAST, even after "available". `redirected` now ties `escalated`
// for the top attention tier.
test("group by activity: redirected sorts in the top attention tier, ahead of active/delivered/available", () => {
  loadFixture();
  snapshot.value = {
    ...snapshot.value,
    workers: [...snapshot.value.workers, { name: "Elis", role: "dev", repo: "web", package: null, status: "redirected" }],
  };
  const { container, getByText } = render(<TeamView />);
  fireEvent.click(getByText("Activity"));
  const labels = [...container.querySelectorAll(".team-group .eyebrow")].map((e) => e.textContent);
  expect(labels.indexOf("redirected")).toBeGreaterThanOrEqual(0);
  expect(labels.indexOf("redirected")).toBeLessThan(labels.indexOf("active"));
  expect(labels.indexOf("redirected")).toBeLessThan(labels.indexOf("delivered"));
  expect(labels.indexOf("redirected")).toBeLessThan(labels.indexOf("available"));
});

test("Chip renders the worker's status", () => {
  loadFixture();
  const { container } = render(<TeamView />);
  const cards = [...container.querySelectorAll(".cvcard")];
  const carla = cards.find((c) => c.querySelector(".cvname")!.textContent === "Carla")!;
  expect(carla.querySelector(".chip")!.className).toContain("escalated");
});

test("UnitFacts: monorepo/package rows for a monorepo worker, plain repo row for a single-package worker", () => {
  loadFixture();
  const { container } = render(<TeamView />);
  const cards = [...container.querySelectorAll(".cvcard")];
  const bruno = cards.find((c) => c.querySelector(".cvname")!.textContent === "Bruno")!;
  const brunoDts = [...bruno.querySelectorAll("dl.kv dt")].map((d) => d.textContent);
  expect(brunoDts).toContain("monorepo");
  expect(brunoDts).toContain("package");

  const ana = cards.find((c) => c.querySelector(".cvname")!.textContent === "Ana")!;
  const anaDts = [...ana.querySelectorAll("dl.kv dt")].map((d) => d.textContent);
  expect(anaDts).toContain("repo");
  expect(anaDts).not.toContain("monorepo");
});

test("CompChips: max=4 in the card, with +N overflow chip when more competences exist", () => {
  loadFixture();
  // Give Ana more than 4 competences to exercise the overflow chip.
  snapshot.value = {
    ...snapshot.value,
    cvs: snapshot.value.cvs.map((c: any) =>
      c.name === "Ana" ? { ...c, competences: ["a", "b", "c", "d", "e", "f"] } : c,
    ),
  };
  const { container } = render(<TeamView />);
  const cards = [...container.querySelectorAll(".cvcard")];
  const ana = cards.find((c) => c.querySelector(".cvname")!.textContent === "Ana")!;
  const chips = [...ana.querySelectorAll(".cvcomp .comp")];
  expect(chips.length).toBe(5); // 4 + "more"
  expect(chips.filter((c) => c.className.includes("more")).map((c) => c.textContent)).toEqual(["+2"]);
});

test("CompChips: falls back to 'none' sub text when no competences", () => {
  loadFixture();
  snapshot.value = {
    ...snapshot.value,
    cvs: snapshot.value.cvs.map((c: any) => (c.name === "Ana" ? { ...c, competences: [] } : c)),
  };
  const { container } = render(<TeamView />);
  const cards = [...container.querySelectorAll(".cvcard")];
  const ana = cards.find((c) => c.querySelector(".cvname")!.textContent === "Ana")!;
  expect(ana.querySelector(".cvcomp .sub")!.textContent).toBe("none");
});

test("cvstats: delivered/inprog numbers match cvWork buckets", () => {
  loadFixture();
  const { container } = render(<TeamView />);
  const cards = [...container.querySelectorAll(".cvcard")];
  const bruno = cards.find((c) => c.querySelector(".cvname")!.textContent === "Bruno")!;
  const work = cvWork("Bruno");
  const stats = [...bruno.querySelectorAll(".cvstats .cvstat b")].map((b) => b.textContent);
  expect(stats).toEqual([String(work.delivered.length), String(work.inprog.length)]);
});

test("clicking a card sets openWorkerName to that worker's name", () => {
  loadFixture();
  const { container } = render(<TeamView />);
  const cards = [...container.querySelectorAll(".cvcard")];
  const carla = cards.find((c) => c.querySelector(".cvname")!.textContent === "Carla")! as HTMLButtonElement;
  carla.click();
  expect(openWorkerName.value).toBe("Carla");
});
