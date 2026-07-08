import { expect, test } from "bun:test";
import { compareVersions, parseYesNo, pickLatestSemver, toSemver, updateNotice } from "../check";

test("parseYesNo defaults to yes on Enter and accepts y/yes/sim", () => {
  expect(parseYesNo("")).toBe(true); // Enter → default yes
  expect(parseYesNo("y")).toBe(true);
  expect(parseYesNo("Yes")).toBe(true);
  expect(parseYesNo("sim")).toBe(true);
  expect(parseYesNo("n")).toBe(false);
  expect(parseYesNo("no")).toBe(false);
  expect(parseYesNo("nope")).toBe(false);
});

test("compareVersions orders semver numerically", () => {
  expect(compareVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
  expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
  expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0); // numeric, not lexical
});

test("toSemver strips a leading v and rejects non-semver tags", () => {
  expect(toSemver("v0.2.0")).toBe("0.2.0");
  expect(toSemver("0.2.0")).toBe("0.2.0");
  expect(toSemver("latest")).toBeNull(); // rolling tag
  expect(toSemver("v1.2")).toBeNull();
});

test("pickLatestSemver ignores draft/prerelease/non-semver and picks the highest", () => {
  const latest = pickLatestSemver([
    { tag_name: "v0.1.0" },
    { tag_name: "latest" }, // rolling tag → ignored
    { tag_name: "v0.3.0", prerelease: true }, // ignored
    { tag_name: "v0.2.0" },
    { tag_name: "v0.2.5", draft: true }, // ignored
  ]);
  expect(latest).toBe("0.2.0");
});

test("pickLatestSemver returns null when nothing qualifies", () => {
  expect(pickLatestSemver([{ tag_name: "latest" }, { tag_name: "v9.9.9", draft: true }])).toBeNull();
});

test("updateNotice only fires when newer, and points at the openvibes install", () => {
  expect(updateNotice({ current: "0.2.0", latest: "0.2.0", hasUpdate: false })).toBeNull();
  const n = updateNotice({ current: "0.1.0", latest: "0.2.0", hasUpdate: true });
  expect(n).toContain("0.2.0");
  expect(n).toContain("aipe.openvibes.tech/cli");
});
