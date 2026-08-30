// The work board — "the whole board", the collapsible section inside "Agora"
// (SDD §5/§11, reconciled with j-20260829-dp). Where "Agora" up top is the inbox
// (what needs YOU, what runs now), THIS is the full board: read-only, "tipo um
// Jira" — filter, group, build columns, open a detail, copy a command; never an
// action that writes the ledger.
//
// This is the Atividade board (j-20260829-dp) given its home INSIDE Agora rather
// than a fourth primary screen — the machinery (ActivityBoard, runtime/activity,
// the merge-truth Integrados column, the server-owned refresher, the load-bearing
// `.acol-body .acard` rule) is reused verbatim, only its container changed.
import { useState } from "preact/hooks";
import { Icon } from "./Icon";
import { ActivityBoard } from "./ActivityBoard";
import { t } from "../runtime/i18n";
import { dispatches, sessions } from "../runtime/store";
import {
  boardConfig,
  setBoardConfig,
  resetBoardConfig,
  distinctValues,
  GROUP_FIELDS,
  type BoardConfig,
  type GroupField,
} from "../runtime/activity";
import { ACTIVE_COLUMNS } from "../runtime/board";
import type { BoardColumn } from "../runtime/board";

const GROUP_LABEL: Record<GroupField, string> = {
  state: "act_group_state",
  repo: "act_group_repo",
  persona: "act_group_persona",
  journey: "act_group_journey",
};

const STATE_LABEL: Record<string, string> = {
  working: "board_col_working",
  "needs-you": "board_col_needs_you",
  "in-review": "board_col_in_review",
  ready: "board_col_ready",
  integrated: "board_col_integrated",
};

// Toggle a value's membership in a filter array (immutably).
function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function isFactory(c: BoardConfig): boolean {
  const f = c.filters;
  return (
    c.groupBy === "state" &&
    !c.showCompleted &&
    !f.waitsOnPE &&
    f.repos.length === 0 &&
    f.personas.length === 0 &&
    f.journeys.length === 0 &&
    f.states.length === 0
  );
}

function ChipRow({
  title,
  values,
  active,
  onToggle,
  labelOf,
}: {
  title: string;
  values: string[];
  active: string[];
  onToggle: (v: string) => void;
  labelOf?: (v: string) => string;
}) {
  if (values.length === 0) return null;
  return (
    <div class="af-row">
      <div class="af-k sub">{title}</div>
      <div class="af-chips">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            class={`fchip${active.includes(v) ? " is-on" : ""}`}
            aria-pressed={active.includes(v)}
            onClick={() => onToggle(v)}
          >
            {labelOf ? labelOf(v) : v}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The configurable board body: the build-your-own-board controls + the board. */
export function WorkBoard() {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const cfg = boardConfig.value;
  const ds = dispatches.value;
  const ss = sessions.value;

  const set = (patch: Partial<BoardConfig>) => setBoardConfig({ ...cfg, ...patch });
  const setFilter = (patch: Partial<BoardConfig["filters"]>) => set({ filters: { ...cfg.filters, ...patch } });

  const repos = distinctValues(ds, ss, "repo");
  const personas = distinctValues(ds, ss, "persona");
  const journeys = distinctValues(ds, ss, "journey");
  const activeFilterCount =
    cfg.filters.repos.length +
    cfg.filters.personas.length +
    cfg.filters.journeys.length +
    cfg.filters.states.length +
    (cfg.filters.waitsOnPE ? 1 : 0);

  return (
    <div class="grid" style={{ gap: "12px" }}>
      {/* Build-your-own-board controls (item 4) — the simple that works. */}
      <div class="actbar card pad">
        <div class="actbar-row">
          <div class="actbar-group" role="group" aria-label={t("act_group_by")}>
            <span class="af-k sub">{t("act_group_by")}</span>
            <div class="seg">
              {GROUP_FIELDS.map((g) => (
                <button
                  key={g}
                  type="button"
                  class={`seg-btn${cfg.groupBy === g ? " is-on" : ""}`}
                  aria-pressed={cfg.groupBy === g}
                  onClick={() => set({ groupBy: g })}
                >
                  {t(GROUP_LABEL[g])}
                </button>
              ))}
            </div>
          </div>
          <div class="actbar-spacer" />
          <label class="actbar-toggle">
            <input type="checkbox" checked={cfg.filters.waitsOnPE} onChange={(e) => setFilter({ waitsOnPE: (e.target as HTMLInputElement).checked })} />
            {t("act_waits_you")}
          </label>
          <label class="actbar-toggle">
            <input type="checkbox" checked={cfg.showCompleted} onChange={(e) => set({ showCompleted: (e.target as HTMLInputElement).checked })} />
            {t("act_show_completed")}
          </label>
          <button type="button" class={`btn btn-ghost actbar-filters${filtersOpen ? " is-on" : ""}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>
            <Icon name="search" size={14} /> {t("act_filters")}{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
          {!isFactory(cfg) ? (
            <button type="button" class="btn btn-ghost" onClick={() => resetBoardConfig()}>
              <Icon name="reset" size={14} /> {t("act_reset")}
            </button>
          ) : null}
        </div>

        {filtersOpen ? (
          <div class="actbar-filters-panel">
            <ChipRow
              title={t("act_f_state")}
              values={[...ACTIVE_COLUMNS, "integrated"]}
              active={cfg.filters.states}
              onToggle={(v) => setFilter({ states: toggle(cfg.filters.states, v) as BoardColumn[] })}
              labelOf={(v) => t(STATE_LABEL[v] ?? v)}
            />
            <ChipRow title={t("act_f_repo")} values={repos} active={cfg.filters.repos} onToggle={(v) => setFilter({ repos: toggle(cfg.filters.repos, v) })} />
            <ChipRow title={t("act_f_persona")} values={personas} active={cfg.filters.personas} onToggle={(v) => setFilter({ personas: toggle(cfg.filters.personas, v) })} />
            <ChipRow title={t("act_f_journey")} values={journeys} active={cfg.filters.journeys} onToggle={(v) => setFilter({ journeys: toggle(cfg.filters.journeys, v) })} />
          </div>
        ) : null}
      </div>

      <ActivityBoard dispatches={ds} sessions={ss} config={cfg} />
    </div>
  );
}
