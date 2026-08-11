import { expect, test } from "bun:test";
import { renderClaudeMd } from "../render";
import type { HandoffRepoReport, ManifestEntry } from "../types";
import type { GraphNode, MergedEdge } from "../../relationship/types";

const manifest: ManifestEntry[] = [
  { name: "repo-a", status: "ok", path: "/tmp/out/repo-a", url: "git@github.com:org/repo-a.git" },
  { name: "repo-b", status: "ok", path: "/tmp/out/repo-b", url: "git@github.com:org/repo-b.git" },
];

const reports: HandoffRepoReport[] = [
  { repo: "repo-a", purpose: "Payments API", stack: ["go"], relations: [] },
  {
    repo: "repo-b",
    purpose: "Frontend",
    stack: ["react", "typescript"],
    relations: [{ to: "repo-a", type: "consumes", detail: "calls the payments REST API", evidence: "src/api/client.ts:10" }],
  },
];

const nodes: GraphNode[] = [
  { fqid: "repo-a", repo: "repo-a", package: null, stack: ["go"] },
  { fqid: "repo-b", repo: "repo-b", package: null, stack: ["react", "typescript"] },
];

const edges: MergedEdge[] = [
  {
    from: "repo-b",
    to: "repo-a",
    type: "consumes",
    perspectives: [{ detail: "calls the payments REST API", evidence: "src/api/client.ts:10" }],
  },
];

test("renders setup, repo table, relations prose, and the embedded graph", () => {
  const md = renderClaudeMd({ contextName: "cliente-x", generatedAt: "2026-08-11", manifest, reports, nodes, edges });
  expect(md).toContain("# Context Handoff — cliente-x");
  expect(md).toContain("git clone git@github.com:org/repo-a.git");
  expect(md).toContain("git clone git@github.com:org/repo-b.git");
  expect(md).toContain("| repo-a | ./repo-a | Payments API | go |");
  expect(md).toContain("| repo-b | ./repo-b | Frontend | react, typescript |");
  expect(md).toContain("**repo-b → repo-a** (`consumes`)");
  expect(md).toContain("calls the payments REST API (`src/api/client.ts:10`)");
  expect(md).toContain("```yaml");
  expect(md).toContain("nodes:");
  expect(md).not.toContain("## Pending");
});

test("a repo with no known remote gets a manual-copy note instead of a clone line", () => {
  const localManifest: ManifestEntry[] = [{ name: "repo-c", status: "ok", path: "/home/pe/repo-c" }];
  const localReports: HandoffRepoReport[] = [{ repo: "repo-c", purpose: "Internal tool", stack: [], relations: [] }];
  const md = renderClaudeMd({
    contextName: "cliente-x",
    generatedAt: "2026-08-11",
    manifest: localManifest,
    reports: localReports,
    nodes: [{ fqid: "repo-c", repo: "repo-c", package: null, stack: [] }],
    edges: [],
  });
  expect(md).toContain("`repo-c` has no known remote — copy that folder in manually");
  expect(md).not.toContain("git clone");
});

test("failed clones and missing reports show up under ## Pending", () => {
  const md = renderClaudeMd({
    contextName: "cliente-x",
    generatedAt: "2026-08-11",
    manifest: [
      { name: "repo-a", status: "ok", path: "/tmp/out/repo-a", url: "git@github.com:org/repo-a.git" },
      { name: "repo-d", status: "error", message: "Permission denied (publickey)" },
    ],
    reports: [],
    nodes: [],
    edges: [],
  });
  expect(md).toContain("## Pending");
  expect(md).toContain("`repo-d`: Permission denied (publickey)");
  expect(md).toContain("`repo-a`: no agent report");
});

test("a purpose containing | or newlines is escaped so the table row stays well-formed", () => {
  const md = renderClaudeMd({
    contextName: "cliente-x",
    generatedAt: "2026-08-11",
    manifest: [{ name: "repo-a", status: "ok", path: "/tmp/out/repo-a", url: "git@github.com:org/repo-a.git" }],
    reports: [{ repo: "repo-a", purpose: "API | gateway\nand router", stack: ["go | 1.22"], relations: [] }],
    nodes: [{ fqid: "repo-a", repo: "repo-a", package: null, stack: [] }],
    edges: [],
  });
  const row = md.split("\n").find((l) => l.startsWith("| repo-a |"))!;
  expect(row).toBe("| repo-a | ./repo-a | API \\| gateway and router | go \\| 1.22 |");
  expect(row.split(/(?<!\\)\|/).length - 1).toBe(5);
});

test("no relations discovered → explicit empty-state line, no crash", () => {
  const md = renderClaudeMd({
    contextName: "cliente-x",
    generatedAt: "2026-08-11",
    manifest: [{ name: "repo-a", status: "ok", path: "/tmp/out/repo-a", url: "git@github.com:org/repo-a.git" }],
    reports: [{ repo: "repo-a", purpose: "Standalone tool", stack: [], relations: [] }],
    nodes: [{ fqid: "repo-a", repo: "repo-a", package: null, stack: [] }],
    edges: [],
  });
  expect(md).toContain("_No relations discovered._");
});
