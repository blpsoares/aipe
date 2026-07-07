// Thin wrapper kept for the CLI + existing tests: the Claude Code integration
// now lives behind the HarnessAdapter seam (src/harness/claude-code.ts). This
// installs it and prints the user-facing summary.
import { join } from "node:path";
import { claudeCodeAdapter } from "../harness/claude-code";

export async function installClaudeCode(workspace: string): Promise<number> {
  const report = await claudeCodeAdapter.installIntegration(workspace);
  console.log(`aipe: installed the Claude Code integration into ${join(workspace, ".claude")}`);
  for (const note of report.notes) console.log(`aipe:  - ${note}`);
  return 0;
}
