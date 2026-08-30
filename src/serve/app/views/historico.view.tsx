// "Histórico" — what has happened, and how much the team delivered. The metrics
// block reserves the place for the delivery metric (journey j-20260827-kj, whose
// MECHANISM is out of scope here); until that data exists it shows an HONEST
// placeholder — "not measured yet", never an invented number (SDD §6.3). Below,
// the full timeline of state changes (the old activity feed).
import { t } from "../runtime/i18n";
import { activity, counts } from "../runtime/store";
import { ActivityFeed } from "../components/ActivityFeed";
import { Icon } from "../components/Icon";
import type { Route } from "../route-types";

function MetricsBlock() {
  const c = counts.value;
  return (
    <section class="hist-metrics card pad">
      <div class="between" style={{ marginBottom: "10px" }}>
        <div>
          <h2 class="sec-h">{t("hist_metrics")}</h2>
          <div class="sub">{t("hist_metrics_sub")}</div>
        </div>
        <span class="pill-pending" title={t("hist_metrics_pending_p")}>{t("hist_metrics_pending")}</span>
      </div>
      {/* The reserved shape: the tiles the metric will fill. They show the counts
          we DO have (delivered so far) and a clearly-empty, honest placeholder
          where the per-period/project figure will land. */}
      <div class="metric-tiles">
        <div class="metric-tile">
          <div class="mt-n num">{c.delivered}</div>
          <div class="mt-k">{t("k_delivered")}</div>
        </div>
        <div class="metric-tile is-pending" aria-label={t("hist_metrics_pending")}>
          <div class="mt-n num muted">—</div>
          <div class="mt-k">{t("hist_metrics_pending")}</div>
        </div>
      </div>
      <p class="sub hist-metrics-note"><Icon name="warn" size={12} /> {t("hist_metrics_pending_p")}</p>
    </section>
  );
}

function TimelineBlock() {
  const events = activity.value;
  return (
    <section class="hist-timeline grid" style={{ gap: "10px" }}>
      <div class="between">
        <div>
          <h2 class="sec-h">{t("hist_timeline")}</h2>
          <div class="sub">{t("hist_timeline_sub")}</div>
        </div>
        <span class="conn"><span class="dot" />{t("live")}</span>
      </div>
      <div class="card pad">
        {events.length === 0 ? <div class="sub">{t("hist_timeline_empty")}</div> : <ActivityFeed events={events} />}
      </div>
    </section>
  );
}

function HistoricoView() {
  return (
    <div class="view-in grid" style={{ gap: "22px" }}>
      <div>
        <h1 class="view-h">{t("nav_history")}</h1>
        <div class="sub">{t("hist_sub")}</div>
      </div>
      <MetricsBlock />
      <TimelineBlock />
    </div>
  );
}

export const route: Route = {
  path: "/history",
  nav: { label: "nav_history", icon: "history", order: 3 },
  component: HistoricoView,
};
