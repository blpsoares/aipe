// Everything AIPe knows about invoking the agentop binary lives here.
import { MIN_AGENTOP_VERSION } from "./types";
import type { AgentopRunner, ProbeResult } from "./types";

export const realRunner: AgentopRunner = async (args) => {
  const proc = Bun.spawn(["agentop", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
};

// "1.10.2" > "1.9.0" — compare numerically per segment, never as strings.
function gte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export async function probe(runner: AgentopRunner = realRunner): Promise<ProbeResult> {
  let out: { code: number; stdout: string };
  try {
    out = await runner(["--version"]);
  } catch {
    return { present: false, version: null, ok: false, reason: "not-installed" };
  }
  if (out.code !== 0) {
    return { present: false, version: null, ok: false, reason: "not-installed" };
  }
  const m = out.stdout.match(/v?(\d+\.\d+\.\d+)/);
  if (!m) return { present: true, version: null, ok: false, reason: "unreadable-version" };
  const version = m[1]!;
  if (!gte(version, MIN_AGENTOP_VERSION)) {
    return {
      present: true,
      version,
      ok: false,
      reason: `below-minimum ${version} < ${MIN_AGENTOP_VERSION}`,
    };
  }
  return { present: true, version, ok: true };
}
