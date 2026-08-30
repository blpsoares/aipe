import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { route } from "../views/agora.view";
import { snapshot, applySnapshot, openWorkerName } from "../runtime/store";
import { setLang, t } from "../runtime/i18n";
import { navigate } from "../runtime/router";
import { resetAgoraBoardOpen } from "../runtime/ui";
import { fixtureSnapshot, loadFixture } from "./fixtures";

const AgoraView = route.component;
const EMPTY = snapshot.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  openWorkerName.value = null;
  setLang("en");
  navigate("/");
  resetAgoraBoardOpen();
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

test("a PE arriving at Agora sees the whole board already on screen — no control to discover (j-20260830-r5)", () => {
  loadFixture();
  const { container } = render(<AgoraView />);
  // The consequence that matters: the board's own content (its state columns)
  // is on screen NOW, not "a toggle exists that would reveal it if clicked".
  expect(container.querySelector(".aboard")).toBeTruthy();
  expect(container.querySelector(".acol")).toBeTruthy();
  const toggle = container.querySelector(".zone-board .board-toggle")! as HTMLButtonElement;
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
});

test("a PE who explicitly collapses the board keeps that choice on the next render, but a fresh PE never gets it hidden", () => {
  loadFixture();
  const { container, unmount } = render(<AgoraView />);
  fireEvent.click(container.querySelector(".zone-board .board-toggle")! as HTMLButtonElement);
  expect(container.querySelector(".aboard")).toBeNull();
  unmount();

  // Same (returning) PE, next render — the collapse choice stuck.
  const again = render(<AgoraView />);
  expect(again.container.querySelector(".aboard")).toBeNull();
  expect(again.container.querySelector(".zone-board .board-toggle")!.getAttribute("aria-expanded")).toBe("false");
  again.unmount();

  // A PE who never chose (storage cleared) always lands on a visible board.
  resetAgoraBoardOpen();
  const fresh = render(<AgoraView />);
  expect(fresh.container.querySelector(".aboard")).toBeTruthy();
});

test("clicking a working specialist opens their drawer (openWorkerName)", () => {
  loadFixture();
  const { container } = render(<AgoraView />);
  const row = container.querySelector(".happening-row")! as HTMLButtonElement;
  fireEvent.click(row);
  expect(openWorkerName.value).toBe("Ana");
});
