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

test("the full board no longer lives in Agora — it moved to Atividade (no overlap)", () => {
  loadFixture();
  const { container } = render(<AgoraView />);
  // Agora is the inbox now: no board grid, no board toggle. The overlap the
  // redesign warned about is gone — Agora shows the actionable subset only.
  expect(container.querySelector(".board4")).toBeNull();
  expect(container.querySelector(".aboard")).toBeNull();
  expect(container.querySelector(".board-toggle")).toBeNull();
});

test("Happening-now offers a link to the full board (Atividade)", () => {
  loadFixture();
  const { container } = render(<AgoraView />);
  const link = container.querySelector(".zone-happening .zone-link")! as HTMLButtonElement;
  expect(link.textContent).toContain(t("now_see_all"));
  fireEvent.click(link);
  expect(location.hash).toBe("#/activity");
});

test("clicking a working specialist opens their drawer (openWorkerName)", () => {
  loadFixture();
  const { container } = render(<AgoraView />);
  const row = container.querySelector(".happening-row")! as HTMLButtonElement;
  fireEvent.click(row);
  expect(openWorkerName.value).toBe("Ana");
});
