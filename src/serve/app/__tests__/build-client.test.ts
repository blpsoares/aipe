import { test, expect } from "bun:test";
import { buildClient, injectClient } from "../build-client";

test("buildClient produz um HTML com o bundle JS inline", async () => {
  const html = await buildClient({ minify: false });
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("<div id=\"app\">"); // mount point
  expect(html).not.toContain("<!--CLIENT-JS-->"); // placeholder foi substituído
  expect(html).toMatch(/<script[^>]*>[\s\S]*<\/script>/); // JS inline presente
});

// RED before the fix: with a string replacement, a `$&` in the bundle means
// "insert the matched substring", re-injecting the marker `<!--CLIENT-JS-->`
// itself into the module — an illegal HTML-comment token that stops the whole
// SPA from parsing. The injection MUST treat css/js as literal text.
const ADVERSARIAL = 'var $=g;$&g.__e;a="$`";b="$\'";c="$$";d="$1";'; // every special $-pattern

test("injectClient inserts css/js verbatim and never re-injects a marker (the $& defect)", () => {
  const shell = '<style>/*<!--CLIENT-CSS-->*/</style><script type="module"><!--CLIENT-JS--></script>';
  const out = injectClient(shell, `.x{}${ADVERSARIAL}`, ADVERSARIAL);
  // The markers are gone — neither survives, and NEITHER is re-injected by a $-pattern.
  expect(out).not.toContain("<!--CLIENT-JS-->");
  expect(out).not.toContain("<!--CLIENT-CSS-->");
  // The content is inserted byte-for-byte, `$&`/`$$`/`$\``/`$'`/`$1` untouched.
  expect(out).toContain(ADVERSARIAL);
  expect(out).toContain("$&g.__e");
});

test("buildClient({minify:true}) — no marker leaks into the real production bundle and it mounts", async () => {
  // This test asserts a property of OUR injection over the real minified build:
  // no marker survives, and the page is mountable. It deliberately does NOT
  // assert that a `$&` sequence is present — whether the minifier emits `$&` is
  // a property of the bundler, not of this code, and varies across environments
  // (it did between a dev machine and the CI runner). The `$&` re-injection
  // logic is proven deterministically in the injectClient test above, where we
  // control the input. Here we only guard the production integration.
  const html = await buildClient({ minify: true });
  // The exact defect symptom: no marker may survive anywhere in the output.
  expect(html).not.toContain("<!--CLIENT-JS-->");
  expect(html).not.toContain("<!--CLIENT-CSS-->");
  // The mount point and an inline module script are present and non-trivial.
  expect(html).toContain('<div id="app">');
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  expect(script).not.toBeNull();
  const body = script![1]!;
  expect(body.length).toBeGreaterThan(1000);
  // A re-injected marker is the ONLY way an HTML-comment token enters the
  // module, so its absence proves the module parses (no "HTML comments are not
  // allowed in modules" SyntaxError).
  expect(body).not.toContain("<!--CLIENT");
});
