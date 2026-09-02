// The three tables of `aipe status` (issue #109), in the PE's own vocabulary.
//
// Why this file exists at all: the tables the PE had been reading were built BY
// HAND, in the conversation, by whoever was answering him — the real command
// emitted something else entirely. He found out when another person ran
// `aipe status` on the same version and got a different thing. A table assembled
// by the person answering carries that person's errors, which is exactly how a
// waiting time got typed as "~1h", then "~1h30", for something 23 minutes old.
//
// So the rule this file is written to: **the command does not estimate — either
// it knows, or it says it does not know.** Every cell is a recorded fact or an
// explicit absence. There is no cell computed from an impression.
//
// His acceptance, verbatim: a human who has never heard the word "dispatch"
// opens `aipe status` and knows, without asking, who is doing what and where it
// stands. If it needs a translator, it is not done.
import type { DispatchStatus } from "../journey/types";
import type { PublishState } from "../release/types";
import type { UnitRow, WaitingItem } from "./types";

// ── the glossary ─────────────────────────────────────────────────────────────
// The PE's words, not the ledger's. `dispatched` is a state machine's noun;
// "Designado" is what a person says. The console (serve/app/runtime/i18n.ts)
// carries the same vocabulary for the same reason — kept in step by
// glossary.test.ts, which reads that file rather than importing it, so the CLI
// never pulls the browser bundle in.
const GLOSSARY: Record<DispatchStatus, string> = {
  dispatched: "Designado",
  delivered: "Entregue",
  verified: "Aprovado",
  merged: "Integrado",
  failed: "Reprovado",
  escalated: "Escalado",
  blocked: "Bloqueado",
  abandoned: "Abandonado",
  redirected: "Redirecionado",
  removed: "Removido",
  // Ended well, without a verdict of its own: the unit landed, or another
  // journey took the work over. Not "abandonado" — that word was what a
  // SUCCESS had to be filed under before this state existed.
  closed: "Encerrado",
};

export function statusWord(s: DispatchStatus): string {
  return GLOSSARY[s] ?? s;
}

// The status cell. "Integrado" answers "was it merged?"; it does NOT answer "did
// it reach me?", and reading the first as the second is exactly #94. So a merged
// task that is not published says both, in one cell, and an unresolved
// publication state says it is unresolved rather than staying quiet.
export function taskStatusCell(s: DispatchStatus, publish: PublishState | null): string {
  const word = statusWord(s);
  if (s !== "merged" || publish === null) return word;
  if (publish === "published") return word;
  // `unknown` means the repo's publish method could not be ESTABLISHED — the
  // release resolver says so in its own `reason`. Printing "não publicado" for
  // it asserts a fact nobody checked, in the exact voice of a fact that was:
  // the reader cannot tell "we looked and it is not published" from "we could
  // not tell". A third word, because there are three states.
  if (publish === "unknown") return `${word}·publicação não estabelecida`;
  return `${word}·não publicado`;
}

// How far along a task is. Same ordering the ledger uses to judge a unit, so the
// table and the gate can never disagree about which row speaks for the task.
const RANK: Record<DispatchStatus, number> = {
  removed: 0, dispatched: 1, failed: 2, escalated: 2, redirected: 2,
  blocked: 2, abandoned: 2, closed: 2, delivered: 3, verified: 4, merged: 5,
};

export interface TaskLine {
  n: number;
  sessionId: string | null;
  taskId: string;
  specialist: string;
  repo: string;
  package: string | null;
  branch: string;
  base: string | null;
  model: string | null;
  effort: string | null;
  title: string | null;
  description: string | null;
  status: DispatchStatus;
  // Whether a merged task actually reached the user. Carried into the STATUS
  // cell because "Integrado" alone is what produced #94: work merged into `dev`
  // read as done when it was not published. null on anything not merged — the
  // publication question does not exist before then.
  publishState: PublishState | null;
}

// ONE LINE PER TASK. The dev and the QA of the same task are two ledger rows on
// purpose — they are two people — but rendering them as two lines made a single
// rejection look like two, and the PE asked "why so many rejections?" while
// looking at exactly one. Grouped by (repo, package, task), which is the same
// identity the QA gate pairs a verdict with.
//
// Two different rows answer two different questions, and conflating them is what
// a single "representative row" would do:
//   • WHO and WHERE (specialist, branch, destination) — the row doing the work.
//     A QA row's branch is its own worktree, not where the code lives.
//   • HOW FAR ALONG — the furthest state any row of the task reached. A task
//     whose QA has approved is Aprovado, and it is not the dev's row that says so.
export function taskLines(units: UnitRow[]): TaskLine[] {
  const groups = new Map<string, UnitRow[]>();
  for (const u of units) {
    // JSON.stringify of the tuple, not a delimiter: a separator character can
    // collide with a repo/package/task name, and the one used here first was a
    // RAW NUL byte, which made this whole source file BINARY to git — it could
    // not be diffed or reviewed, and it shipped that way in v1.18.1. There is no
    // separator to get wrong now, and nothing unprintable in the source.
    const key = JSON.stringify([u.repo, u.package ?? null, u.task ?? null]);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(u);
  }

  const lines: TaskLine[] = [];
  let n = 0;
  for (const rows of groups.values()) {
    const furthest = rows.reduce((a, b) => ((RANK[b.status] ?? 0) > (RANK[a.status] ?? 0) ? b : a));

    // The BUILDER's row. `role` comes from personas.yaml and can be null — and
    // when it is, falling back to `furthest` silently promoted the QA row, whose
    // `base`/`title`/`description` are usually empty. The line then printed
    // "não registrado" over data that WAS recorded, on the dev's row, which is
    // the exact inverse of what this table promises.
    //
    // So the fallback prefers a row that is NOT a QA verdict, by the evidence's
    // own authorship — a fact on the ledger, unlike a role a roster may not
    // carry. Only if every row is a QA verdict does it fall through to
    // `furthest`, and then there genuinely is no builder to name.
    const filedQaVerdict = (r: UnitRow): boolean =>
      (r.status === "verified" || r.status === "failed") && r.hasEvidence && r.role !== null && /qa/i.test(r.role);
    const builder =
      rows.find((r) => r.role !== null && !/qa/i.test(r.role)) ??
      rows.find((r) => !filedQaVerdict(r) && r.status !== "verified") ??
      furthest;

    // A REJECTION is not "less far along" — it is a verdict ON the delivery, and
    // it is newer than it. Ranking `delivered` (3) above `failed` (2) made a
    // rejected task render as "Entregue" while table 3 said "nada esperando
    // você": the commit that introduced this table existed because rejections
    // were being MIScounted, and it left them UNcounted. A `failed` for the
    // CURRENT round speaks for the task; a re-delivery opens the next round
    // (ledger.ts bumps it), which is what lets the rejection stop speaking.
    const round = Math.max(1, ...rows.map((r) => r.round ?? 1));
    const rejected = rows.find((r) => r.status === "failed" && (r.round ?? 1) >= round);
    const speaking = rejected ?? furthest;

    n += 1;
    lines.push({
      n,
      // Every column below comes from the BUILDER's own row. There is no
      // cross-row fallback: borrowing the QA's `base` or `title` printed, on a
      // line naming the dev, a destination the dev never recorded — a fact
      // attributed to the wrong person reads exactly like a fact.
      sessionId: builder.sessionId,
      taskId: builder.task ?? "—",
      specialist: builder.specialist,
      repo: builder.repo,
      package: builder.package,
      branch: builder.branch,
      base: builder.base,
      model: builder.model,
      // "reasoning" alone does not say how much effort — the PE said so. Tier is
      // its own column, and `ultracode` is the louder signal when present.
      effort: builder.intensity === "ultracode" ? "ultracode" : builder.tier,
      title: builder.title,
      description: builder.description,
      status: speaking.status,
      publishState: speaking.publishState,
    });
  }
  return lines;
}

// Absence, rendered as absence. Never an empty cell (which reads as "nothing to
// say") and never a plausible-looking default (which reads as a fact).
export const UNRECORDED = "não registrado";

export function cell(v: string | null | undefined): string {
  return v && v.trim() !== "" ? v : UNRECORDED;
}

// A monorepo's package is information; a flat repo's is noise. `—` says "this
// repo has no packages", which is different from "not recorded".
export function packageCell(pkg: string | null): string {
  return pkg ?? "—";
}

// ABSOLUTE time, never a duration. A duration is a subtraction someone can get
// wrong, and someone did — twice, in the same column, for the same item. The
// reader does the arithmetic themselves if they want it; the command only ever
// reports the instant it recorded.
export function whenCell(iso: string | null): string {
  if (!iso) return UNRECORDED;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return UNRECORDED;
  const pad = (x: number): string => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── table 3: what is waiting on the PE ───────────────────────────────────────
// The request, in the language of someone who did not build the thing. The
// ledger's own word for the state ("redirected", "no-evidence") describes the
// MACHINE's situation; this column has to describe the PERSON's.
const ASK: Record<WaitingItem["kind"], string> = {
  escalated: "decidir algo que atravessa mais de um repositório",
  gated: "autorizar o modelo/tier escolhido para esta unidade",
  redirected: "confirmar a nova direção que você pediu ao vivo",
  blocked: "responder o que o especialista precisa para continuar",
  abandoned: "dizer o que fazer com uma sessão que terminou sem veredicto",
  "no-evidence": "olhar uma entrega registrada sem prova anexada",
  "finished-unprocessed": "olhar uma sessão que terminou sem registrar a entrega",
};

export function askCell(w: WaitingItem): string {
  const ask = ASK[w.kind] ?? w.kind;
  // The recorded reason is the specialist's own words and beats any phrasing
  // here — it is why the row exists. The generic ask is the fallback for the
  // kinds the ledger records no reason for.
  return w.detail && w.detail.trim() !== "" ? `${ask} — ${w.detail}` : ask;
}
