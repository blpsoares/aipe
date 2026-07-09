import { t } from "../runtime/i18n";
import { fqidOf } from "../runtime/dom";
import { dispatches, openWorkerName, type Dispatch } from "../runtime/store";
import { STAGES } from "../runtime/stages";
import type { Route } from "../route-types";

// app.html:859-861 (tkHTML). PR link stops propagation so clicking it opens
// the PR in a new tab instead of the specialist drawer.
function DispatchCard({ d }: { d: Dispatch }) {
  return (
    <div class={`tk stg-${d.status}`} onClick={() => (openWorkerName.value = d.specialist ?? null)}>
      <div class="who">{d.specialist}</div>
      <div class="meta">
        <span class="tag">{fqidOf(d)}</span>·<span>{d.journey}</span>
        {d.pr ? (
          <a
            class="link"
            href={String(d.pr)}
            target="_blank"
            rel="noreferrer"
            onClick={(e: MouseEvent) => e.stopPropagation()}
          >
            PR ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

// app.html:853-857 (laneHTML).
function Lane({ g }: { g: (typeof STAGES)[number] }) {
  const cards = dispatches.value.filter((d) => d.status === g.key);
  const dc = g.cls === "active" ? "var(--sky)" : g.cls === "escalated" ? "var(--amber)" : "var(--accent)";
  return (
    <div class="lane">
      <h4>
        <span class="d" style={{ background: dc }} />
        {t("s_" + g.key)}
        <span class="c num">{cards.length}</span>
      </h4>
      <div class="body">
        {cards.length ? cards.map((d, i) => <DispatchCard key={i} d={d} />) : <div class="sub" style={{ padding: "8px 2px" }}>—</div>}
      </div>
    </div>
  );
}

// app.html:760-765 (pipeline view).
function PipelineView() {
  const ds = dispatches.value;
  // PARITY QUIRK — the "{a}" placeholder uses a hardcoded literal 2, not
  // counts.journeys, in the original app.html. Preserved intentionally.
  const sub = t("pipe_sub").replace("{a}", String(2)).replace("{b}", String(ds.length));
  return (
    <div class="view-in grid" style={{ gap: "16px" }}>
      <div class="between">
        <div>
          <h1 class="view-h">{t("pipeline")}</h1>
          <div class="sub">{sub}</div>
        </div>
        <button class="btn btn-ghost">{t("filter")}</button>
      </div>
      <div class="board">
        {STAGES.map((g) => (
          <Lane key={g.key} g={g} />
        ))}
      </div>
    </div>
  );
}

export const route: Route = {
  path: "/pipeline",
  nav: { label: "nav_pipeline", icon: "▦", order: 2 },
  component: PipelineView,
};
