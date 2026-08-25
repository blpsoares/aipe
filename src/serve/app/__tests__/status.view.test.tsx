import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { route } from "../views/status.view";
import { Chip } from "../components/Chip";
import { currentPath, navigate, focusAnchor } from "../runtime/router";
import { ALL_DISPATCH_STATUSES } from "../runtime/status-guide";
import { setLang, t } from "../runtime/i18n";

const StatusView = route.component;

afterEach(() => {
  cleanup();
  setLang("en");
  focusAnchor.value = null;
  navigate("/overview");
});

test("route contract: /status, ordered after the rest, book icon", () => {
  expect(route.path).toBe("/status");
  expect(route.nav).toEqual({ label: "status_nav", icon: "book", order: 8 });
});

test("the status view renders a card for every canonical DispatchStatus", () => {
  const { container } = render(<StatusView />);
  for (const s of ALL_DISPATCH_STATUSES) {
    expect(container.querySelector(`#s-${s}`)).not.toBeNull();
  }
  // and the session-mode transient + at least one reject state
  expect(container.querySelector("#s-running")).not.toBeNull();
  expect(container.querySelector("#s-no-evidence")).not.toBeNull();
});

test("each card names what it means, causes, unblocks and who acts", () => {
  const { container } = render(<StatusView />);
  const card = container.querySelector("#s-dispatched")!;
  const text = card.textContent ?? "";
  expect(text).toContain(t("sg_col_means"));
  expect(text).toContain(t("sg_col_causes"));
  expect(text).toContain(t("sg_col_unblocks"));
  expect(text).toContain(t("sg_col_who"));
  expect(text).toContain(t("sg_dispatched_m"));
});

test("a status Chip links to the status guide, focused on its own status", () => {
  const { container } = render(<Chip status="escalated" />);
  const chip = container.querySelector(".chip-link")!;
  fireEvent.click(chip);
  expect(currentPath.value).toBe("/status");
  expect(focusAnchor.value).toBe("s-escalated");
});
