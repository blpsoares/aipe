// "Glossário" (footer) — the safety net against jargon. A plain-language
// translation of every AIPe word (SDD §3 table) on top, then the full state
// guide: what each state means, what causes it, what unblocks it, who acts next.
// Data for the states comes from the repo's real types (runtime/status-guide.ts),
// so it can't drift from the ledger.
import { useEffect } from "preact/hooks";
import { t } from "../runtime/i18n";
import { StatusIcon } from "../components/StatusIcon";
import { canonicalGuide, transientGuide, rejectedGuide, type StatusEntry } from "../runtime/status-guide";
import { focusAnchor } from "../runtime/router";
import type { Route } from "../route-types";

function label(key: string): string {
  const st = t(`st_${key}`);
  return st === `st_${key}` ? key.replace(/-/g, " ") : st;
}

// The jargon → plain-language table (SDD §3). Each row: the AIPe term and what
// it means for the reader, so no word on the console is left unexplained.
const JARGON = ["coordinator", "specialist", "journey", "dispatch", "worktree", "gate", "escalation", "costindex"] as const;

function JargonTable() {
  return (
    <div class="sg-section">
      <h2 class="sg-sec-h">{t("guide_jargon_h")}</h2>
      <div class="sub" style={{ marginBottom: "10px" }}>{t("guide_jargon_sub")}</div>
      <div class="jargon-tbl" role="table" aria-label={t("guide_jargon_h")}>
        <div class="jargon-row jargon-head" role="row">
          <span role="columnheader">{t("jg_term")}</span>
          <span role="columnheader">{t("jg_plain")}</span>
        </div>
        {JARGON.map((k) => (
          <div class="jargon-row" role="row" key={k}>
            <span class="jargon-term" role="cell">{t(`jg_${k}`)}</span>
            <span class="jargon-plain" role="cell">{t(`jg_${k}_d`)}</span>
          </div>
        ))}
      </div>
    </div>
  );
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
              <ul class="sg-laws">{e.laws.map((l) => <li key={l}>{t(l)}</li>)}</ul>
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
      <div class="sg-grid">{entries.map((e) => <StatusCard key={e.key} e={e} />)}</div>
    </div>
  );
}

function GuideView() {
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
        <h1 class="view-h">{t("nav_guide")}</h1>
        <div class="sub">{t("guide_sub")}</div>
      </div>
      <JargonTable />
      <Section titleKey="sg_sec_canonical" entries={canonicalGuide()} />
      <Section titleKey="sg_sec_transient" entries={transientGuide()} />
      <Section titleKey="sg_sec_rejected" entries={rejectedGuide()} />
    </div>
  );
}

export const route: Route = {
  path: "/guide",
  nav: { label: "nav_guide", icon: "book", order: 10, group: "footer" },
  component: GuideView,
};
