import { test, expect } from "bun:test";
import { buildClient } from "../build-client";

test("buildClient produz um HTML com o bundle JS inline", async () => {
  const html = await buildClient({ minify: false });
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("<div id=\"app\">"); // mount point
  expect(html).not.toContain("<!--CLIENT-JS-->"); // placeholder foi substituído
  expect(html).toMatch(/<script[^>]*>[\s\S]*<\/script>/); // JS inline presente
});
