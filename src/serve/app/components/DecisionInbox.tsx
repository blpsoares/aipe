// The decision inbox — one place for everything waiting on the PE, ranked
// critical-first. The empty list IS the success state. Each row pins its
// dispatch into the wizard rail so the decision and its full context arrive in
// one glance, no navigation. Highest-value surface on the Floor.
import { decisionInbox, dispatches, pinnedDispatch, snapshot } from "../runtime/store";
import { t } from "../runtime/i18n";
import type { Dispatch } from "../runtime/store";
import type { DecisionItem } from "../runtime/floor";

function findDispatch(unit: string, journey: string, specialist: string): Dispatch | undefined {
  return dispatches.value.find((d) => {
    const u = d.package ? `${d.repo}/${d.package}` : String(d.repo);
    return u === unit && d.journey === journey && String(d.specialist).toLowerCase() === specialist.toLowerCase();
  });
}

const KIND_LABEL: Record<string, string> = {
  "no-evidence": "floor_ik_noevidence",
  "failed-open": "floor_ik_failedopen",
  "dependency-not-landed": "floor_ik_dep",
  "dead-silent": "floor_ik_deadsilent",
  gated: "floor_ik_gated",
  escalation: "floor_ik_escalation",
  redirected: "floor_ik_redirected",
  "qa-gap": "floor_ik_qagap",
};

function InboxRow({ item }: { item: DecisionItem }) {
  const d = findDispatch(item.unit, item.journey, item.specialist);
  const on = !!d && pinnedDispatch.value === d;
  return (
    <button
      type="button"
      class={`inbox-row ${item.severity}${on ? " on" : ""}`}
      onClick={() => { if (d) pinnedDispatch.value = pinnedDispatch.value === d ? null : d; }}
      title={item.detail}
    >
      <div class="ir-top">
        <span class="ir-kind">{t(KIND_LABEL[item.kind] ?? "floor_ik_generic")}</span>
        <span class="ir-unit">{item.unit}</span>
      </div>
      <div class="ir-detail">{item.specialist !== "—" ? `${item.specialist} · ` : ""}{item.detail}</div>
      {item.inferred && <div class="ir-inferred">{t("floor_inferred")}</div>}
    </button>
  );
}

export function DecisionInbox({ collapsed }: { collapsed?: boolean } = {}) {
  const items = decisionInbox.value;
  const running = dispatches.value.filter((d) => d.status === "dispatched").length;
  return (
    <aside class={`floor-inbox${collapsed ? " collapsed" : ""}`} aria-label={t("floor_inbox")}>
      <div class="inbox-head">
        <h2>{t("floor_inbox")}</h2>
        <span class="n">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div class="inbox-empty">{t("floor_inbox_empty").replace("{n}", String(running))}</div>
      ) : (
        items.map((it, i) => <InboxRow key={`${it.kind}|${it.unit}|${it.journey}|${i}`} item={it} />)
      )}
      {/* Truthfulness: session-grant can never be an actionable approve here. */}
      {(snapshot.value.sessions ?? []).length > 0 && (
        <div class="pending"><b>{t("floor_pending")}</b> — {t("floor_grant_pending")}</div>
      )}
    </aside>
  );
}
