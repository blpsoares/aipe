import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { route } from "../views/historico.view";
import { snapshot, activity } from "../runtime/store";
import { setLang, t } from "../runtime/i18n";
import { navigate } from "../runtime/router";
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

test("route contract: Histórico at /history, order 2, no attention badge (retrospective)", () => {
  expect(route.path).toBe("/history");
  expect(route.nav.label).toBe("nav_history");
  expect(route.nav.badge).toBeUndefined();
});

test("metrics block reserves the place with an HONEST placeholder, never an invented number", () => {
  loadFixture();
  const { container } = render(<HistoricoView />);
  expect(container.textContent).toContain(t("hist_metrics"));
  // The pending pill states the metric isn't measured yet — no fabricated figure.
  expect(container.querySelector(".pill-pending")!.textContent).toBe(t("hist_metrics_pending"));
  expect(container.querySelector(".metric-tile.is-pending .mt-n")!.textContent).toBe("—");
});

test("timeline renders the activity feed; empty state is explicit", () => {
  const { container } = render(<HistoricoView />);
  expect(container.textContent).toContain(t("hist_timeline"));
  expect(container.textContent).toContain(t("hist_timeline_empty"));
});
