// Access control for a web console that is NOT bound to loopback.
//
// `aipe serve` binds 127.0.0.1 by default, and on loopback nothing here
// applies — the console is reachable only from the machine already running it.
// `--host 0.0.0.0` is the other case, and it was wide open: `/api/snapshot`
// returns the whole workspace (repos, personas, journeys) and `/api/monitor`
// streams the code specialists are writing, file content included. Anyone on
// the network could read both, unauthenticated. `isLoopback` existed and was
// tested for exactly this gate, and was never called.
//
// So: off loopback, every request carries a token. The token arrives once in
// the URL, and the server hands back an HttpOnly cookie so the SPA's own
// fetches and SSE streams (same origin) keep working without threading a
// secret through the client.
import { randomBytes, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "aipe_serve_token";
export const TOKEN_ENV = "AIPE_SERVE_TOKEN";

/** Pure: is this host reachable only from this machine? */
export function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * Pure: must this server authenticate requests?
 *
 * `insecure` is the deliberate escape hatch for someone who genuinely wants an
 * open console on a trusted network. It has to be typed explicitly; the danger
 * is never the default.
 */
export function requiresAuth(host: string, insecure: boolean): boolean {
  return !isLoopback(host) && !insecure;
}

/** A fresh 256-bit token, URL-safe. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The token this server will accept: the operator's own via the environment,
 * else a generated one. Reusing an operator-supplied token is what lets an
 * upgrade restart the console without invalidating everyone's cookie.
 */
export function resolveToken(env: Record<string, string | undefined> = process.env): string {
  const supplied = env[TOKEN_ENV]?.trim();
  return supplied && supplied.length > 0 ? supplied : generateToken();
}

/** Pure: parse a Cookie header into a map. Malformed pairs are skipped. */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Pure: the token a request presents, from any of the three places it can
 * legitimately be — the one-time URL, the cookie the server set in response to
 * it, or an explicit Authorization header (scripts, curl).
 */
export function tokenFromRequest(url: URL, headers: Headers): { token: string | null; fromQuery: boolean } {
  const q = url.searchParams.get("token");
  if (q) return { token: q, fromQuery: true };

  const auth = headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return { token: bearer, fromQuery: false };

  const cookie = parseCookies(headers.get("cookie"))[COOKIE_NAME];
  return { token: cookie ?? null, fromQuery: false };
}

/**
 * Pure: constant-time token comparison.
 *
 * `===` on a secret leaks its prefix through timing. The length check is
 * unavoidable (timingSafeEqual throws on a mismatch) and leaks only the
 * length, which is fixed and public anyway.
 */
export function tokenMatches(presented: string | null, expected: string): boolean {
  if (presented === null) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The Set-Cookie value that turns a one-time `?token=` into a session. */
export function sessionCookie(token: string): string {
  // No Secure: the console is plain HTTP on a LAN, and marking it Secure would
  // make the cookie silently never be sent, locking the operator out.
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`;
}

export const UNAUTHORIZED_BODY =
  "401 unauthorized — this aipe console is not bound to loopback, so it requires a token.\n" +
  "Open the URL printed by `aipe serve`, which carries ?token=…\n";

/** The 401 every unauthenticated request gets. Deliberately identical for a
 *  missing and a wrong token — distinguishing them is a free oracle. */
export function unauthorized(): Response {
  return new Response(UNAUTHORIZED_BODY, {
    status: 401,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export interface AuthDecision {
  ok: boolean;
  /** Set when the token arrived by URL and should be promoted to a cookie. */
  setCookie?: string;
}

/** The whole decision for one request. */
export function authorize(url: URL, headers: Headers, expected: string): AuthDecision {
  const { token, fromQuery } = tokenFromRequest(url, headers);
  if (!tokenMatches(token, expected)) return { ok: false };
  return fromQuery ? { ok: true, setCookie: sessionCookie(expected) } : { ok: true };
}
