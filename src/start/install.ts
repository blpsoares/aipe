import { join } from "node:path";
import type { HarnessAdapter } from "../harness/types";

/**
 * Install the chosen harness's integration into the workspace and report what
 * landed. Generic over the adapter — it used to import `claudeCodeAdapter`
 * directly and announce ".claude", which meant picking any other harness still
 * printed the Claude Code path.
 */
export async function installHarnessIntegration(adapter: HarnessAdapter, workspace: string): Promise<number> {
  const report = await adapter.installIntegration(workspace);
  const where = report.files[0] ?? adapter.integrationPaths()[0] ?? ".";
  console.log(`aipe: installed the ${adapter.label} integration into ${join(workspace, where)}`);
  for (const note of report.notes) console.log(`aipe:  - ${note}`);
  return 0;
}
