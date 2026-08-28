import { expect, test } from "bun:test";
import { resolveStatusPref } from "../pref";

test("absence of the field IS auto:false (backward compatibility, item 10 inv.1)", () => {
  expect(resolveStatusPref({ name: "blpsoares", coordinator: "Heisenberg" })).toEqual({ auto: false, format: "detailed" });
});

test("a non-object / undefined context degrades to the default, never throws", () => {
  expect(resolveStatusPref(undefined)).toEqual({ auto: false, format: "detailed" });
  expect(resolveStatusPref(null)).toEqual({ auto: false, format: "detailed" });
  expect(resolveStatusPref("nonsense")).toEqual({ auto: false, format: "detailed" });
});

test("auto:true + detailed is read as-is", () => {
  expect(resolveStatusPref({ statusUpdates: { auto: true, format: "detailed" } })).toEqual({ auto: true, format: "detailed" });
});

test("auto:true + compact is read as-is", () => {
  expect(resolveStatusPref({ statusUpdates: { auto: true, format: "compact" } })).toEqual({ auto: true, format: "compact" });
});

test("an invalid format on the READ path degrades to detailed (never crashes the hook, item 8)", () => {
  expect(resolveStatusPref({ statusUpdates: { auto: true, format: "fancy" } })).toEqual({ auto: true, format: "detailed" });
});

test("auto is strictly boolean-true; a truthy non-true value reads as false", () => {
  expect(resolveStatusPref({ statusUpdates: { auto: "yes", format: "compact" } }).auto).toBe(false);
});
