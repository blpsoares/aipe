import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FLOW_SKILLS } from "./skills";
import type { HarnessAdapter, InstallReport, PersonaMeta, StartupDelivery } from "./types";

const AGENTS_HEADER = `# AIPe — coordinator instructions (generic harness)

This workspace is driven by **AIPe**. At the start of every session, run:

    aipe session-context --workspace .

and follow the \`additionalContext\` it prints — that is your live coordinator
awareness (which onboarding step is next, or, once onboarded, that you ARE the
coordinator and should run the operate flow on the PE's demands).

The flows below are the coordinator's procedures. They are also saved under
\`.aipe/flows/\` for reference. Every deterministic step is a subcommand of the
on-PATH \`aipe\` binary — never hand-edit the files it owns.

## Flows

`;

// A file-based / AGENTS.md harness: a bootstrap AGENTS.md + the flow texts under
// .aipe/flows/, personas as plain markdown docs, MCP via the shared .mcp.json.
// NOTE: this adapter is a working demonstrator of the HarnessAdapter seam; its
// end-to-end behavior inside a real non-Claude harness has NOT been validated in
// a live session (see docs/dossie/11-harness-adapters.md).
export const genericAdapter: HarnessAdapter = {
  id: "generic",
  label: "Generic / AGENTS.md harness",

  async installIntegration(workspaceDir: string): Promise<InstallReport> {
    const flowsDir = join(workspaceDir, ".aipe", "flows");
    await mkdir(flowsDir, { recursive: true });

    const names = Object.keys(FLOW_SKILLS);
    const agentsMd = AGENTS_HEADER + names.map((n) => `- \`${n}\` — see \`.aipe/flows/${n}.md\``).join("\n") + "\n";
    await writeFile(join(workspaceDir, "AGENTS.md"), agentsMd, "utf8");

    for (const [name, body] of Object.entries(FLOW_SKILLS)) {
      await writeFile(join(flowsDir, `${name}.md`), body, "utf8");
    }

    return {
      files: ["AGENTS.md", `.aipe/flows/ (${names.length} flows)`],
      notes: [
        "AGENTS.md bootstrap → run `aipe session-context` each session",
        `${names.length} flows written under .aipe/flows/`,
        "EXPERIMENTAL: not yet validated in a live non-Claude session",
      ],
    };
  },

  startupDelivery(awareness: string): StartupDelivery {
    // File-based harnesses read a static file; embed the (live-computed) awareness.
    const content = `${AGENTS_HEADER.split("## Flows")[0]}\n---\n\n${awareness}\n`;
    return { mode: "file", path: "AGENTS.md", content };
  },

  personaTarget(slug: string): { relDir: string; filename: string } {
    return { relDir: ".aipe-personas", filename: `${slug}.md` };
  },

  wrapPersona(body: string, meta: PersonaMeta): string {
    const stackLabel = meta.stack.length > 0 ? meta.stack.join(", ") : "unknown stack";
    const scope = meta.module ? `${meta.repo}/${meta.module}` : meta.repo;
    const role = meta.role === "qa" ? "QA specialist" : "Fullstack specialist";
    return `# ${meta.slug}\n\n> ${role} for the ${scope} ${meta.module ? "module" : "repo"} (${stackLabel}).\n\n${body.trim()}\n`;
  },

  mcpConfigPath(scope: "workspace" | "repo", repo?: string): string {
    return scope === "repo" && repo ? join(repo, ".mcp.json") : ".mcp.json";
  },

  // A generic harness may drive any model; it has no fixed tier→id map, so the
  // harness decides. The tier's policy gates (authorization/volume) still apply.
  resolveModel(): { id: string; label: string } | null {
    return null;
  },
};
