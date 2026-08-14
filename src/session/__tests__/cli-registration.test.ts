import { expect, test } from "bun:test";
import { dispatch } from "../../cli";

test("`aipe session` is a known command", async () => {
  const original = console.log;
  const out: string[] = [];
  console.log = (...a: unknown[]) => { out.push(a.join(" ")); };
  try {
    const code = await dispatch(["session", "--help"]);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("dispatch specialists as real agentop sessions");
  } finally {
    console.log = original;
  }
});

test("the top-level help advertises it", async () => {
  const original = console.log;
  const out: string[] = [];
  console.log = (...a: unknown[]) => { out.push(a.join(" ")); };
  try {
    await dispatch(["--help"]);
    expect(out.join("\n")).toContain("session ");
  } finally {
    console.log = original;
  }
});
