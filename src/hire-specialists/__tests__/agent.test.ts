import { expect, test } from "bun:test";
import { extractBody, frontmatterName, renderAgentMd } from "../agent";

test("renderAgentMd uses the real display name as the frontmatter name", () => {
  const md = renderAgentMd({ name: "Brand", role: "dev-fullstack", repo: "aipe", stack: ["TypeScript"], body: "I am Brand." });
  expect(md).toContain("name: Brand");
  expect(md).toContain('subagent_type "brand"');
  expect(md).toContain("Fullstack specialist for the aipe repo (TypeScript)");
  expect(md.trimEnd().endsWith("I am Brand.")).toBe(true);
});

test("renderAgentMd labels the QA role and unknown stack", () => {
  const md = renderAgentMd({ name: "Gnar", role: "qa", repo: "embark", stack: [], body: "x" });
  expect(md).toContain("name: Gnar");
  expect(md).toContain("QA specialist for the embark repo (unknown stack)");
});

test("extractBody strips a YAML frontmatter block", () => {
  expect(extractBody("---\nname: brand\ndescription: d\n---\n\nHello body.\n")).toBe("Hello body.");
  expect(extractBody("no frontmatter here")).toBe("no frontmatter here");
});

test("frontmatterName reads the name field, or null when absent", () => {
  expect(frontmatterName("---\nname: brand\n---\nbody")).toBe("brand");
  expect(frontmatterName("no frontmatter")).toBe(null);
});
