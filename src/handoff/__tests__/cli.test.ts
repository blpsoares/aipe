import { expect, test } from "bun:test";
import { renderCloneReport } from "../cli";

test("renderCloneReport formats OK lines with the url when present", () => {
  const lines = renderCloneReport([
    { name: "repo-a", status: "ok", path: "/tmp/out/repo-a", url: "git@github.com:org/repo-a.git" },
  ]);
  expect(lines).toEqual(["OK repo-a /tmp/out/repo-a (git@github.com:org/repo-a.git)"]);
});

test("renderCloneReport formats OK lines without a url", () => {
  const lines = renderCloneReport([{ name: "repo-c", status: "ok", path: "/home/pe/repo-c" }]);
  expect(lines).toEqual(["OK repo-c /home/pe/repo-c"]);
});

test("renderCloneReport formats ERROR lines with the message", () => {
  const lines = renderCloneReport([{ name: "repo-d", status: "error", message: "network error" }]);
  expect(lines).toEqual(["ERROR repo-d: network error"]);
});
