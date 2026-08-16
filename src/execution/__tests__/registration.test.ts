import { expect, test } from "bun:test";
import { dispatch } from "../../cli";

async function capture(argv: string[]): Promise<{ code: number; out: string }> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try {
    const code = await dispatch(argv);
    return { code, out: lines.join("\n") };
  } finally {
    console.log = original;
  }
}

test("`aipe capabilities` is a known command", async () => {
  const { code, out } = await capture(["capabilities", "--help"]);
  expect(code).toBe(0);
  expect(out).toContain("what this machine can actually run");
});

test("`aipe execution` is a known command", async () => {
  const { code, out } = await capture(["execution", "--help"]);
  expect(code).toBe(0);
  expect(out).toContain("price and plan the ways a journey's units could be run");
});

test("an unknown subcommand of either does not exit 0", async () => {
  expect((await capture(["capabilities", "bogus"])).code).toBe(1);
  expect((await capture(["execution", "bogus"])).code).toBe(1);
});

test("the top-level help lists both, distinctly", async () => {
  const { out } = await capture(["--help"]);
  expect(out).toContain("  capabilities  ");
  expect(out).toContain("  execution     ");
});
