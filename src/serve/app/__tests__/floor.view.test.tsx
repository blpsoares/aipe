import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { route } from "../views/floor.view";
import { snapshot, dispatches, pinnedDispatch, applySnapshot, type RawSnapshot } from "../runtime/store";
import { setLang } from "../runtime/i18n";

const FloorView = route.component;
const EMPTY = snapshot.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  dispatches.value = [];
  pinnedDispatch.value = null;
  setLang("en");
});

const RAW: RawSnapshot = {
  ok: true,
  context: { name: "aipe-demo", coordinator: "Heisenberg" },
  repos: ["aipe"],
  workers: [
    { name: "Heisenberg", role: "coordinator", repo: "aipe", status: "active" },
    { name: "Jesse", role: "dev-fullstack", repo: "aipe", status: "active", journey: "j-na" },
    { name: "Mike", role: "qa", repo: "aipe", status: "escalated", journey: "j-na" },
  ],
  repoInfos: [{ name: "aipe", stack: ["ts"], kind: "service" }],
  packages: [],
  journeys: [
    {
      id: "j-na",
      updatedAt: "2026-08-25T12:00:00Z",
      spec: { path: ".aipe/journeys/j-na/orientation.md", version: 2, approved: true },
      authorizations: [],
      dispatches: [
        { repo: "aipe", specialist: "Jesse", branch: "aipe/j-na/jesse", worktree: "/ws/aipe/.worktrees/na-jesse", status: "dispatched", mode: "session", tier: "reasoning", intensity: "ultracode", harness: "claude", model: "claude-opus-4-8" },
        { repo: "aipe", specialist: "Ana", branch: "aipe/j-na/ana", worktree: "/ws/aipe/.worktrees/na-ana", status: "delivered", pr: "https://example.com/pr/1", evidence: { by: "dev", commands: ["bun test"], summary: "all green" } },
        { repo: "aipe", specialist: "Mike", branch: "aipe/j-na/mike", worktree: "/ws/aipe/.worktrees/na-mike", status: "escalated" },
        { repo: "aipe", specialist: "Sky", branch: "aipe/j-na/sky", worktree: "/ws/aipe/.worktrees/na-sky", status: "merged", pr: "https://example.com/pr/9" },
      ],
    },
  ],
  attention: [
    { kind: "escalated-open", severity: "warning", unit: "aipe", specialist: "Mike", journey: "j-na", detail: "escalated — waiting on the PE" },
  ],
  counts: { hired: 3, active: 1, delivered: 1, escalated: 1 },
};

function load() {
  applySnapshot(RAW, Date.parse("2026-08-25T12:05:00Z"));
}

test("route contract: the Floor is the landing route, ordered first", () => {
  expect(route.path).toBe("/");
  expect(route.nav.order).toBe(-1);
  expect(route.nav.badge).toBe("escalation");
});

test("the coordinator wizard is pinned with the journey and its spec approval", () => {
  load();
  const { container } = render(<FloorView />);
  const rail = container.querySelector(".floor-rail")!;
  expect(rail).not.toBeNull();
  // the journey id is shown in the wizard strip (it now also appears in each
  // decision card's WHERE line, so scope the assertion to the rail).
  expect(rail.querySelector(".wz-jid")?.textContent).toBe("j-na");
  // spec approval surfaced
  expect(rail.textContent).toContain("approved");
});

test("repos render as groups and specialists as accordions inside them", () => {
  load();
  const { container } = render(<FloorView />);
  expect(container.querySelector(".repo-group")).not.toBeNull();
  const rows = container.querySelectorAll(".spec-row");
  // Jesse (dispatched), Ana (delivered), Mike (escalated) are live rows; Sky (merged) folds into the green drawer
  const names = [...rows].map((r) => r.querySelector(".persona")?.textContent);
  expect(names).toContain("Jesse");
  expect(names).toContain("Ana");
  expect(names).toContain("Mike");
  expect(names).not.toContain("Sky");
  // the merged unit folded into a green drawer
  expect(container.querySelector(".green-drawer")).not.toBeNull();
});

test("the decision inbox surfaces a gated envelope AND an escalation", () => {
  load();
  const { container } = render(<FloorView />);
  const inbox = container.querySelector(".floor-inbox");
  expect(inbox).not.toBeNull();
  const kinds = [...inbox!.querySelectorAll(".ir-kind")].map((k) => k.textContent);
  expect(kinds.some((k) => /gated/i.test(k ?? ""))).toBe(true);
  expect(kinds.some((k) => /escalation/i.test(k ?? ""))).toBe(true);
});

test("a decision card shows the four answers with a real, copyable command", () => {
  load();
  const { container } = render(<FloorView />);
  const inbox = container.querySelector(".floor-inbox")!;
  // WHAT + WHY + DO labels are present
  expect(inbox.querySelector(".ic-what")).not.toBeNull();
  expect(inbox.textContent).toContain("Why");
  expect(inbox.textContent).toContain("Do");
  // an exact command the PE can copy (escalation → journey show), and a Copy button
  const cmd = [...inbox.querySelectorAll(".ic-cmd-text")].map((c) => c.textContent);
  expect(cmd.some((c) => /aipe journey show --journey j-na/.test(c ?? ""))).toBe(true);
  expect(inbox.querySelector(".ic-cmd-copy")).not.toBeNull();
});

test("the header 'need you' count equals the decision inbox count — no contradiction", () => {
  load();
  const { container } = render(<FloorView />);
  // header badge in the wizard strip
  const badge = container.querySelector(".wz-inbox-badge")!.textContent ?? "";
  const headerN = Number((badge.match(/\d+/) ?? ["0"])[0]);
  // the inbox's own count
  const inboxN = Number(container.querySelector(".floor-inbox .inbox-head .n")!.textContent);
  expect(headerN).toBe(inboxN);
  // both are the decisions (gated Jesse + escalation Mike), not the raw attention array
  expect(headerN).toBe(2);
});

test("the wizard body changes shape with the pinned dispatch's phase", () => {
  load();
  const { container } = render(<FloorView />);
  const rowFor = (name: string) => [...container.querySelectorAll(".spec-row")].find((r) => r.querySelector(".persona")?.textContent === name)!;

  // Pin the delivered unit → DELIVERED body with the PR + evidence
  fireEvent.click(rowFor("Ana"));
  let body = container.querySelector(".wz-body")!;
  expect(body.textContent).toContain("DELIVERED");
  expect(body.textContent).toContain("all green");

  // Pin the escalated unit → NEEDS YOUR DECISION body (distinct from delivered)
  fireEvent.click(rowFor("Mike"));
  body = container.querySelector(".wz-body")!;
  expect(body.textContent?.toUpperCase()).toContain("DECISION");
  expect(body.getAttribute("data-tone")).toBe("amber");

  // Pin the dispatched session unit → BOOTING body with the envelope + cost-index 64
  fireEvent.click(rowFor("Jesse"));
  body = container.querySelector(".wz-body")!;
  expect(body.textContent).toContain("index 64");
});

test("truthfulness: a session-mode unit with no live session shows PENDING, not fabricated activity", () => {
  load();
  const { container } = render(<FloorView />);
  const jesse = [...container.querySelectorAll(".spec-row")].find((r) => r.querySelector(".persona")?.textContent === "Jesse")!;
  fireEvent.click(jesse);
  const body = container.querySelector(".wz-body")!;
  expect(body.textContent).toContain("PENDING");
});
