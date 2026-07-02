import { expect, test } from "bun:test";
import { renderReport } from "../cli";

test("renderReport formata cada repo e a linha de STATE", () => {
  const lines = renderReport(
    [
      { name: "embark", status: "cloned" },
      { name: "prontuario", status: "skipped", message: "já presente" },
      { name: "faturamento", status: "error", message: "Permission denied (publickey)" },
    ],
    "pending",
  );
  expect(lines).toContain("OK cloned embark");
  expect(lines).toContain("SKIP prontuario (já presente)");
  expect(lines).toContain("ERRO faturamento: Permission denied (publickey)");
  expect(lines.some((l) => l.startsWith("STATE workspace=pending"))).toBe(true);
});

test("renderReport marca done quando todos ok", () => {
  const lines = renderReport([{ name: "embark", status: "cloned" }], "done");
  expect(lines.some((l) => l.startsWith("STATE workspace=done"))).toBe(true);
});
