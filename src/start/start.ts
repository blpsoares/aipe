// `aipe start` — interactive setup: pick the agent harness and install the
// AIPe integration into the *current project folder* (the workspace). The
// harness-specific file installation is performed by installHarness(); the
// rendering helpers below are pure and unit-tested.

import { getAdapter, hasAdapter } from "../harness/registry";
import { isContainable } from "../harness/types";

export type HarnessStatus = "supported" | "coming-soon";

export interface Harness {
  id: string;
  label: string;
  status: HarnessStatus;
}

// Every `supported` entry MUST have an adapter in src/harness/registry.ts —
// `getAdapter` falls back to Claude Code for an unknown id, so listing a
// harness here without one does not fail, it silently installs the WRONG
// integration. `src/start/__tests__/harness-parity.test.ts` enforces this.
//
// `coming-soon` here means exactly one thing: no adapter exists yet.
export const HARNESSES: Harness[] = [
  { id: "claude-code", label: "Claude Code", status: "supported" },
  { id: "codex", label: "OpenAI Codex CLI", status: "supported" },
  { id: "gemini", label: "Gemini CLI", status: "supported" },
  { id: "copilot", label: "GitHub Copilot CLI", status: "supported" },
  { id: "generic", label: "Generic / AGENTS.md harness (experimental)", status: "supported" },
  { id: "antigravity", label: "Antigravity", status: "coming-soon" },
  { id: "cursor", label: "Cursor", status: "coming-soon" },
];

const WORKSPACE_RULE =
  "IMPORTANT: run this INSIDE your project folder. AIPe installs into the " +
  "workspace (this folder), never globally — every context is self-contained.";

export function renderIntro(): string[] {
  return ["", "aipe start — set up an AIPe workspace", "", WORKSPACE_RULE, ""];
}

/**
 * Pure: the suffix shown next to a harness in the picker.
 *
 * Containment is surfaced HERE, at the moment of choice, because it is not a
 * cosmetic difference: a harness AIPe cannot contain is not eligible for
 * session-mode dispatch at all (see `isContainable`), and finding that out
 * after onboarding a whole context is far more expensive than reading it now.
 */
export function harnessTag(h: Harness, containable: boolean): string {
  if (h.status === "coming-soon") return "  (coming soon)";
  return containable ? "" : "  (no session-mode dispatch — cannot be contained)";
}

/** The real check, so both the interactive picker and this list annotate a
 *  harness the same way. A default of `() => true` silently dropped the
 *  containment note from the non-interactive surface. */
export function realIsContainable(id: string): boolean {
  return hasAdapter(id) && isContainable(getAdapter(id));
}

export function renderHarnessList(isContainableById: (id: string) => boolean = realIsContainable): string[] {
  const lines = ["Choose your agent harness:"];
  HARNESSES.forEach((h, i) => {
    lines.push(`  ${i + 1}) ${h.label}${harnessTag(h, isContainableById(h.id))}`);
  });
  return lines;
}

export function findHarness(id: string): Harness | undefined {
  return HARNESSES.find((h) => h.id === id);
}

/** Workspace name → folder-safe slug (lowercase, hyphenated). */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

export function renderNextSteps(folder: string): string[] {
  return [
    "",
    `✓ Created ${folder}/ with the AIPe integration inside.`,
    "",
    "Next:",
    `  cd ${folder}`,
    "  open this folder in your harness and just say hi —",
    "  the coordinator will ask for your repos and drive onboarding.",
  ];
}

export function renderNonInteractiveHelp(): string[] {
  return [
    ...renderIntro(),
    ...renderHarnessList(),
    "",
    "No interactive terminal detected. Re-run with an explicit choice, e.g.:",
    "  aipe start --harness gemini",
  ];
}
