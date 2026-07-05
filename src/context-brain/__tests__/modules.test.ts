import { expect, test } from "bun:test";
import { moduleFqid, resolveGroups, resolveModules } from "../modules";
import type { BrainFile } from "../types";

test("a repo with no modules resolves to one implicit module (backward compatible)", () => {
  const brain: BrainFile = {
    context: { name: "c", coordinator: "A" },
    repos: [{ name: "embark", url: "u", path: "./embark", stack: ["Bun"] }],
  };
  const mods = resolveModules(brain);
  expect(mods).toHaveLength(1);
  expect(mods[0]).toMatchObject({ repo: "embark", module: "embark", fqid: "embark", modulePath: ".", path: "./embark", implicit: true, group: "embark", stack: ["Bun"] });
});

test("a monorepo resolves one unit per module with fqid repo/module", () => {
  const brain: BrainFile = {
    context: { name: "c", coordinator: "A" },
    repos: [
      {
        name: "platform", url: "u", path: "./platform",
        modules: [
          { name: "core", path: "packages/core", stack: ["TypeScript"] },
          { name: "billing", path: "services/billing", stack: ["Go"], group: "backend" },
        ],
      },
    ],
  };
  const mods = resolveModules(brain);
  expect(mods.map((m) => m.fqid)).toEqual(["platform/core", "platform/billing"]);
  expect(mods[0]).toMatchObject({ repo: "platform", module: "core", path: "platform/packages/core", implicit: false, group: "core" });
  expect(mods[1]).toMatchObject({ group: "backend", stack: ["Go"] });
});

test("moduleFqid keeps the bare repo name for implicit modules", () => {
  expect(moduleFqid("embark")).toBe("embark");
  expect(moduleFqid("embark", "embark")).toBe("embark");
  expect(moduleFqid("platform", "core")).toBe("platform/core");
});

test("resolveGroups collapses modules sharing a group into one team", () => {
  const brain: BrainFile = {
    context: { name: "c", coordinator: "A" },
    repos: [
      {
        name: "platform", url: "u", path: "./platform",
        modules: [
          { name: "util-a", path: "packages/a", group: "shared" },
          { name: "util-b", path: "packages/b", group: "shared" },
          { name: "web", path: "apps/web" },
        ],
      },
    ],
  };
  const groups = resolveGroups(brain);
  expect(groups.map((g) => g.group).sort()).toEqual(["shared", "web"]);
  const shared = groups.find((g) => g.group === "shared");
  expect(shared?.modules.map((m) => m.module)).toEqual(["util-a", "util-b"]);
});
