import { expect, test } from "bun:test";
import { renderReport } from "../cli";

test("renderReport formats each (repo, role) pair and the STATE line when done", () => {
  const lines = renderReport(
    [
      { repo: "embark", role: "dev-fullstack", status: "ok" },
      { repo: "embark", role: "qa", status: "ok" },
    ],
    "done",
  );
  expect(lines).toContain("OK embark dev-fullstack");
  expect(lines).toContain("OK embark qa");
  expect(lines.some((l) => l.startsWith("STATE generator=done"))).toBe(true);
});

test("renderReport lists missing pairs and marks pending", () => {
  const lines = renderReport(
    [
      { repo: "embark", role: "dev-fullstack", status: "ok" },
      { repo: "embark", role: "qa", status: "missing" },
    ],
    "pending",
  );
  expect(lines).toContain("MISSING embark qa");
  expect(lines.some((l) => l.startsWith("STATE generator=pending"))).toBe(true);
});
