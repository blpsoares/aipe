import { expect, test } from "bun:test";
import { resolveRepoInput } from "../resolve";

test("https URL → name derived from the last path segment", () => {
  expect(resolveRepoInput("https://github.com/opvibes/embark")).toEqual({
    name: "embark",
    url: "https://github.com/opvibes/embark",
  });
});

test("https URL with .git suffix → suffix stripped from the name", () => {
  expect(resolveRepoInput("https://github.com/opvibes/embark.git")).toEqual({
    name: "embark",
    url: "https://github.com/opvibes/embark.git",
  });
});

test("ssh scp-like URL → name derived from the last segment", () => {
  expect(resolveRepoInput("git@github.com:opvibes/embark.git")).toEqual({
    name: "embark",
    url: "git@github.com:opvibes/embark.git",
  });
});

test("local path → name is the basename, no url", () => {
  expect(resolveRepoInput("/home/pe/projects/embark")).toEqual({
    name: "embark",
    localPath: "/home/pe/projects/embark",
  });
});

test("local path with trailing slash → basename still correct", () => {
  expect(resolveRepoInput("./projects/embark/")).toEqual({
    name: "embark",
    localPath: "./projects/embark/",
  });
});
