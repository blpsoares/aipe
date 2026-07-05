// `aipe start` — interactive setup: pick the agent harness and install the
// AIPe integration into the *current project folder* (the workspace). The
// harness-specific file installation is performed by installHarness(); the
// rendering helpers below are pure and unit-tested.

export type HarnessStatus = "supported" | "coming-soon";

export interface Harness {
  id: string;
  label: string;
  status: HarnessStatus;
}

export const HARNESSES: Harness[] = [
  { id: "claude-code", label: "Claude Code", status: "supported" },
  { id: "codex", label: "OpenAI Codex CLI", status: "coming-soon" },
  { id: "gemini", label: "Gemini CLI", status: "coming-soon" },
  { id: "copilot", label: "GitHub Copilot", status: "coming-soon" },
  { id: "antigravity", label: "Antigravity", status: "coming-soon" },
  { id: "cursor", label: "Cursor", status: "coming-soon" },
  { id: "generic", label: "Generic / any other harness", status: "coming-soon" },
];

const WORKSPACE_RULE =
  "IMPORTANT: run this INSIDE your project folder. AIPe installs into the " +
  "workspace (this folder), never globally — every context is self-contained.";

export function renderIntro(): string[] {
  return ["", "aipe start — set up an AIPe workspace", "", WORKSPACE_RULE, ""];
}

export function renderHarnessList(): string[] {
  const lines = ["Choose your agent harness:"];
  HARNESSES.forEach((h, i) => {
    const tag = h.status === "supported" ? "" : "  (coming soon)";
    lines.push(`  ${i + 1}) ${h.label}${tag}`);
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
    "  aipe start --harness claude-code",
  ];
}
