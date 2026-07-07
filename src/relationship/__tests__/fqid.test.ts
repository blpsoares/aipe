import { expect, test } from "bun:test";
import { makeFqid, parseFqid, repoOf } from "../fqid";

test("makeFqid: no package → whole-repo fqid (== repo name)", () => {
  expect(makeFqid("embark")).toBe("embark");
  expect(makeFqid("embark", null)).toBe("embark");
  expect(makeFqid("embark", "")).toBe("embark");
  expect(makeFqid("embark", "  ")).toBe("embark");
});

test("makeFqid: package → repo/package", () => {
  expect(makeFqid("prontuario", "api")).toBe("prontuario/api");
  expect(makeFqid("prontuario", "apps/web")).toBe("prontuario/apps/web");
});

test("parseFqid: splits on the first slash only", () => {
  expect(parseFqid("embark")).toEqual({ repo: "embark", package: null });
  expect(parseFqid("prontuario/api")).toEqual({ repo: "prontuario", package: "api" });
  expect(parseFqid("prontuario/apps/web")).toEqual({ repo: "prontuario", package: "apps/web" });
});

test("repoOf returns the repo segment", () => {
  expect(repoOf("embark")).toBe("embark");
  expect(repoOf("prontuario/apps/web")).toBe("prontuario");
});

test("round-trip makeFqid ∘ parseFqid", () => {
  for (const [repo, mod] of [["a", null], ["a", "b"], ["a", "b/c"]] as const) {
    const parsed = parseFqid(makeFqid(repo, mod));
    expect(parsed.repo).toBe(repo);
    expect(parsed.package).toBe(mod);
  }
});
