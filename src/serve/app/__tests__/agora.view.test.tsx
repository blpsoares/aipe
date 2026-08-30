import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { route } from "../views/agora.view";
import { snapshot, applySnapshot, openWorkerName } from "../runtime/store";
import { setLang, t } from "../runtime/i18n";
import { navigate } from "../runtime/router";
import { fixtureSnapshot, loadFixture } from "./fixtures";

const AgoraView = route.component;
const EMPTY = snapshot.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  openWorkerName.value = null;
  setLang("en");
  navigate("/");
});

test("route contract: Agora is the landing route (path '/', order 0)", () => {
  expect(route.path).toBe("/");
  expect(route.nav.label).toBe("nav_now");
  expect(route.nav.order).toBe(0);
});

test("heading + governing-question subtitle (comprehension: what is this screen)", () => {
  const { container } = render(<AgoraView />);
  expect(container.querySelector(".view-h")!.textContent).toBe(t("nav_now"));
  expect(container.textContent).toContain(t("now_sub"));
});

test("with no PE decision, the 'Needs you' zone shows a calm all-clear (empty IS success)", () => {
  loadFixture(); // fixture carries no `attention` array → no PE decisions
  const { container } = render(<AgoraView />);
  const zone = container.querySelector(".zone-needs")!;
  expect(zone.querySelector(".allclear")).toBeTruthy();
  expect(zone.textContent).toContain(t("now_allclear_h"));
});

test("a PE decision (open escalation) surfaces in 'Needs you', not all-clear", () => {
  applySnapshot(
    {
      ...fixtureSnapshot,
      attention: [{ kind: "escalated-open", severity: "warning", unit: "core/ui", specialist: "Carla", journey: "j-core-2", detail: "cross-repo change needs your approval" }],
    },
    1_700_000_000_000,
  );
  const { container } = render(<AgoraView />);
  const zone = container.querySelector(".zone-needs")!;
  expect(zone.querySelector(".allclear")).toBeNull();
  expect(zone.textContent).toContain("core/ui");
});

test("'Happening now' lists the working specialist (Ana, dispatched)", () => {
  loadFixture();
  const { container } = render(<AgoraView />);
  const happening = container.querySelector(".zone-happening")!;
  expect(happening.textContent).toContain("Ana");
});

test("the whole board is a collapsible section INSIDE Agora, collapsed by default (approved map)", () => {
  loadFixture();
  const { container } = render(<AgoraView />);
  // The board lives here again (decision A) — a toggle, collapsed, no grid yet.
  const toggle = container.querySelector(".zone-board .board-toggle")! as HTMLButtonElement;
  expect(toggle).toBeTruthy();
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector(".aboard")).toBeNull();
});

test("expanding the section reveals the full Atividade board (its machinery reused verbatim)", () => {
  loadFixture();
  const { container } = render(<AgoraView />);
  fireEvent.click(container.querySelector(".zone-board .board-toggle")! as HTMLButtonElement);
  // #39's board renders: the .aboard strip with its state columns.
  expect(container.querySelector(".aboard")).toBeTruthy();
  expect(container.querySelector(".acol")).toBeTruthy();
});

test("clicking a working specialist opens their drawer (openWorkerName)", () => {
  loadFixture();
  const { container } = render(<AgoraView />);
  const row = container.querySelector(".happening-row")! as HTMLButtonElement;
  fireEvent.click(row);
  expect(openWorkerName.value).toBe("Ana");
});
