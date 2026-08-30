// The decision inbox — the Floor's highest-value surface. It answers, for every
// pending item and in the PE's own framing, the four questions the spec demands:
// WHAT it is (plain language, never the machine code), WHY it appeared (this
// unit, this journey), WHAT TO DO (the concrete step + the exact command,
// copyable in one click — the console stays read-only and never runs it), and
// WHERE (repo, unit, branch, worktree, journey, PR).
//
// It is split in two: "need you" — decisions only the PE can unblock (that empty
// list IS the success state) — and "observations" — real findings the
// coordinator/dev/QA handle, shown apart so the PE is informed without being
// nagged to act on something they cannot. Everything derives from the snapshot,
// so a resolved item disappears on its own via SSE — the PE watches it shrink.
import { useState } from "preact/hooks";
import { decisions, observations, dispatches, pinnedDispatch, snapshot } from "../runtime/store";
import { t, interpolate } from "../runtime/i18n";
import { decisionAction } from "../runtime/floor";
import { CopyCmd } from "./CopyCmd";
import type { Dispatch } from "../runtime/store";
import type { DecisionItem } from "../runtime/floor";

function findDispatch(unit: string, journey: string, specialist: string): Dispatch | undefined {
  return dispatches.value.find((d) => {
    const u = d.package ? `${d.repo}/${d.package}` : String(d.repo);
    return u === unit && d.journey === journey && String(d.specialist).toLowerCase() === specialist.toLowerCase();
  });
}

// Plain-language name for each kind (never the machine token like
// `dependency-not-landed`). `blocked` is new — the coordinator-owes-an-answer state.
const KIND_LABEL: Record<string, string> = {
  "no-evidence": "floor_ik_noevidence",
  "failed-open": "floor_ik_failedopen",
  "dependency-not-landed": "floor_ik_dep",
  "dead-silent": "floor_ik_deadsilent",
  gated: "floor_ik_gated",
  escalation: "floor_ik_escalation",
  redirected: "floor_ik_redirected",
  blocked: "floor_ik_blocked",
  "qa-gap": "floor_ik_qagap",
};

function wtName(p?: string): string {
  return p ? p.split("/").pop() || p : "";
}

export function ActionRow({ item }: { item: DecisionItem }) {
  const d = findDispatch(item.unit, item.journey, item.specialist);
  const card = decisionAction(item, d, snapshot.value.workspaceDir);
  const on = !!d && pinnedDispatch.value === d;
  const w = card.where;
  return (
    <div class={`inbox-card ${item.section} ${item.severity}${on ? " on" : ""}`}>
      <button
        type="button"
        class="ic-head"
        onClick={() => { if (d) pinnedDispatch.value = pinnedDispatch.value === d ? null : d; }}
        title={t("fa_pin_hint")}
      >
        <span class="ir-kind">{t(KIND_LABEL[item.kind] ?? "floor_ik_generic")}</span>
        <span class="ir-unit">{item.unit}</span>
      </button>

      <div class="ic-what">{interpolate(t(card.whatKey), card.vars)}</div>

      <dl class="ic-answers">
        <dt>{t("fa_lbl_why")}</dt>
        <dd>{interpolate(t(card.whyKey), card.vars)}</dd>
        <dt>{t("fa_lbl_todo")}</dt>
        <dd>
          {interpolate(t(card.todoKey), card.vars)}
          <span class="ic-actor"> · {t("fa_lbl_actor")}: {t(card.actorKey)}</span>
        </dd>
      </dl>

      {card.command ? (
        <CopyCmd command={card.command} />
      ) : card.commandNoteKey ? (
        <div class="ic-cmdnote">{t(card.commandNoteKey)}</div>
      ) : null}

      <div class="ic-where">
        <span class="ic-w-lbl">{t("fa_lbl_where")}</span>
        <span class="ic-w">{w.unit}</span>
        {w.branch && <span class="ic-w mono">{w.branch}</span>}
        {w.worktree && <span class="ic-w mono" title={w.worktree}>…/{wtName(w.worktree)}</span>}
        <span class="ic-w mono">{w.journey}</span>
        {w.pr && (
          <a class="ic-w link" href={w.pr} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            PR ↗
          </a>
        )}
      </div>

      {item.inferred && <div class="ir-inferred">{t("floor_inferred")}</div>}
    </div>
  );
}

export function DecisionInbox({ collapsed }: { collapsed?: boolean } = {}) {
  const decs = decisions.value;
  const obs = observations.value;
  const running = dispatches.value.filter((d) => d.status === "dispatched").length;
  return (
    <aside class={`floor-inbox${collapsed ? " collapsed" : ""}`} aria-label={t("floor_inbox")}>
      <div class="inbox-head">
        <h2>{t("floor_inbox")}</h2>
        {/* The badge counts DECISIONS only — the same number as the header/FAB. */}
        <span class="n">{decs.length}</span>
      </div>

      <div class="inbox-sec-h">{t("fa_sec_decisions")}</div>
      {decs.length === 0 ? (
        <div class="inbox-empty">{interpolate(t("floor_inbox_empty"), { n: String(running) })}</div>
      ) : (
        decs.map((it, i) => <ActionRow key={`d|${it.kind}|${it.unit}|${it.journey}|${i}`} item={it} />)
      )}

      {obs.length > 0 && (
        <>
          <div class="inbox-sec-h obs">
            {t("fa_sec_observations")} <span class="n2">{obs.length}</span>
          </div>
          <div class="inbox-sec-hint">{t("fa_sec_obs_hint")}</div>
          {obs.map((it, i) => <ActionRow key={`o|${it.kind}|${it.unit}|${it.journey}|${i}`} item={it} />)}
        </>
      )}

      {/* Truthfulness: a session-grant can never be an actionable approve here. */}
      {(snapshot.value.sessions ?? []).length > 0 && (
        <div class="pending"><b>{t("floor_pending")}</b> — {t("floor_grant_pending")}</div>
      )}
    </aside>
  );
}
