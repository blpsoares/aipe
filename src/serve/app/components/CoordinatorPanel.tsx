// 5.4 — the coordinator as a worker, in its own voice: what it is doing, what it
// is waiting on, and what it needs the PE to do — with "the coordinator is
// waiting" kept visually and semantically separate from "the PE must act".
// 5.5 — a single coordinator identity; open sessions are shown as a session
// count, never as multiple coordinators.
import { snapshot, floorJourney, decisionInbox, coordinatorSessionCount } from "../runtime/store";
import { navigate } from "../runtime/router";
import { t } from "../runtime/i18n";
import { coordinatorView } from "../runtime/coordinator";

export function CoordinatorPanel() {
  const name = snapshot.value.context?.coordinator || "—";
  const journey = floorJourney.value;
  const inbox = decisionInbox.value;
  const view = coordinatorView(journey, inbox.length);
  const sess = coordinatorSessionCount.value;

  return (
    <div class="co-panel" aria-label={t("co_panel")}>
      <div class="co-id">
        <span class="co-avatar">{name.slice(0, 1).toUpperCase()}</span>
        <div class="co-who">
          <span class="co-name">{name}</span>
          <span class="co-role">
            {t("co_role")}
            {sess > 1 && <span class="co-sessions" title={t("co_sessions_hint")}> · {sess} {t("co_sessions")}</span>}
          </span>
        </div>
      </div>

      <div class="co-cols">
        {/* The coordinator is waiting — progress it monitors. */}
        <div class="co-col co-waiting">
          <div class="co-h">{t("co_waiting_h")}</div>
          {view.waiting.length === 0 && view.next.length === 0 ? (
            <div class="co-line muted">{t("co_idle")}</div>
          ) : (
            <>
              {view.waiting.map((w, i) => (
                <div class="co-line" key={`w${i}`}>
                  <span class="co-unit">{w.unit}</span> {t(w.whatKey).replace("{who}", w.who)}
                </div>
              ))}
              {view.next.map((n, i) => (
                <div class="co-line next" key={`n${i}`}>
                  <span class="co-unit">{n.unit}</span> {t(n.actionKey)}
                </div>
              ))}
            </>
          )}
        </div>

        {/* The PE must act — kept separate from the coordinator's own waits. */}
        <div class="co-col co-needs">
          <div class="co-h">{t("co_needs_h")}</div>
          {view.needsPE === 0 ? (
            <div class="co-line muted">{t("co_needs_none")}</div>
          ) : (
            <button type="button" class="co-needs-btn" onClick={() => navigate("/")} title={t("floor_inbox")}>
              {view.needsPE} {view.needsPE === 1 ? t("co_needs_one") : t("co_needs_many")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
