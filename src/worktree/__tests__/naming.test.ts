import { expect, test } from "bun:test";
import { deriveSpec, isValidJourneyId } from "../naming";

test("isValidJourneyId accepts slug-safe ids, rejects others", () => {
  expect(isValidJourneyId("j-20260705-a1")).toBe(true);
  expect(isValidJourneyId("abc")).toBe(true);
  expect(isValidJourneyId("has/slash")).toBe(false);
  expect(isValidJourneyId("has space")).toBe(false);
  expect(isValidJourneyId("-leading")).toBe(false);
  expect(isValidJourneyId("UPPER")).toBe(false);
  expect(isValidJourneyId("")).toBe(false);
});

test("deriveSpec builds branch and relPath from journey + specialist", () => {
  const spec = deriveSpec("embark", "j-20260705-a1", "Joaquim");
  expect(spec.slug).toBe("joaquim");
  expect(spec.branch).toBe("aipe/j-20260705-a1/joaquim");
  expect(spec.relPath).toBe(".worktrees/j-20260705-a1-joaquim");
});

test("deriveSpec slugifies multi-word / accented names", () => {
  const spec = deriveSpec("embark", "j1", "Ana Maria");
  expect(spec.slug).toBe("ana-maria");
  expect(spec.branch).toBe("aipe/j1/ana-maria");
  expect(spec.relPath).toBe(".worktrees/j1-ana-maria");
});

test("deriveSpec encodes a package into the branch/path, implicit stays unchanged", () => {
  const mono = deriveSpec("platform", "j1", "Ana", "core");
  expect(mono.branch).toBe("aipe/j1/core--ana");
  expect(mono.relPath).toBe(".worktrees/j1-core--ana");
  expect(mono.moduleSlug).toBe("core");

  const flat = deriveSpec("embark", "j1", "Ana", "embark"); // package === repo ⇒ implicit
  expect(flat.branch).toBe("aipe/j1/ana");
  expect(flat.moduleSlug).toBeNull();
});
