// 5.3 — The status guide. Explains every canonical DispatchStatus, the
// session-mode transient `running`, and the states the ledger rejects: what each
// means, what causes it, what unblocks it, and who acts next. Data comes from the
// repo's real types (runtime/status-guide.ts), so it can't drift from the ledger.
// Routed at /status and linked from the nav and from the status chips.
import { useEffect } from "preact/hooks";
import { t, stt } from "../runtime/i18n";
import { StatusIcon } from "../components/StatusIcon";
import { canonicalGuide, transientGuide, rejectedGuide, type StatusEntry } from "../runtime/status-guide";
import { focusAnchor } from "../runtime/router";
import type { Route } from "../route-types";

function label(key: string): string {
  // Canonical statuses have a st_<key> label; synthetic ids (running, verify
  // codes) read their own key humanized.
  const st = t(`st_${key}`);
  return st === `st_${key}` ? key.replace(/-/g, " ") : st;
}

function StatusCard({ e }: { e: StatusEntry }) {
  return (
    <section class="sg-card" id={`s-${e.key}`}>
      <header class="sg-head">
        <span class={`chip ${e.key}`} data-tone={e.tone}>
          <StatusIcon k={e.key} size={14} />
          {label(e.key)}
        </span>
      </header>
      <dl class="sg-fields">
        <dt>{t("sg_col_means")}</dt>
        <dd>{t(e.meaning)}</dd>
        <dt>{t("sg_col_causes")}</dt>
        <dd>{t(e.cause)}</dd>
        <dt>{t("sg_col_unblocks")}</dt>
        <dd>{t(e.unblock)}</dd>
        <dt>{t("sg_col_who")}</dt>
        <dd>{t(e.who)}</dd>
        {e.laws.length > 0 && (
          <>
            <dt>{t("sg_col_laws")}</dt>
            <dd>
              <ul class="sg-laws">
                {e.laws.map((l) => (
                  <li key={l}>{t(l)}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

function Section({ titleKey, entries }: { titleKey: string; entries: StatusEntry[] }) {
  return (
    <div class="sg-section">
      <h2 class="sg-sec-h">{t(titleKey)}</h2>
      <div class="sg-grid">
        {entries.map((e) => (
          <StatusCard key={e.key} e={e} />
        ))}
      </div>
    </div>
  );
}

function StatusView() {
  // A status chip that opened this page sets focusAnchor — scroll to and briefly
  // highlight the matching card, then clear it.
  useEffect(() => {
    const anchor = focusAnchor.value;
    if (!anchor) return;
    focusAnchor.value = null;
    const el = document.getElementById(anchor);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("sg-flash");
      setTimeout(() => el.classList.remove("sg-flash"), 1600);
    }
  }, []);

  return (
    <div class="view-in grid" style={{ gap: "18px" }}>
      <div>
        <h1 class="view-h">{t("status_title")}</h1>
        <div class="sub">{t("status_sub")}</div>
      </div>
      <Section titleKey="sg_sec_canonical" entries={canonicalGuide()} />
      <Section titleKey="sg_sec_transient" entries={transientGuide()} />
      <Section titleKey="sg_sec_rejected" entries={rejectedGuide()} />
    </div>
  );
}

export const route: Route = {
  path: "/status",
  nav: { label: "status_nav", icon: "book", order: 8 },
  component: StatusView,
};
