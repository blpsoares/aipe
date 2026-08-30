import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { route } from "../views/guide.view";
import { Chip } from "../components/Chip";
import { setLang, t } from "../runtime/i18n";
import { currentPath, navigate, focusAnchor } from "../runtime/router";

const GuideView = route.component;

afterEach(() => {
  cleanup();
  setLang("en");
  focusAnchor.value = null;
  navigate("/");
});

test("route contract: Glossário at /guide, in the footer group", () => {
  expect(route.path).toBe("/guide");
  expect(route.nav.label).toBe("nav_guide");
  expect(route.nav.group).toBe("footer");
});

test("the jargon table translates every AIPe term to plain language (§3)", () => {
  const { container } = render(<GuideView />);
  expect(container.querySelector(".jargon-tbl")).toBeTruthy();
  // A few representative rows: the term and its plain-language meaning.
  expect(container.textContent).toContain(t("jg_dispatch")); // "task"
  expect(container.textContent).toContain(t("jg_dispatch_d"));
  expect(container.textContent).toContain(t("jg_gate")); // "pre-approval quality review"
  expect(container.textContent).toContain(t("jg_escalation"));
});

test("the state guide still renders its cards (data from the repo's real types)", () => {
  const { container } = render(<GuideView />);
  expect(container.querySelector("#s-dispatched")).toBeTruthy();
  expect(container.querySelector("#s-verified")).toBeTruthy();
});

test("a status Chip routes to the Glossary (/guide), not the removed /status", () => {
  const { container } = render(<Chip status="escalated" />);
  fireEvent.click(container.querySelector(".chip")!);
  expect(currentPath.value).toBe("/guide");
  expect(focusAnchor.value).toBe("s-escalated");
});
