import { expect, test } from "bun:test";
import { renderReport } from "../cli";

test("renderReport formats each repo and the STATE line when done", () => {
  const lines = renderReport(
    [
      { name: "embark", status: "ok" },
      { name: "prontuario", status: "ok" },
    ],
    "done",
  );
  expect(lines).toContain("OK embark");
  expect(lines).toContain("OK prontuario");
  expect(lines.some((l) => l.startsWith("STATE relationship=done"))).toBe(true);
});

test("renderReport lists missing repos and marks pending", () => {
  const lines = renderReport(
    [
      { name: "embark", status: "ok" },
      { name: "prontuario", status: "missing" },
    ],
    "pending",
  );
  expect(lines).toContain("MISSING prontuario");
  expect(lines.some((l) => l.startsWith("STATE relationship=pending"))).toBe(true);
});
