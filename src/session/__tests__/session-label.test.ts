// Rule 3 — the session label the PE reads in `agentop session ls`. Specialist
// FIRST (what the eye scans for), then the journey (the task), then the project.
import { expect, test } from "bun:test";
import { sessionLabel } from "../cli";

test("implicit whole-repo package: <Specialist>-<journey>-<repo>", () => {
  expect(sessionLabel("aipe", "Jesse", "j-20260825-v2")).toBe("Jesse-j-20260825-v2-aipe");
});

test("monorepo package: the fqid LEAF is the project segment", () => {
  expect(sessionLabel("openvibes-embark/aipe-site", "Lawson", "j-20260825-55")).toBe("Lawson-j-20260825-55-aipe-site");
});

test("two specialists on the same package+journey differ only by the leading name", () => {
  const dev = sessionLabel("aipe", "Jesse", "j-20260825-v2");
  const qa = sessionLabel("aipe", "Mike", "j-20260825-v2");
  expect(dev).toBe("Jesse-j-20260825-v2-aipe");
  expect(qa).toBe("Mike-j-20260825-v2-aipe");
  expect(dev).not.toBe(qa);
});

test("case is preserved and a two-word name is hyphen-safed (not an @ idiom)", () => {
  expect(sessionLabel("embark", "Ana Paula", "j1")).toBe("Ana-Paula-j1-embark");
  expect(sessionLabel("embark", "Joaquim", "j1")).not.toContain("@");
});
