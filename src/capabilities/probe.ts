import type { BinaryProbe, ProbeRunner } from "./types";

export const realProbeRunner: ProbeRunner = async (bin, args) => {
  const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
};

// Adapter id -> the binary agentop would actually start. `claude-code` is the
// adapter's id; `claude` is the binary. They are different namespaces and
// conflating them is a bug this repo has already paid for once.
export const PROBED_HARNESSES: { id: string; bin: string }[] = [
  { id: "claude-code", bin: "claude" },
  { id: "gemini", bin: "gemini" },
  { id: "codex", bin: "codex" },
  { id: "copilot", bin: "copilot" },
];

export async function probeBinary(bin: string, runner: ProbeRunner): Promise<BinaryProbe> {
  let out: { code: number; stdout: string };
  try {
    out = await runner(bin, ["--version"]);
  } catch {
    return { bin, present: false, version: null };
  }
  if (out.code !== 0) return { bin, present: false, version: null };
  const m = out.stdout.match(/(\d+\.\d+\.\d+)/);
  return { bin, present: true, version: m ? m[1]! : null };
}

export async function probeAll(runner: ProbeRunner): Promise<BinaryProbe[]> {
  return Promise.all(PROBED_HARNESSES.map((h) => probeBinary(h.bin, runner)));
}
