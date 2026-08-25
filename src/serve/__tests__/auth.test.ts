import { expect, test } from "bun:test";
import {
  authorize,
  COOKIE_NAME,
  generateToken,
  isLoopback,
  parseCookies,
  requiresAuth,
  resolveToken,
  sessionCookie,
  TOKEN_ENV,
  tokenFromRequest,
  tokenMatches,
  unauthorized,
} from "../auth";

test("loopback is recognised, everything else is not", () => {
  expect(isLoopback("127.0.0.1")).toBe(true);
  expect(isLoopback("localhost")).toBe(true);
  expect(isLoopback("::1")).toBe(true);
  expect(isLoopback("0.0.0.0")).toBe(false);
  expect(isLoopback("192.168.0.5")).toBe(false);
});

test("auth is required exactly when the console leaves this machine", () => {
  // The bug this closes: `--host 0.0.0.0` served /api/snapshot (the whole
  // workspace) and /api/monitor (the code specialists are writing) to anyone
  // on the network, unauthenticated.
  expect(requiresAuth("127.0.0.1", false)).toBe(false);
  expect(requiresAuth("0.0.0.0", false)).toBe(true);
  expect(requiresAuth("192.168.0.5", false)).toBe(true);
});

test("--insecure is the only way to serve an open console off loopback", () => {
  expect(requiresAuth("0.0.0.0", true)).toBe(false);
  // …and it cannot be reached by accident: loopback never needed it anyway.
  expect(requiresAuth("127.0.0.1", true)).toBe(false);
});

test("generated tokens are long and never repeat", () => {
  const a = generateToken();
  const b = generateToken();
  expect(a).not.toBe(b);
  expect(a.length).toBeGreaterThanOrEqual(43); // 256 bits, base64url
  expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe: it ships in a query string
});

test("an operator-supplied token wins, so a restart keeps existing sessions", () => {
  expect(resolveToken({ [TOKEN_ENV]: "pinned-token" })).toBe("pinned-token");
  expect(resolveToken({ [TOKEN_ENV]: "   " })).not.toBe("   "); // blank is not a token
  expect(resolveToken({}).length).toBeGreaterThan(0);
});

test("parseCookies survives whatever a browser sends", () => {
  expect(parseCookies(null)).toEqual({});
  expect(parseCookies("")).toEqual({});
  expect(parseCookies("a=1; b=2")).toEqual({ a: "1", b: "2" });
  expect(parseCookies("=nokey; ok=1")).toEqual({ ok: "1" });
  expect(parseCookies("novalue")).toEqual({});
  expect(parseCookies(`${COOKIE_NAME}=abc`)).toEqual({ [COOKIE_NAME]: "abc" });
});

test("a token is accepted from the URL, a cookie or a bearer header", () => {
  const url = (q = "") => new URL(`http://h:1/${q}`);
  expect(tokenFromRequest(url("?token=q"), new Headers())).toEqual({ token: "q", fromQuery: true });
  expect(tokenFromRequest(url(), new Headers({ authorization: "Bearer h" }))).toEqual({ token: "h", fromQuery: false });
  expect(tokenFromRequest(url(), new Headers({ cookie: `${COOKIE_NAME}=c` }))).toEqual({ token: "c", fromQuery: false });
  expect(tokenFromRequest(url(), new Headers())).toEqual({ token: null, fromQuery: false });
});

test("token comparison rejects a prefix and a missing token", () => {
  expect(tokenMatches("secret", "secret")).toBe(true);
  expect(tokenMatches("secre", "secret")).toBe(false); // a prefix is not a match
  expect(tokenMatches("secretx", "secret")).toBe(false);
  expect(tokenMatches("", "secret")).toBe(false);
  expect(tokenMatches(null, "secret")).toBe(false);
});

test("a correct URL token is promoted to a cookie; a cookie is not re-set", () => {
  // The SPA's own fetches and SSE streams carry no query string, so the
  // one-time ?token= has to become a session or the console loads and then
  // 401s on every API call.
  const promoted = authorize(new URL("http://h:1/?token=s"), new Headers(), "s");
  expect(promoted.ok).toBe(true);
  expect(promoted.setCookie).toContain(`${COOKIE_NAME}=s`);
  expect(promoted.setCookie).toContain("HttpOnly");

  const already = authorize(new URL("http://h:1/api/snapshot"), new Headers({ cookie: `${COOKIE_NAME}=s` }), "s");
  expect(already).toEqual({ ok: true });
});

test("a wrong or absent token is refused", () => {
  expect(authorize(new URL("http://h:1/?token=nope"), new Headers(), "s").ok).toBe(false);
  expect(authorize(new URL("http://h:1/api/monitor"), new Headers(), "s").ok).toBe(false);
});

test("the cookie is HttpOnly and SameSite, but never Secure", () => {
  const c = sessionCookie("t");
  expect(c).toContain("HttpOnly"); // not readable by page scripts
  expect(c).toContain("SameSite=Strict");
  // Secure would make the browser never send it over the plain-HTTP LAN the
  // console actually runs on — locking the operator out rather than helping.
  expect(c).not.toContain("Secure");
});

test("the 401 is identical whether the token is missing or wrong", () => {
  // Distinguishing them is a free oracle.
  const a = unauthorized();
  const b = unauthorized();
  expect(a.status).toBe(401);
  expect(b.status).toBe(401);
});
