import { expect, test } from "bun:test";
import { renderReport } from "../cli";

test("renderReport formats each repo and the STATE line", () => {
  const lines = renderReport(
    [
      { name: "embark", status: "cloned" },
      { name: "prontuario", status: "skipped", message: "already present" },
      { name: "faturamento", status: "error", message: "Permission denied (publickey)" },
    ],
    "pending",
  );
  expect(lines).toContain("OK cloned embark");
  expect(lines).toContain("SKIP prontuario (already present)");
  expect(lines).toContain("ERROR faturamento: Permission denied (publickey)");
  expect(lines.some((l) => l.startsWith("STATE workspace=pending"))).toBe(true);
});

test("renderReport marks done when everything is ok", () => {
  const lines = renderReport([{ name: "embark", status: "cloned" }], "done");
  expect(lines.some((l) => l.startsWith("STATE workspace=done"))).toBe(true);
});
