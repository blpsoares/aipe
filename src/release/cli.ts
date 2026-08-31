#!/usr/bin/env bun
// `aipe release promote` — the dev→main→release promotion as a command, not
// hand-craft (onda3 #94). RELEASING.md's path 4 already automates the mechanics
// (a bump job on dev, a release job on main); what was still manual — and what
// went wrong when the j-20260830-98 session died without delivering — was
// PROMOTING (opening+merging the dev→main PR) and, crucially, KNOWING it
// actually published. This command does both, and its success verdict is drawn
// ONLY from the published registry (the git tag + a live GitHub Release), never
// from the promotion action's own exit code. "Exit 0 de CI" proves the workflow
// ran; it does NOT prove v1.2.3 shipped, and conflating the two is the exact
// defect this command was cut to kill.
//
// Safe by default: with no `--execute` it is READ-ONLY — it reports the target
// version and whether that version is already published in the registry, writing
// nothing. Promotion is the coordinator's authority (RELEASING.md: "never a
// specialist"), so the writing path is gated behind `--execute`.
import { join } from "node:path";
import type { GitRun } from "./git";
import { checkLockfileClean, type LockfileCheck } from "./lockfile";
import { evaluatePublication, type PublicationVerdict, type PublishedFacts } from "./promote";
import { resolveSlugFromRemote } from "../forge/slug";

const realRun: GitRun = async (cmd) => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
};

// ── The injected surface ────────────────────────────────────────────────────
// Every effect the orchestration needs is a field here so the pure control flow
// (plan → refuse-on-drift → act → poll-verify) is tested offline with fakes, and
// proven for real by the default read-only mode against the live registry.
export interface PromoteDeps {
  resolveSlug: (repoAbs: string) => Promise<string | null>;
  readManifestVersion: (repoAbs: string, integration: string) => Promise<string | null>;
  queryPublished: (repoAbs: string, slug: string, tag: string) => Promise<PublishedFacts>;
  checkLock: (repoAbs: string) => Promise<LockfileCheck>;
  // Performs the promotion (open+merge the integration→release PR). Its `ok` is
  // necessary but NEVER sufficient for the published verdict — see the poll below.
  promoteAction: (repoAbs: string, slug: string, integration: string, release: string) => Promise<{ ok: boolean; detail: string }>;
  sleep: (ms: number) => Promise<void>;
}

export interface PromoteOpts {
  repoAbs: string;
  slug?: string;
  integration: string;
  release: string;
  execute: boolean;
  timeoutMs: number;
  pollMs: number;
  json: boolean;
  now?: () => number;
}

export interface PromoteResult {
  code: number;
  lines: string[];
}

// ── Real dependency implementations ─────────────────────────────────────────

// Resolve the forge slug from the repo's own remote, never from cwd inference —
// `gh` resolving the wrong repo (onda5 #76) is avoided by always passing an
// explicit owner/name derived here. The implementation is the shared forge
// resolver; re-exported so this module's callers and tests keep their import.
export { resolveSlugFromRemote };

// The target version is the one the bump job stamped onto the manifest at the
// tip of the integration branch — read from the ref, not from the working tree,
// so a worktree on some other branch cannot mis-report it. Prefer the
// remote-tracking ref (what a promotion actually carries), fall back to local.
export async function readManifestVersionAtRef(
  repoAbs: string,
  integration: string,
  run: GitRun = realRun,
): Promise<string | null> {
  for (const ref of [`origin/${integration}`, integration]) {
    for (const path of [".claude-plugin/plugin.json", "package.json"]) {
      const r = await run(["git", "-C", repoAbs, "show", `${ref}:${path}`]);
      if (r.code !== 0 || !r.stdout) continue;
      try {
        const v = JSON.parse(r.stdout).version;
        if (typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v)) return v;
      } catch {
        // not JSON we can read — try the next candidate
      }
    }
  }
  return null;
}

// Query the PUBLISHED registry for one version: the tag on the remote and the
// GitHub Release. Each fact is null when it could not be read — the honesty seam
// evaluatePublication depends on. Crucially, a `gh` "release not found" is the
// FACT that no release exists (false), while any other gh failure (auth,
// network, a repo-resolution error) is `null` (unverifiable), never false.
export async function queryPublishedRegistry(
  repoAbs: string,
  slug: string,
  tag: string,
  run: GitRun = realRun,
): Promise<PublishedFacts> {
  const tagR = await run(["git", "-C", repoAbs, "ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  const tagExists: boolean | null = tagR.code !== 0 ? null : tagR.stdout.trim().length > 0;

  const relR = await run(["gh", "release", "view", tag, "--repo", slug, "--json", "tagName,isDraft"]);
  let releaseExists: boolean | null;
  let releaseIsDraft: boolean | null = null;
  if (relR.code === 0) {
    releaseExists = true;
    try {
      releaseIsDraft = Boolean(JSON.parse(relR.stdout).isDraft);
    } catch {
      releaseIsDraft = null; // the release is there but we could not read its draft state
    }
  } else if (/release not found/i.test(relR.stderr)) {
    releaseExists = false; // a real fact: no release for this tag
  } else {
    releaseExists = null; // gh failed for another reason — unverifiable, not "absent"
  }
  return { tagExists, releaseExists, releaseIsDraft };
}

// The real promotion: ensure a PR from integration→release exists, then merge
// it. `gh pr merge` refuses unless the branch is mergeable (green required
// checks), so branch protection stays fully in force — this is not a bypass.
export async function promoteViaPr(
  repoAbs: string,
  slug: string,
  integration: string,
  release: string,
  run: GitRun = realRun,
): Promise<{ ok: boolean; detail: string }> {
  const title = `chore(release): promote ${integration} → ${release}`;
  // Create the PR; a "already exists" is fine — we merge whatever is open.
  const create = await run([
    "gh", "pr", "create", "--repo", slug, "--base", release, "--head", integration,
    "--title", title, "--body", "Automated promotion by `aipe release promote`.",
  ]);
  if (create.code !== 0 && !/already exists/i.test(create.stderr)) {
    return { ok: false, detail: `could not open the promotion PR: ${create.stderr || create.stdout}` };
  }
  const merge = await run(["gh", "pr", "merge", integration, "--repo", slug, "--merge", "--body", title]);
  if (merge.code !== 0) {
    return { ok: false, detail: `promotion PR did not merge: ${merge.stderr || merge.stdout}` };
  }
  return { ok: true, detail: "promotion PR merged into the release branch" };
}

export const realPromoteDeps: PromoteDeps = {
  resolveSlug: (repoAbs) => resolveSlugFromRemote(repoAbs),
  readManifestVersion: (repoAbs, integration) => readManifestVersionAtRef(repoAbs, integration),
  queryPublished: (repoAbs, slug, tag) => queryPublishedRegistry(repoAbs, slug, tag),
  checkLock: (repoAbs) => checkLockfileClean(repoAbs),
  promoteAction: (repoAbs, slug, integration, release) => promoteViaPr(repoAbs, slug, integration, release),
  sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
};

// ── The orchestration (pure control flow over injected effects) ──────────────

function render(o: {
  slug: string;
  version: string;
  integration: string;
  release: string;
  lock: LockfileCheck;
  verdict: PublicationVerdict;
  state: string;
  note: string;
}, json: boolean): string[] {
  if (json) {
    return [JSON.stringify({
      repo: o.slug,
      version: o.version,
      flow: `${o.integration}→${o.release}`,
      lockfile: o.lock.clean ? "clean" : "drift",
      publication: o.verdict.state,
      publicationReason: o.verdict.reason,
      state: o.state,
      note: o.note,
    })];
  }
  const lines = [
    `REPO=${o.slug}`,
    `VERSION=${o.version}`,
    `FLOW=${o.integration}→${o.release}`,
    `LOCKFILE=${o.lock.clean ? "clean" : "drift"} — ${o.lock.reason}`,
    `PUBLICATION=${o.verdict.state} — ${o.verdict.reason}`,
    `STATE=${o.state}`,
  ];
  if (o.note) lines.push(o.note);
  return lines;
}

export async function promote(deps: PromoteDeps, opts: PromoteOpts): Promise<PromoteResult> {
  const now = opts.now ?? (() => Date.now());

  const slug = opts.slug ?? (await deps.resolveSlug(opts.repoAbs));
  if (!slug) {
    return { code: 1, lines: ["ERROR repo: could not resolve the forge slug from origin — pass --repo <owner/name>"] };
  }
  const version = await deps.readManifestVersion(opts.repoAbs, opts.integration);
  if (!version) {
    return { code: 1, lines: [`ERROR version: could not read a semver version from the manifest at ${opts.integration}`] };
  }
  const tag = `v${version}`;
  const lock = await deps.checkLock(opts.repoAbs);

  // Where we stand in the registry, before touching anything.
  let facts = await deps.queryPublished(opts.repoAbs, slug, tag);
  let verdict = evaluatePublication(version, facts);

  // ── Read-only (default): report, write nothing ────────────────────────────
  if (!opts.execute) {
    const state =
      verdict.state === "published" ? "already-published"
      : verdict.state === "unverifiable" ? "unverifiable"
      : "would-promote";
    const note =
      verdict.state === "published"
        ? `${tag} is already published — nothing to promote.`
        : verdict.state === "unverifiable"
          ? `Could not establish ${tag} in the registry; not promoting on an unverifiable read.`
          : `Not yet published. Re-run with --execute to promote ${opts.integration}→${opts.release} and verify publication of ${tag}.`;
    return { code: 0, lines: render({ slug, version, integration: opts.integration, release: opts.release, lock, verdict, state, note }, opts.json) };
  }

  // ── Execute: refuse on a drifting lock (#86), then act, then VERIFY ────────
  if (!lock.clean) {
    return {
      code: 1,
      lines: render({ slug, version, integration: opts.integration, release: opts.release, lock, verdict, state: "refused-lockfile-drift", note: `ERROR lockfile: refusing to promote — ${lock.reason}` }, opts.json),
    };
  }
  if (verdict.state === "published") {
    return { code: 0, lines: render({ slug, version, integration: opts.integration, release: opts.release, lock, verdict, state: "already-published", note: `${tag} is already published — nothing to do.` }, opts.json) };
  }

  const action = await deps.promoteAction(opts.repoAbs, slug, opts.integration, opts.release);
  if (!action.ok) {
    return { code: 1, lines: render({ slug, version, integration: opts.integration, release: opts.release, lock, verdict, state: "promotion-failed", note: `ERROR promote: ${action.detail}` }, opts.json) };
  }

  // The action succeeded — but that establishes NOTHING about publication. Poll
  // the registry until it CONFIRMS the tag+live release, or the deadline passes.
  // Success below is gated on `verdict.state === "published"` and nothing else.
  const deadline = now() + opts.timeoutMs;
  for (;;) {
    facts = await deps.queryPublished(opts.repoAbs, slug, tag);
    verdict = evaluatePublication(version, facts);
    if (verdict.state === "published") break;
    if (now() + opts.pollMs > deadline) break;
    await deps.sleep(opts.pollMs);
  }

  if (verdict.state === "published") {
    return { code: 0, lines: render({ slug, version, integration: opts.integration, release: opts.release, lock, verdict, state: "published", note: `${action.detail}; verified ${tag} against the registry.` }, opts.json) };
  }
  // Honest failure: the action ran, but we could NOT establish publication.
  return {
    code: 1,
    lines: render({ slug, version, integration: opts.integration, release: opts.release, lock, verdict, state: "unestablished", note: `ERROR publication: ${action.detail}, but could not establish ${tag} against the registry within ${Math.round(opts.timeoutMs / 1000)}s — ${verdict.reason}` }, opts.json),
  };
}

// ── CLI entry ────────────────────────────────────────────────────────────────

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) return undefined;
  return v;
}

const HELP = [
  "aipe release — promotion & publication as a command",
  "",
  "Usage: aipe release promote [options]",
  "",
  "  Reads the version the bump job stamped on the integration branch and reports",
  "  whether it is actually PUBLISHED in the registry (git tag + live GitHub",
  "  Release). Read-only by default; --execute opens+merges the promotion PR and",
  "  then verifies publication against the registry — success is never inferred",
  "  from a workflow exit code.",
  "",
  "Options:",
  "  --path <dir>         Repo directory (default: cwd)",
  "  --repo <owner/name>  Forge slug (default: resolved from origin)",
  "  --integration <b>    Integration branch (default: dev)",
  "  --release <b>        Release branch (default: main)",
  "  --execute            Perform the promotion (default: read-only)",
  "  --timeout <seconds>  Max wait for publication when executing (default: 600)",
  "  --poll <seconds>     Registry poll interval when executing (default: 15)",
  "  --json               Machine-readable output",
].join("\n");

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === undefined || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(HELP);
    return sub === undefined ? 1 : 0;
  }
  if (sub !== "promote") {
    console.log(`ERROR subcommand: unknown "release ${sub}" — try "aipe release promote"`);
    return 1;
  }
  // `--help` on the subcommand shows help; it must never fall through and run
  // the command (a stray `release promote --execute --help` must not promote).
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(HELP);
    return 0;
  }

  const repoAbs = getFlag(rest, "--path") ?? process.cwd();
  const opts: PromoteOpts = {
    repoAbs: repoAbs.startsWith("/") ? repoAbs : join(process.cwd(), repoAbs),
    slug: getFlag(rest, "--repo"),
    integration: getFlag(rest, "--integration") ?? "dev",
    release: getFlag(rest, "--release") ?? "main",
    execute: rest.includes("--execute"),
    timeoutMs: Number(getFlag(rest, "--timeout") ?? "600") * 1000,
    pollMs: Number(getFlag(rest, "--poll") ?? "15") * 1000,
    json: rest.includes("--json"),
  };

  const result = await promote(realPromoteDeps, opts);
  for (const line of result.lines) console.log(line);
  return result.code;
}
