import { t, interpolate } from "../runtime/i18n";
import { fqid } from "../runtime/dom";
import { navigate } from "../runtime/router";
import { snapshot, counts, dispatches, activity } from "../runtime/store";
import { ActivityFeed } from "../components/ActivityFeed";
import { STAGES } from "../runtime/stages";
import type { Route } from "../route-types";

// app.html:713-724
function HeroStatus() {
  const c = counts.value;
  const warn = c.escalated > 0;
  const escW = snapshot.value.workers.find((w) => w.status === "escalated");
  const warnP = escW ? interpolate(t("warn_p"), { who: escW.name, repo: fqid(escW) }) : t("warn_p0");
  return (
    <div class={`hero ${warn ? "warn" : "ok"}`}>
      <div class="orb">{warn ? "⚠" : "✓"}</div>
      <div>
        <h2>{warn ? interpolate(t("warn_h"), { n: c.escalated }) : t("ok_h")}</h2>
        <p>{warn ? warnP : t("ok_p")}</p>
      </div>
      <div class="cta">
        <button class="btn btn-primary" onClick={() => navigate("/activity")}>
          {warn ? t("review") : t("viewact")}
        </button>
      </div>
    </div>
  );
}

// app.html:837-838
function Kpi({ n, label, cls }: { n: number; label: string; cls: string }) {
  return (
    <div class={`kpi ${cls}`}>
      <div class="n num">{n}</div>
      <div class="k">{label}</div>
      <div class="spark" />
    </div>
  );
}

function KpiRow() {
  const c = counts.value;
  return (
    <div class="kpis" id="ovKpis">
      <Kpi n={c.hired} label={t("k_specialists")} cls="" />
      <Kpi n={c.active} label={t("k_active")} cls="sky" />
      <Kpi n={c.delivered} label={t("k_delivered")} cls="acc" />
      <Kpi n={c.escalated} label={t("k_escalated")} cls="amber" />
      <Kpi n={c.journeys} label={t("k_journeys")} cls="" />
      <Kpi n={c.repos} label={t("k_repos")} cls="" />
    </div>
  );
}

// app.html:847-852
function MiniPipeline() {
  const ds = dispatches.value;
  return (
    <div class="grid" style={{ gridTemplateColumns: "repeat(4,1fr)", gap: "10px" }}>
      {STAGES.map((g) => {
        const n = ds.filter((d) => d.status === g.key).length;
        const color = g.cls === "active" ? "var(--sky)" : g.cls === "escalated" ? "var(--amber)" : "var(--accent)";
        return (
          <div
            key={g.key}
            style={{ textAlign: "center", padding: "12px", border: "1px solid var(--line)", borderRadius: "10px", background: "var(--panel-2)" }}
          >
            <div class="num" style={{ fontSize: "22px", fontWeight: 750, color }}>
              {n}
            </div>
            <div
              class="k"
              style={{ fontFamily: "var(--mono)", fontSize: "10px", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--ink-3)", marginTop: "4px" }}
            >
              {t("s_" + g.key)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// app.html:712-740
function OverviewView() {
  return (
    <div class="view-in grid" style={{ gap: "20px" }}>
      <HeroStatus />

      <KpiRow />

      <div class="grid cols-2a" style={{ alignItems: "start" }}>
        <div class="card pad">
          <div class="between" style={{ marginBottom: "12px" }}>
            <div class="eyebrow">{t("pipeline")}</div>
            <button class="btn btn-ghost" style={{ padding: "5px 11px" }} onClick={() => navigate("/pipeline")}>
              {t("openboard")}
            </button>
          </div>
          <MiniPipeline />
        </div>
        <div class="card pad">
          <div class="between" style={{ marginBottom: "6px" }}>
            <div class="eyebrow">{t("liveact")}</div>
            <span class="conn">
              <span class="dot" />
              {t("live")}
            </span>
          </div>
          <ActivityFeed events={activity.value.slice(0, 5)} />
        </div>
      </div>
    </div>
  );
}

export const route: Route = {
  path: "/overview",
  nav: { label: "nav_overview", icon: "◎", order: 0 },
  component: OverviewView,
};
