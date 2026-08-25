// The coordinator's wizard — pinned and always visible. Part 1 is a journey
// instrument strip that never swaps; Part 2 is a body that CHANGES SHAPE with
// the phase (that is what makes it a wizard, not a card). When a specialist is
// pinned, the body morphs to that dispatch's derived phase; otherwise it shows
// the journey's own resting body.
import { conn, floorJourney, pinnedDispatch, sessions } from "../runtime/store";
import { t } from "../runtime/i18n";
import {
  derivePhase,
  phaseTone,
  costIndexOf,
  hasEvidence,
  sessionFor,
  openWaveOf,
  deriveJourneyPhase,
  type Phase,
  type JourneyLike,
} from "../runtime/floor";
import { formatElapsed } from "../../present-time";
import type { Dispatch, AttentionItem } from "../runtime/store";
import { snapshot } from "../runtime/store";

// The dispatch's OWN journey (for its spec, elapsed and attention cross-ref) —
// which is not necessarily the journey pinned in the rail's Part-1 strip.
function journeyOfDispatch(d: Dispatch): JourneyLike | null {
  return ((snapshot.value.journeys ?? []) as JourneyLike[]).find((j) => j.id === d.journey) ?? null;
}

function elapsedOf(d: Dispatch, j: JourneyLike | null): number {
  const base = j?.updatedAt ? Date.parse(j.updatedAt) || 0 : 0;
  return base ? Date.now() - base : 0;
}

function phaseOf(d: Dispatch, j: JourneyLike | null): Phase {
  return derivePhase(d, {
    session: sessionFor(d, sessions.value),
    monConnDown: conn.value === "down",
    elapsedMs: elapsedOf(d, j),
  });
}

function CostChip({ d }: { d: Dispatch }) {
  const c = costIndexOf(d);
  if (c.value === null) return null;
  return (
    <span class={`env-chip cost${c.defaulted ? " defaulted" : ""}`} title={t("floor_cost_hint")}>
      index {c.value}
      <span style={{ opacity: 0.7 }}> {t("floor_coarse")}</span>
    </span>
  );
}

function Envelope({ d }: { d: Dispatch }) {
  const parts = [d.mode, d.intensity, d.harness, d.tier, d.model].filter((x): x is string => typeof x === "string" && x.length > 0);
  return (
    <div class="envelope">
      {parts.map((p) => (
        <span key={p} class="env-chip">{p}</span>
      ))}
      <CostChip d={d} />
    </div>
  );
}

function attentionFor(unit: string, journey: string): AttentionItem[] {
  return (snapshot.value.attention ?? []).filter((a) => a.unit === unit && a.journey === journey);
}

function wt(d: Dispatch): string {
  return typeof d.worktree === "string" ? d.worktree.split("/").pop() || d.worktree : "—";
}

function SessionNote({ d }: { d: Dispatch }) {
  const isSession = d.mode === "session" || !!d.sessionId;
  const harness = String(d.harness ?? "");
  if (isSession && (harness === "codex" || harness === "copilot")) {
    return <div class="pending"><b>{t("floor_pending")}</b> — {harness} {t("floor_not_containable")}</div>;
  }
  if (isSession && !sessionFor(d, sessions.value)) {
    return <div class="pending"><b>{t("floor_pending")}</b> — {t("floor_session_telemetry")}</div>;
  }
  return null;
}

// ── Per-phase bodies ─────────────────────────────────────────────────────────

function BodyDispatched({ d, j, eyebrow }: { d: Dispatch; j: JourneyLike | null; eyebrow: string }) {
  const spec = j?.spec;
  return (
    <>
      <div class="wz-eyebrow">{eyebrow} <span class="who">{d.specialist}</span></div>
      <div class="wz-grid">
        <div class="wz-field"><span class="lbl">{t("floor_envelope")}</span><Envelope d={d} /></div>
        <div class="wz-field"><span class="lbl">{t("floor_brief")}</span><span class="val mono">{spec ? `${spec.path} @v${spec.version}` : t("floor_no_spec")}</span></div>
        <div class="wz-field"><span class="lbl">{t("floor_worktree")}</span><span class="val mono">{wt(d)}</span></div>
        <div class="wz-field"><span class="lbl">{t("floor_branch")}</span><span class="val mono">{String(d.branch ?? "—")}</span></div>
        <div class="wz-field"><span class="lbl">{t("floor_elapsed")}</span><span class="val mono">{formatElapsed(elapsedOf(d, j))}</span></div>
      </div>
      <SessionNote d={d} />
    </>
  );
}

function BodyImplementing({ d, j }: { d: Dispatch; j: JourneyLike | null }) {
  const s = sessionFor(d, sessions.value);
  return (
    <>
      <div class="wz-eyebrow">{t("floor_ph_implementing")} <span class="who">{d.specialist}</span></div>
      <div class="wz-grid">
        <div class="wz-field"><span class="lbl">{t("floor_activity")}</span><span class="val">{s?.activity ? t("floor_working") : t("floor_live")}</span></div>
        <div class="wz-field"><span class="lbl">{t("floor_branch")}</span><span class="val mono">{String(d.branch ?? "—")}</span></div>
        <div class="wz-field"><span class="lbl">{t("floor_worktree")}</span><span class="val mono">{wt(d)}</span></div>
        <div class="wz-field"><span class="lbl">{t("floor_elapsed")}</span><span class="val mono">{formatElapsed(elapsedOf(d, j))}</span></div>
      </div>
      <SessionNote d={d} />
    </>
  );
}

function EvidenceBlock({ d }: { d: Dispatch }) {
  const ev = d.evidence as { by?: string; commands?: string[]; summary?: string; artifact?: string } | undefined;
  if (!ev) return null;
  return (
    <div class="wz-field">
      <span class="lbl">{t("floor_evidence")} · {ev.by}</span>
      {ev.commands && ev.commands.length > 0 && (
        <ul class="cmd-list">{ev.commands.map((c, i) => <li key={i}>{c}</li>)}</ul>
      )}
      {ev.summary && <div class="val" style={{ marginTop: "4px" }}>{ev.summary}</div>}
      {ev.artifact && <div class="val mono">{ev.artifact}</div>}
    </div>
  );
}

function BodyVerifying({ d }: { d: Dispatch }) {
  const has = hasEvidence(d);
  return (
    <>
      <div class="wz-eyebrow">{t("floor_ph_verifying")} <span class="who">{d.specialist}</span></div>
      {has ? <EvidenceBlock d={d} /> : <div class="val" style={{ color: "var(--ink-2)" }}>{t("floor_gathering")}</div>}
    </>
  );
}

function LedgerVerdict({ d, j }: { d: Dispatch; j: JourneyLike | null }) {
  const unit = d.package ? `${d.repo}/${d.package}` : String(d.repo);
  const atts = j ? attentionFor(unit, j.id) : [];
  const noEv = atts.find((a) => a.kind === "no-evidence");
  const notVer = atts.find((a) => a.kind === "delivered-not-verified");
  if (noEv) return <div class="verdict reject">{t("floor_reject")}: {noEv.detail}</div>;
  if (notVer) return <div class="verdict hold">{t("floor_hold")}: {notVer.detail}</div>;
  return <div class="verdict accept">{t("floor_accept")}</div>;
}

function BodyDelivered({ d, j }: { d: Dispatch; j: JourneyLike | null }) {
  return (
    <>
      <div class="wz-eyebrow">{t("floor_ph_delivered")} <span class="who">{d.specialist}</span></div>
      <div class="wz-grid">
        <div class="wz-field"><span class="lbl">{t("d_pr")}</span><span class="val mono">{typeof d.pr === "string" ? d.pr : t("none")}</span></div>
        {hasEvidence(d) && <EvidenceBlock d={d} />}
      </div>
      {!hasEvidence(d) && <div class="verdict reject">{t("floor_reject_noev")}</div>}
      <LedgerVerdict d={d} j={j} />
    </>
  );
}

const CRITERION: Record<string, string> = {
  "no-evidence": "floor_crit_noevidence",
  "failed-open": "floor_crit_failedopen",
  "merged-skipped-qa": "floor_crit_mergedqa",
  "dependency-not-landed": "floor_crit_dep",
  "delivered-not-verified": "floor_crit_notverified",
};

function BodyQaGate({ d, j }: { d: Dispatch; j: JourneyLike | null }) {
  const unit = d.package ? `${d.repo}/${d.package}` : String(d.repo);
  const findings = j ? attentionFor(unit, j.id) : [];
  return (
    <>
      <div class="wz-eyebrow">{t("floor_ph_qa")} <span class="who">{d.specialist}</span></div>
      {findings.length === 0 && <div class="val" style={{ color: "var(--ink-2)" }}>{t("floor_qa_reviewing")}</div>}
      {findings.map((f, i) => (
        <div class="finding" key={i}>
          <span class={`sev ${f.severity}`}>{f.severity === "critical" ? t("att_critical") : t("att_warning")}</span>
          <div class="fdet">
            <div>{f.detail}</div>
            <div class="maps">→ {t(CRITERION[f.kind] ?? "floor_crit_generic")}</div>
          </div>
        </div>
      ))}
      {typeof d.redispatchReason === "string" && <div class="val" style={{ marginTop: "6px", color: "var(--ink-3)" }}>↻ {d.redispatchReason}</div>}
    </>
  );
}

function BodyDecision({ d, j }: { d: Dispatch; j: JourneyLike | null }) {
  const redir = d.status === "redirected";
  const unit = d.package ? `${d.repo}/${d.package}` : String(d.repo);
  const att = j ? attentionFor(unit, j.id).find((a) => a.kind === "escalated-open") : undefined;
  return (
    <>
      <div class="wz-eyebrow">{t("floor_ph_decision")} <span class="who">{d.specialist}</span></div>
      <div class="wz-grid">
        <div class="wz-field">
          <span class="lbl">{redir ? t("floor_you_redirected") : t("floor_what_asked")}</span>
          <span class="val">{redir ? (typeof d.redirectReason === "string" ? d.redirectReason : t("floor_redirect_default")) : att?.detail ?? t("floor_escalated_default")}</span>
        </div>
        <div class="wz-field"><span class="lbl">{t("floor_who_decides")}</span><span class="val">{t("floor_the_pe")}</span></div>
        <div class="wz-field"><span class="lbl">{t("floor_since")}</span><span class="val mono">{formatElapsed(elapsedOf(d, j))}</span></div>
      </div>
      {redir && <div class="verdict hold">{t("floor_reconcile")} {j?.spec ? `v${j.spec.version}` : ""}</div>}
    </>
  );
}

function BodyDeadSilent({ d, j }: { d: Dispatch; j: JourneyLike | null }) {
  return (
    <>
      <div class="wz-eyebrow">{t("floor_ph_deadsilent")} <span class="who">{d.specialist}</span></div>
      <div class="wz-grid">
        <div class="wz-field"><span class="lbl">{t("floor_branch")}</span><span class="val mono">{String(d.branch ?? "—")}</span></div>
        <div class="wz-field"><span class="lbl">{t("floor_worktree")}</span><span class="val mono">{wt(d)}</span></div>
        <div class="wz-field"><span class="lbl">{t("floor_silence")}</span><span class="val mono">{formatElapsed(elapsedOf(d, j))}</span></div>
      </div>
      <div class="verdict hold">{t("floor_kill_is_yours")}</div>
      <div class="codeblock">{`git -C ${typeof d.worktree === "string" ? d.worktree : "<worktree>"} log --oneline -20`}</div>
    </>
  );
}

function BodyClosed({ d }: { d: Dispatch }) {
  return (
    <>
      <div class="wz-eyebrow">{t(d.status === "verified" ? "floor_ph_verified" : "floor_ph_closed")} <span class="who">{d.specialist}</span></div>
      <div class="wz-grid">
        <div class="wz-field"><span class="lbl">{t("d_status")}</span><span class="val">{String(d.status)}</span></div>
        <div class="wz-field"><span class="lbl">{t("d_pr")}</span><span class="val mono">{typeof d.pr === "string" ? d.pr : t("none")}</span></div>
        {hasEvidence(d) && <EvidenceBlock d={d} />}
      </div>
    </>
  );
}

function DispatchBody({ d, j }: { d: Dispatch; j: JourneyLike | null }) {
  const phase = phaseOf(d, j);
  switch (phase) {
    case "dispatched": return <BodyDispatched d={d} j={j} eyebrow={t("floor_ph_dispatched")} />;
    case "implementing": return <BodyImplementing d={d} j={j} />;
    case "verifying": return <BodyVerifying d={d} />;
    case "delivered": return <BodyDelivered d={d} j={j} />;
    case "qa-gate": return <BodyQaGate d={d} j={j} />;
    case "escalated":
    case "redirected": return <BodyDecision d={d} j={j} />;
    case "dead-silent": return <BodyDeadSilent d={d} j={j} />;
    case "verified":
    case "closed": return <BodyClosed d={d} />;
    default: return <BodyDispatched d={d} j={j} eyebrow={t("floor_ph_dispatched")} />;
  }
}

// The journey resting body (nothing pinned).
function JourneyBody({ j }: { j: JourneyLike }) {
  const jphase = deriveJourneyPhase(j);
  const wave = openWaveOf(j);
  if (jphase === "awaiting-spec-approval") {
    return (
      <>
        <div class="wz-eyebrow">{t("floor_jp_gate")}</div>
        <div class="verdict reject">{t("floor_gate_closed")} {j.spec?.path} v{j.spec?.version}</div>
      </>
    );
  }
  return (
    <>
      <div class="wz-eyebrow">{t(`floor_jp_${jphase.replace(/-/g, "_")}`)}</div>
      <div class="wz-grid">
        <div class="wz-field"><span class="lbl">{t("floor_open_wave")}</span>
          <div class="envelope">
            {wave.units.length === 0 && <span class="val" style={{ color: "var(--ink-3)" }}>{t("floor_no_wave")}</span>}
            {wave.units.map((u) => <span key={String(u.specialist)} class="env-chip">{u.package ? `${u.repo}/${u.package}` : u.repo} · {u.specialist}</span>)}
          </div>
        </div>
        <div class="wz-field"><span class="lbl">{t("floor_wave_cost")}</span>
          <span class="val mono">{wave.committedIndex}{wave.anyDefaulted ? " ~" : ""} <span class="wz-cost coarse">{t("floor_coarse")}</span></span>
        </div>
      </div>
    </>
  );
}

export function WizardRail() {
  const j = floorJourney.value;
  const pinned = pinnedDispatch.value;
  const wave = j ? openWaveOf(j) : { units: [], committedIndex: 0, anyDefaulted: false };
  const specApproved = j?.spec?.approved === true;
  // A pinned dispatch's body reads its OWN journey, not the rail's strip journey.
  const pinnedJourney = pinned ? journeyOfDispatch(pinned) : null;
  const bodyTone = pinned ? phaseTone(phaseOf(pinned, pinnedJourney)) : "slate";

  const inboxCount = (snapshot.value.attention ?? []).length;

  return (
    <section class="floor-rail" aria-label={t("floor_wizard")}>
      <div class="wz-strip">
        <div class="wz-demand">
          <span class="wz-jid">{j?.id ?? "—"}</span>
          {j ? `${(j.dispatches ?? []).length} ${t("floor_units")}` : t("floor_no_journey")}
        </div>
        {j?.spec && (
          <span class={`wz-pill ${specApproved ? "ok" : "bad"}`}>
            <span class="k">spec</span> v{j.spec.version} · {specApproved ? t("floor_approved") : t("floor_unapproved")}
          </span>
        )}
        {!j?.spec && j && <span class="wz-pill">{t("floor_no_spec")}</span>}
        <span class="wz-pill wz-cost">
          <span class="k">{t("floor_wave")}</span> {wave.units.length} · index {wave.committedIndex}
          <span class="coarse">{t("floor_coarse")}</span>
        </span>
        <span class="wz-fill" />
        <span class={`wz-inbox-badge${inboxCount === 0 ? " zero" : ""}`}>
          {inboxCount === 0 ? t("floor_inbox_clear") : `${inboxCount} ${t("floor_needs_you")}`}
        </span>
      </div>
      <div class="wz-body" data-tone={bodyTone}>
        {pinned ? <DispatchBody d={pinned} j={pinnedJourney} /> : j ? <JourneyBody j={j} /> : <div class="val">{t("floor_no_journey")}</div>}
      </div>
    </section>
  );
}
