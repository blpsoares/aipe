import { expect, test } from "bun:test";
import { foregroundArgs, spawnDetached, wantsBackground } from "../cli";

test("wantsBackground detects --background, -d and --detached", () => {
  expect(wantsBackground(["serve", "--background"])).toBe(true);
  expect(wantsBackground(["serve", "-d"])).toBe(true);
  expect(wantsBackground(["serve", "--detached"])).toBe(true);
  expect(wantsBackground(["serve", "--port", "4317"])).toBe(false);
});

test("foregroundArgs strips only the background flags", () => {
  expect(foregroundArgs(["serve", "--background", "--port", "4317"])).toEqual(["serve", "--port", "4317"]);
  expect(foregroundArgs(["serve", "-d", "--host", "127.0.0.1"])).toEqual(["serve", "--host", "127.0.0.1"]);
});

test("spawnDetached prints the child PID and a stop instruction", () => {
  const logs: string[] = [];
  const calls: string[][] = [];
  const pid = spawnDetached(
    ["serve", "--background", "--port", "0"],
    (l) => logs.push(l),
    (cmd) => {
      calls.push(cmd);
      return { pid: 4242, unref: () => {} };
    },
  );
  expect(pid).toBe(4242);
  // background flag stripped from the child argv
  expect(calls[0]!.some((a) => a === "--background")).toBe(false);
  expect(calls[0]!.some((a) => a === "serve")).toBe(true);
  expect(logs.join("\n")).toContain("PID 4242");
  expect(logs.join("\n")).toContain("kill 4242");
});
