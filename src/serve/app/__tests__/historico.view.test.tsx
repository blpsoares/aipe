import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { route } from "../views/historico.view";
import { snapshot, activity } from "../runtime/store";
import { setLang, t } from "../runtime/i18n";
import { navigate, currentPath } from "../runtime/router";
import { fireEvent } from "@testing-library/preact";
import { loadFixture } from "./fixtures";

const HistoricoView = route.component;
const EMPTY = snapshot.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  activity.value = [];
  setLang("en");
  navigate("/");
});

test("route contract: Histórico at /history, order 3, no attention badge (retrospective)", () => {
  expect(route.path).toBe("/history");
  expect(route.nav.label).toBe("nav_history");
  expect(route.nav.order).toBe(3);
  expect(route.nav.badge).toBeUndefined();
});

test("metrics block no longer claims 'not measured' — the mechanism exists, so it links to the full report", () => {
  loadFixture();
  const { container } = render(<HistoricoView />);
  expect(container.textContent).toContain(t("hist_metrics"));
  // The dishonest placeholder is gone: no "not measured" pill, no fake "—" tile.
  expect(container.querySelector(".pill-pending")).toBeNull();
  expect(container.querySelector(".metric-tile.is-pending")).toBeNull();
  // Instead, a link to the real Relatório screen.
  const link = container.querySelector(".hist-metrics-link")!;
  expect(link.textContent).toBe(t("hist_metrics_link"));
  fireEvent.click(link);
  expect(currentPath.value).toBe("/report");
});

test("timeline renders the activity feed; empty state is explicit", () => {
  const { container } = render(<HistoricoView />);
  expect(container.textContent).toContain(t("hist_timeline"));
  expect(container.textContent).toContain(t("hist_timeline_empty"));
});
