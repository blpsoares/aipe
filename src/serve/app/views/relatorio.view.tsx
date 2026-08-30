// "Relatório" — how much the team delivered, honest enough to relay to others.
// Fills the delivery-metric MECHANISM the Histórico reserved (console-redesign
// SDD §6.3). Runs the SAME pure computeReport engine the `aipe report` CLI runs,
// over the snapshot's journeys — one definition of "a delivery", no second
// derivation. It carries the four cuts the PE named (v2): by data, by entrega, by
// especialista, and activity graphs over time. Every number carries the question
// it answers; the honesty block spells out what is deduped, absent, or derived;
// publication (merged ≠ published, src/release) is read off the payload.
import { useState } from "preact/hooks";
import { t, interpolate } from "../runtime/i18n";
import { snapshot } from "../runtime/store";
import { computeReport, type GroupDim, type ReportJourney, type MetricSet, type ReportFilter, type PublishState } from "../../../report/compute";
import { Icon } from "../components/Icon";
import type { Route } from "../route-types";

type GroupChoice = "none" | GroupDim;
const GROUP_CHOICES: GroupChoice[] = ["none", "repo", "persona", "status", "period", "model"];
const GROUP_LABEL: Record<GroupChoice, string> = {
  none: "rep_group_none", repo: "rep_by_repo", persona: "rep_by_persona", status: "rep_by_status",
  period: "rep_by_period", model: "rep_by_model", harness: "rep_by_harness", tier: "rep_by_tier",
};

// The four metrics, each paired with the question it answers (Pilar 2 — a metric
// without a question is decoration). `derived` rides in its own cell so nothing
// measured and nothing derived are ever presented as the same kind of fact.
const METRICS: { key: keyof MetricSet; label: string; q: string }[] = [
  { key: "deliveries", label: "rep_m_deliveries", q: "rep_q_deliveries" },
  { key: "qaVerified", label: "rep_m_qa", q: "rep_q_qa" },
  { key: "prsMerged", label: "rep_m_merged", q: "rep_q_merged" },
  { key: "prsOpen", label: "rep_m_open", q: "rep_q_open" },
];

const PUB_LABEL: Record<PublishState, string> = {
  published: "rep_pub_published", "merged-unpublished": "rep_pub_merged", unknown: "rep_pub_unknown", checking: "rep_pub_checking",
};
const PUB_CLASS: Record<PublishState, string> = {
  published: "is-pub", "merged-unpublished": "is-merged", unknown: "is-unknown", checking: "is-checking",
};

function MetricTiles({ m }: { m: MetricSet }) {
  return (
    <div class="metric-tiles rep-tiles">
      {METRICS.map((metric) => (
        <div key={metric.key} class="metric-tile rep-tile" data-metric={metric.key}>
          <div class="mt-n num">
            {m[metric.key]}
            {metric.key === "prsMerged" && m.prsMergedDerived > 0 && (
              <span class="rep-deriv" title={t("rep_h_merged_derived")}>+{m.prsMergedDerived} {t("rep_derived_tag")}</span>
            )}
          </div>
          <div class="mt-k">{t(metric.label)}</div>
          <div class="rep-q">{t(metric.q)}</div>
        </div>
      ))}
    </div>
  );
}

// Activity over time — dispatches per day (bars), with the delivered part filled.
// Honest by construction: each bar is an independent measured count, bars are
// never connected, and a day with no activity simply has no bar (no interpolation
// between distant points — the "axis that lies" the v2 spec forbids).
function ActivityChart({ journeys, filter }: { journeys: ReportJourney[]; filter: ReportFilter }) {
  const byPeriod = computeReport(journeys, { filter, groupBy: ["period"] }).groups;
  const bars = byPeriod
    .filter((g) => g.key.period && g.key.period !== "— sem data —")
    .map((g) => ({ period: g.key.period!, dispatches: g.dispatches, deliveries: g.metrics.deliveries }))
    .sort((a, b) => a.period.localeCompare(b.period));
  const max = Math.max(1, ...bars.map((b) => b.dispatches));
  return (
    <section class="rep-sec grid" style={{ gap: "10px" }}>
      <div class="between">
        <div>
          <h2 class="sec-h">{t("rep_activity")}</h2>
          <div class="sub">{t("rep_activity_sub")}</div>
        </div>
      </div>
      {bars.length === 0 ? (
        <div class="card pad sub">{t("rep_activity_empty")}</div>
      ) : (
        <div class="card pad">
          <div class="rep-chart" role="img" aria-label={t("rep_activity")}>
            {bars.map((b) => {
              const fill = b.dispatches > 0 ? (b.deliveries / b.dispatches) * 100 : 0;
              return (
                <div key={b.period} class="rep-bar-col" title={`${b.period} · ${b.dispatches} ${t("rep_chart_dispatches")} · ${b.deliveries} ${t("rep_chart_deliveries")}`}>
                  <div class="rep-bar-track">
                    <div class="rep-bar" style={{ height: `${(b.dispatches / max) * 100}%` }}>
                      <div class="rep-bar-fill" style={{ height: `${fill}%` }} />
                    </div>
                  </div>
                  <div class="rep-bar-lbl">{b.period.slice(5)}</div>
                </div>
              );
            })}
          </div>
          <p class="sub rep-chart-note"><Icon name="warn" size={12} /> {t("rep_activity_note")}</p>
        </div>
      )}
    </section>
  );
}

function GroupTable({ groups, dims }: { groups: ReturnType<typeof computeReport>["groups"]; dims: GroupDim[] }) {
  return (
    <div class="rep-tablewrap">
      <table class="rep-table">
        <thead>
          <tr>
            <th>{dims.map((d) => t(GROUP_LABEL[d])).join(" · ")}</th>
            <th class="num">{t("rep_m_deliveries")}</th>
            <th class="num">{t("rep_m_qa")}</th>
            <th class="num">{t("rep_m_merged")}</th>
            <th class="num">{t("rep_m_open")}</th>
            <th class="num">{t("rep_dispatches")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.label} class="rep-grow">
              <td class="rep-glabel">{g.label}</td>
              <td class="num">{g.metrics.deliveries}</td>
              <td class="num">{g.metrics.qaVerified}</td>
              <td class="num">
                {g.metrics.prsMerged}
                {g.metrics.prsMergedDerived > 0 && <span class="rep-deriv"> +{g.metrics.prsMergedDerived}</span>}
              </td>
              <td class="num">{g.metrics.prsOpen}</td>
              <td class="num sub">{g.dispatches}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PublicationBlock({ result }: { result: ReturnType<typeof computeReport> }) {
  const repos = Object.keys(result.publication).sort((a, b) => a.localeCompare(b, "pt"));
  if (repos.length === 0) return null;
  return (
    <section class="rep-sec grid" style={{ gap: "10px" }}>
      <div>
        <h2 class="sec-h">{t("rep_pub")}</h2>
        <div class="sub">{t("rep_pub_sub")}</div>
      </div>
      <div class="card pad rep-pub-list">
        {repos.map((repo) => {
          const p = result.publication[repo]!;
          return (
            <div key={repo} class="between rep-pub-row">
              <div style={{ minWidth: 0 }}>
                <b>{repo}</b>
                <div class="sub" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.reason}</div>
              </div>
              <span class={`rep-pub-chip ${PUB_CLASS[p.state]}`}>
                {p.latestReleaseTag && <span class="rep-pub-tag">{p.latestReleaseTag}</span>}
                {t(PUB_LABEL[p.state])}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HonestyBlock({ result, byPeriod }: { result: ReturnType<typeof computeReport>; byPeriod: boolean }) {
  const h = result.honesty;
  return (
    <section class="rep-honesty card pad">
      <div style={{ marginBottom: "10px" }}>
        <div class="eyebrow">{t("rep_honesty")}</div>
        <div class="sub">{t("rep_honesty_sub")}</div>
      </div>
      <ul class="rep-hlist">
        <li><Icon name="warn" size={13} /> {interpolate(t("rep_h_noenv"), { n: h.noEnvelope })}</li>
        {h.personaDuplicates.length > 0 ? (
          h.personaDuplicates.map((d) => (
            <li key={d.canonical}><Icon name="team" size={13} /> {interpolate(t("rep_h_dup"), { v: d.variants.join(" / "), c: d.canonical })}</li>
          ))
        ) : (
          <li><Icon name="team" size={13} /> {t("rep_h_nodup")}</li>
        )}
        <li><Icon name="pipeline" size={13} /> {t("rep_h_merged_derived")}</li>
        {byPeriod && <li><Icon name="history" size={13} /> {t("rep_h_period_derived")}</li>}
      </ul>
    </section>
  );
}

function ExportHint() {
  const ws = snapshot.value.workspaceDir;
  const arg = ws ? ` --workspace ${ws}` : "";
  return (
    <div class="rep-export sub">
      {t("rep_export")} <code>aipe report{arg} --json</code> · <code>aipe report{arg} --csv</code>
    </div>
  );
}

// Filter options derived from the UNFILTERED slice via the same engine (grouping
// enumerates the present values) — so the dropdowns never offer a value that
// isn't in the data, and never re-derive the enumeration by hand.
function optionsOf(journeys: ReportJourney[], dim: GroupDim): string[] {
  return computeReport(journeys, { groupBy: [dim] }).groups.map((g) => g.key[dim]!).filter(Boolean);
}

function RelatorioView() {
  const [group, setGroup] = useState<GroupChoice>("none");
  const [persona, setPersona] = useState("");
  const [status, setStatus] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  const journeys = (snapshot.value.journeys ?? []) as ReportJourney[];
  const publication = snapshot.value.publication ?? {};
  const personaOpts = optionsOf(journeys, "persona");
  const statusOpts = optionsOf(journeys, "status");

  const filter: ReportFilter = {};
  if (persona) filter.persona = [persona];
  if (status) filter.status = [status];
  if (since) filter.since = since;
  if (until) filter.until = until;

  const groupBy: GroupDim[] = group === "none" ? [] : [group];
  const result = computeReport(journeys, { groupBy, filter, publication });
  const active = !!(persona || status || since || until);

  return (
    <div class="view-in grid" style={{ gap: "22px" }}>
      <div class="between">
        <div>
          <h1 class="view-h">{t("nav_report")}</h1>
          <div class="sub">{t("rep_sub")}</div>
        </div>
        <div class="row" style={{ alignItems: "center", gap: "8px" }}>
          <span class="sub">{t("rep_group")}</span>
          <div class="langseg rep-groupby">
            {GROUP_CHOICES.map((g) => (
              <button key={g} class={group === g ? "on" : ""} onClick={() => setGroup(g)}>{t(GROUP_LABEL[g])}</button>
            ))}
          </div>
        </div>
      </div>

      {/* The three cuts the PE named, combinable: especialista, entrega, data. */}
      <div class="rep-filters card pad" data-testid="rep-filters">
        <span class="eyebrow">{t("rep_filters")}</span>
        <label class="rep-field">
          <span class="sub">{t("rep_by_persona")}</span>
          <select value={persona} onChange={(e) => setPersona((e.target as HTMLSelectElement).value)}>
            <option value="">{t("rep_f_all")}</option>
            {personaOpts.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label class="rep-field">
          <span class="sub">{t("rep_by_status")}</span>
          <select value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
            <option value="">{t("rep_f_all")}</option>
            {statusOpts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label class="rep-field">
          <span class="sub">{t("rep_f_since")}</span>
          <input type="date" value={since} onInput={(e) => setSince((e.target as HTMLInputElement).value)} />
        </label>
        <label class="rep-field">
          <span class="sub">{t("rep_f_until")}</span>
          <input type="date" value={until} onInput={(e) => setUntil((e.target as HTMLInputElement).value)} />
        </label>
        {active && (
          <button class="btn btn-ghost rep-clear" onClick={() => { setPersona(""); setStatus(""); setSince(""); setUntil(""); }}>
            {t("rep_f_clear")}
          </button>
        )}
      </div>

      {result.empty ? (
        <div class="card pad rep-empty sub">{t("rep_empty")}</div>
      ) : (
        <>
          <MetricTiles m={result.overall} />
          <ActivityChart journeys={journeys} filter={filter} />
          {result.groups.length > 0 && <GroupTable groups={result.groups} dims={groupBy} />}
          <PublicationBlock result={result} />
          <HonestyBlock result={result} byPeriod={group === "period"} />
          <ExportHint />
        </>
      )}
    </div>
  );
}

export const route: Route = {
  path: "/report",
  nav: { label: "nav_report", icon: "report", order: 3 },
  component: RelatorioView,
};
