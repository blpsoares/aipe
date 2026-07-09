import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { route } from "../views/org.view";
import { snapshot, openWorkerName, applySnapshot } from "../runtime/store";
import { orgQuery, orgTransform, zoomBy } from "../runtime/org";
import { navigate } from "../runtime/router";
import { setLang } from "../runtime/i18n";
import { loadFixture } from "./fixtures";

const OrgView = route.component;
const EMPTY = snapshot.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  orgQuery.value = "";
  orgTransform.value = { s: 1, x: 0, y: 0 };
  openWorkerName.value = null;
  setLang("en");
  navigate("/overview");
});

test("route contract: path/order/icon preserved", () => {
  expect(route.path).toBe("/org");
  expect(route.nav).toEqual({ label: "nav_org", icon: "◈", order: 1 });
});

test("empty snapshot -> org_nomatch in both the SVG wrap and the mobile tree", () => {
  const { container } = render(<OrgView />);
  expect(container.querySelector(".orgwrap")!.textContent).toBe("No repo or specialist matches the filter.");
  expect(container.querySelector(".otree")!.textContent).toBe("No repo or specialist matches the filter.");
});

test("core (monorepo) renders a package cluster per package plus a specialist node inside it", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const nodeTitles = [...container.querySelectorAll(".orgwrap svg .onode .otitle")].map((n) => n.textContent);
  // package cluster headers
  expect(nodeTitles).toContain("api");
  expect(nodeTitles).toContain("ui");
  // specialists dispatched under those packages
  expect(nodeTitles).toContain("Bruno");
  expect(nodeTitles).toContain("Carla");
  // repo column header itself
  expect(nodeTitles).toContain("core");
});

test("web (single-package repo) renders its worker at repo level, no package cluster", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const nodeTitles = [...container.querySelectorAll(".orgwrap svg .onode .otitle")].map((n) => n.textContent);
  expect(nodeTitles).toContain("Ana");
  expect(nodeTitles).toContain("Diego");
  // no package label rendered for web (it has no packages)
  const pkgLabels = nodeTitles.filter((n) => n === "web");
  expect(pkgLabels.length).toBe(1); // just the repo header itself
});

test("orgQuery filters: a repo-name match shows ALL of that repo's workers, others hidden", () => {
  loadFixture();
  orgQuery.value = "core";
  const { container } = render(<OrgView />);
  const nodeTitles = [...container.querySelectorAll(".orgwrap svg .onode .otitle")].map((n) => n.textContent);
  expect(nodeTitles).toContain("core");
  expect(nodeTitles).toContain("Bruno");
  expect(nodeTitles).toContain("Carla");
  expect(nodeTitles).not.toContain("web");
  expect(nodeTitles).not.toContain("Ana");
});

test("orgQuery with no match -> org_nomatch", () => {
  loadFixture();
  orgQuery.value = "zzz-nope";
  const { container } = render(<OrgView />);
  expect(container.querySelector(".orgwrap")!.textContent).toBe("No repo or specialist matches the filter.");
});

test("search input reflects orgQuery and typing updates the signal + filters live (focus-preserving improvement)", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const input = container.querySelector("#orgSearch") as HTMLInputElement;
  expect(input.value).toBe("");
  fireEvent.input(input, { target: { value: "core" } });
  expect(orgQuery.value).toBe("core");
  const nodeTitles = [...container.querySelectorAll(".orgwrap svg .onode .otitle")].map((n) => n.textContent);
  expect(nodeTitles).not.toContain("web");
});

test("search input preserves the typed CASE on screen (no caret-jumping lowercase rewrite) while matching stays case-insensitive", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const input = container.querySelector("#orgSearch") as HTMLInputElement;
  // Type "Core" (uppercase C) — the displayed value must keep the user's case,
  // NOT be folded to "core" (which would snap the caret to the end in a browser).
  fireEvent.input(input, { target: { value: "Core" } });
  expect(orgQuery.value).toBe("Core"); // raw value stored
  const rerendered = container.querySelector("#orgSearch") as HTMLInputElement;
  expect(rerendered.value).toBe("Core"); // controlled input still shows "Core"
  // …yet the case-insensitive match still filters to repo "core".
  const nodeTitles = [...container.querySelectorAll(".orgwrap svg .onode .otitle")].map((n) => n.textContent);
  expect(nodeTitles).toContain("core");
  expect(nodeTitles).not.toContain("web");
});

test("relation edges render as an oedge path + label when relations reference plain repo names", () => {
  loadFixture();
  snapshot.value = { ...snapshot.value, relations: [{ from: "web", to: "core", type: "depends" }] };
  const { container } = render(<OrgView />);
  const edge = container.querySelector(".orgwrap svg .oedge");
  expect(edge).toBeTruthy();
  expect(edge!.tagName.toLowerCase()).toBe("path");
  const label = container.querySelector(".orgwrap svg .oedge-l");
  expect(label!.textContent).toBe("depends");
});

test("clicking a specialist node sets openWorkerName", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const node = [...container.querySelectorAll('.orgwrap svg .onode[role="button"]')].find((g) => g.getAttribute("aria-label")!.startsWith("Ana "))!;
  fireEvent.click(node);
  expect(openWorkerName.value).toBe("Ana");
});

test("Enter on a focused specialist node triggers the same click behavior", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const node = [...container.querySelectorAll('.orgwrap svg .onode[role="button"]')].find((g) => g.getAttribute("aria-label")!.startsWith("Bruno "))!;
  fireEvent.keyDown(node, { key: "Enter" });
  expect(openWorkerName.value).toBe("Bruno");
});

test("Space on a focused specialist node also triggers it", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const node = [...container.querySelectorAll('.orgwrap svg .onode[role="button"]')].find((g) => g.getAttribute("aria-label")!.startsWith("Carla "))!;
  fireEvent.keyDown(node, { key: " " });
  expect(openWorkerName.value).toBe("Carla");
});

test("non-clickable nodes (coordinator, repo header) get role=img, not button", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const coordNode = [...container.querySelectorAll(".orgwrap svg .onode")].find((g) => g.querySelector(".otitle")!.textContent === "Coordinator")!;
  expect(coordNode.getAttribute("role")).toBe("img");
  const repoNode = [...container.querySelectorAll(".orgwrap svg .onode")].find((g) => g.querySelector(".otitle")!.textContent === "web")!;
  expect(repoNode.getAttribute("role")).toBe("img");
});

test("node colors follow orgColor(status): active->sky, delivered->accent, escalated->amber", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const anaNode = [...container.querySelectorAll('.orgwrap svg .onode[role="button"]')].find((g) => g.getAttribute("aria-label")!.startsWith("Ana "))!;
  expect(anaNode.querySelector("rect")!.getAttribute("stroke")).toBe("var(--sky)"); // active
  const brunoNode = [...container.querySelectorAll('.orgwrap svg .onode[role="button"]')].find((g) => g.getAttribute("aria-label")!.startsWith("Bruno "))!;
  expect(brunoNode.querySelector("rect")!.getAttribute("stroke")).toBe("var(--accent)"); // delivered
  const carlaNode = [...container.querySelectorAll('.orgwrap svg .onode[role="button"]')].find((g) => g.getAttribute("aria-label")!.startsWith("Carla "))!;
  expect(carlaNode.querySelector("rect")!.getAttribute("stroke")).toBe("var(--amber)"); // escalated
  // only "active" workers pulse
  expect(anaNode.querySelector("circle")!.getAttribute("class")).toBe("odot-active");
  expect(brunoNode.querySelector("circle")!.getAttribute("class")).toBeFalsy();
});

test("orgZoom pure math: zoomBy(1) multiplies scale by 1.2 repeatedly, clamped at 3; zoomBy(0) resets", () => {
  orgTransform.value = { s: 1, x: 10, y: 10 };
  zoomBy(1);
  expect(orgTransform.value.s).toBeCloseTo(1.2);
  zoomBy(1);
  expect(orgTransform.value.s).toBeCloseTo(1.44);
  for (let i = 0; i < 20; i++) zoomBy(1);
  expect(orgTransform.value.s).toBe(3);
  zoomBy(0);
  expect(orgTransform.value).toEqual({ s: 1, x: 0, y: 0 });
});

test("orgZoom pure math: zoomBy(-1) divides scale by 1.2, clamped at 0.3", () => {
  orgTransform.value = { s: 1, x: 0, y: 0 };
  zoomBy(-1);
  expect(orgTransform.value.s).toBeCloseTo(1 / 1.2);
  for (let i = 0; i < 20; i++) zoomBy(-1);
  expect(orgTransform.value.s).toBe(0.3);
});

test("zoom toolbar buttons drive orgTransform via the same math", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const buttons = [...container.querySelectorAll(".org-ctrls button")] as HTMLButtonElement[];
  const [zoomOut, zoomIn, reset] = buttons;
  expect(buttons.length).toBe(4);
  zoomIn!.click();
  expect(orgTransform.value.s).toBeCloseTo(1.2);
  zoomOut!.click();
  expect(orgTransform.value.s).toBeCloseTo(1);
  reset!.click();
  expect(orgTransform.value).toEqual({ s: 1, x: 0, y: 0 });
});

test("pointerdown on a clickable specialist node does NOT start a drag (orgTransform unchanged on subsequent pointermove)", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const node = [...container.querySelectorAll('.orgwrap svg .onode[role="button"]')].find((g) => g.getAttribute("aria-label")!.startsWith("Ana "))!;
  const before = orgTransform.value;
  fireEvent.pointerDown(node, { clientX: 50, clientY: 50, pointerId: 1 });
  fireEvent.pointerMove(container.querySelector(".orgwrap")!, { clientX: 90, clientY: 90, pointerId: 1 });
  expect(orgTransform.value).toEqual(before);
});

test("pan/zoom effect suppresses native scroll on .orgwrap (overflow:hidden + touchAction:none + cursor:grab)", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const wrap = container.querySelector(".orgwrap") as HTMLElement;
  expect(wrap.style.overflow).toBe("hidden");
  expect(wrap.style.touchAction).toBe("none");
  expect(wrap.style.cursor).toBe("grab");
});

test("pointerdown on the wrap background (not a node) DOES start a drag; pointermove pans", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const wrap = container.querySelector(".orgwrap")!;
  orgTransform.value = { s: 1, x: 0, y: 0 };
  fireEvent.pointerDown(wrap, { clientX: 50, clientY: 50, pointerId: 2 });
  fireEvent.pointerMove(wrap, { clientX: 90, clientY: 70, pointerId: 2 });
  expect(orgTransform.value).toEqual({ s: 1, x: 40, y: 20 });
});

test("legend has exactly 5 items", () => {
  const { container } = render(<OrgView />);
  const items = container.querySelectorAll(".orglegend .lg-i");
  expect(items.length).toBe(5);
  expect(container.querySelector(".orglegend .lg-h")!.textContent).toBe("Legend");
});

test("OrgTree (mobile): renders per-repo people, and 'no specialists yet' for an empty repo", () => {
  applySnapshot(
    {
      ok: true,
      context: { coordinator: "Coord" },
      workers: [{ name: "Solo", role: "dev", repo: "lonely", status: "active" }],
      repos: ["lonely", "quiet"],
      repoInfos: [
        { name: "lonely", stack: [], kind: "service" },
        { name: "quiet", stack: [], kind: "lib" },
      ],
    },
    1,
  );
  const { container } = render(<OrgView />);
  const tree = container.querySelector(".otree")!;
  expect(tree.querySelector(".ot-name")!.textContent).toBe("Coord");
  const repos = [...tree.querySelectorAll(".ot-repo")];
  expect(repos.length).toBe(2);
  const lonely = repos.find((r) => r.querySelector(".ot-rname")!.textContent === "lonely")!;
  expect(lonely.querySelector(".ot-pname")!.textContent).toBe("Solo");
  const quiet = repos.find((r) => r.querySelector(".ot-rname")!.textContent === "quiet")!;
  expect(quiet.textContent).toContain("no specialists yet");
});

test("OrgTree person click sets openWorkerName", () => {
  loadFixture();
  const { container } = render(<OrgView />);
  const person = [...container.querySelectorAll(".otree .ot-person")].find((b) => b.textContent!.includes("Diego"))!;
  (person as HTMLElement).click();
  expect(openWorkerName.value).toBe("Diego");
});
