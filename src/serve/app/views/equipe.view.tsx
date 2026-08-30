// "Equipe" — one screen for "who is my team and how is it organized". Absorbs
// the old org chart (now fits the viewport), the team roster, and the toolbox
// (the team's capabilities), so the same `workers` data appears once, in the
// place that answers the question (SDD §6.2, decision B).
import { useEffect, useState } from "preact/hooks";
import { t, stt } from "../runtime/i18n";
import { snapshot, counts, openWorkerName, type Worker, type Snapshot } from "../runtime/store";
import { cvOf, cvWork } from "../runtime/selectors";
import { orgQuery, orgTransform, zoomBy, toggleFullscreen } from "../runtime/org";
import { OrgChart } from "../components/OrgChart";
import { OrgTree } from "../components/OrgTree";
import { OrgLegend } from "../components/OrgLegend";
import { Avatar } from "../components/Avatar";
import { Chip } from "../components/Chip";
import { UnitFacts } from "../components/UnitFacts";
import { CompChips } from "../components/CompChips";
import { Icon } from "../components/Icon";
import type { Route } from "../route-types";

// ── Section 1: the org chart (fits the viewport on load — runtime/org.ts) ──────

function handleZoom(dir: number) {
  const wrap = document.getElementById("orgwrap");
  const size = wrap ? wrap.getBoundingClientRect() : { width: 0, height: 0 };
  zoomBy(dir, size);
}
function handleFullscreen() {
  toggleFullscreen(document.getElementById("orgstage"));
}

function OrgSection() {
  const q = orgQuery.value;
  useEffect(() => {
    function onFsChange() {
      const wrap = document.getElementById("orgwrap");
      zoomBy(0, wrap ? wrap.getBoundingClientRect() : { width: 0, height: 0 });
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);
  return (
    <section class="team-sec grid" style={{ gap: "12px" }}>
      <div class="between">
        <div>
          <h2 class="sec-h">{t("team_sec_org")}</h2>
          <div class="sub">{t("team_sec_org_sub")}</div>
        </div>
        <div class="org-toolbar">
          <label class="org-search">
            <Icon name="search" size={15} />
            <input
              id="orgSearch"
              type="search"
              value={q}
              placeholder={t("org_search_ph")}
              aria-label={t("org_search_ph")}
              autocomplete="off"
              spellcheck={false}
              onInput={(e) => (orgQuery.value = (e.target as HTMLInputElement).value)}
            />
          </label>
          <div class="org-ctrls" role="group" aria-label={t("org_zoom")}>
            <button class="icon-btn" onClick={() => handleZoom(-1)} title={t("org_zoom_out")} aria-label={t("org_zoom_out")}><Icon name="minus" /></button>
            <button class="icon-btn" onClick={() => handleZoom(1)} title={t("org_zoom_in")} aria-label={t("org_zoom_in")}><Icon name="plus" /></button>
            <button class="icon-btn" onClick={() => handleZoom(0)} title={t("org_reset")} aria-label={t("org_reset")}><Icon name="reset" /></button>
            <button class="icon-btn" onClick={handleFullscreen} title={t("org_fullscreen")} aria-label={t("org_fullscreen")}><Icon name="fullscreen" /></button>
          </div>
        </div>
      </div>
      <div class="org-stage" id="orgstage">
        <div class="card org-desktop"><OrgChart /></div>
        <div class="org-mobile"><OrgTree /></div>
      </div>
      <OrgLegend />
    </section>
  );
}

// ── Section 2: the roster (grouped worker cards) ───────────────────────────────

function WorkerCard({ w }: { w: Worker }) {
  const cv = cvOf(w.name);
  const work = cvWork(w.name);
  return (
    <button class="cvcard" onClick={() => (openWorkerName.value = w.name)}>
      <div class="cvhead">
        <Avatar name={w.name} />
        <div class="cvid">
          <div class="cvname">{w.name}</div>
          <div class="cvtitle">{cv.title || w.role}</div>
        </div>
        <Chip status={w.status || ""} />
      </div>
      <UnitFacts worker={w} />
      <div class="cvcomp"><CompChips list={cv.competences} max={4} /></div>
      <div class="cvstats">
        <span class="cvstat"><b>{work.delivered.length}</b>{t("cv_delivered")}</span>
        <span class="cvstat"><b>{work.inprog.length}</b>{t("cv_inprog")}</span>
      </div>
    </button>
  );
}

type GroupBy = "project" | "activity" | "specialty";
const GROUP_OPTIONS: GroupBy[] = ["project", "activity", "specialty"];
function groupKey(w: Worker, by: GroupBy): string {
  if (by === "project") return w.package ? `${w.repo}/${w.package}` : w.repo || "—";
  if (by === "activity") return w.status || "—";
  return w.role || "—";
}
function groupLabel(key: string, by: GroupBy): string {
  return by === "activity" ? stt(key) : key;
}
const STATUS_RANK: Record<string, number> = { escalated: 0, redirected: 0, active: 1, delivered: 2, available: 3 };
const ROLE_RANK: Record<string, number> = { "dev-fullstack": 0, dev: 0, qa: 1 };
function sortGroups(entries: [string, Worker[]][], by: GroupBy): [string, Worker[]][] {
  const rank = by === "activity" ? STATUS_RANK : by === "specialty" ? ROLE_RANK : null;
  return entries.slice().sort((a, b) => {
    if (rank) return (rank[a[0]] ?? 99) - (rank[b[0]] ?? 99) || a[0].localeCompare(b[0]);
    return a[0].localeCompare(b[0]);
  });
}
function groupWorkers(workers: Worker[], by: GroupBy): [string, Worker[]][] {
  const g = new Map<string, Worker[]>();
  for (const w of workers) {
    const k = groupKey(w, by);
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(w);
  }
  return sortGroups([...g.entries()], by);
}

function RosterSection() {
  const [by, setBy] = useState<GroupBy>("project");
  const groups = groupWorkers(snapshot.value.workers, by);
  return (
    <section class="team-sec grid" style={{ gap: "12px" }}>
      <div class="between">
        <h2 class="sec-h">{t("team_sec_roster")}</h2>
        <div class="row" style={{ alignItems: "center", gap: "8px" }}>
          <span class="sub">{t("team_group")}</span>
          <div class="langseg team-groupby">
            {GROUP_OPTIONS.map((g) => (
              <button key={g} class={by === g ? "on" : ""} onClick={() => setBy(g)}>{t(`team_by_${g}`)}</button>
            ))}
          </div>
        </div>
      </div>
      {groups.map(([key, ws]) => (
        <div key={key} class="team-group grid" style={{ gap: "10px" }}>
          <div class="between">
            <span class="eyebrow">{groupLabel(key, by)}</span>
            <span class="sub">{ws.length}</span>
          </div>
          <div class="cvgrid">{ws.map((w) => <WorkerCard key={w.name} w={w} />)}</div>
        </div>
      ))}
    </section>
  );
}

// ── Section 3: the toolbox — what the team can do (decision B) ──────────────────

type Skill = Snapshot["toolbox"]["skills"][number];
type Mcp = Snapshot["toolbox"]["mcps"][number];

function ToolboxSection() {
  const tb = snapshot.value.toolbox;
  if (tb.skills.length === 0 && tb.mcps.length === 0) return null;
  return (
    <section class="team-sec grid" style={{ gap: "12px" }}>
      <div>
        <h2 class="sec-h">{t("team_sec_toolbox")}</h2>
        <div class="sub">{t("team_sec_toolbox_sub")}</div>
      </div>
      <div class="grid cols-2">
        <div class="card pad">
          <div class="eyebrow" style={{ marginBottom: "12px" }}>{t("skillpkgs")}</div>
          {tb.skills.map((s: Skill) => (
            <div key={s.name} class="between tb-row">
              <div><b>{s.name}</b><div class="sub">{s.when}</div></div>
              <span class="tag">{s.repos.join(", ")}</span>
            </div>
          ))}
        </div>
        <div class="card pad">
          <div class="eyebrow" style={{ marginBottom: "12px" }}>{t("mcps")}</div>
          {tb.mcps.map((m: Mcp) => (
            <div key={m.name} class="between tb-row">
              <b>{m.name}</b>
              <span class="chip idle"><span class="d" />{m.scope}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function EquipeView() {
  const c = counts.value;
  const sub = `${t("team_sub_v2")} · ${t("work_sub").replace("{h}", String(c.hired)).replace("{a}", String(c.active)).replace("{i}", String(c.idle))}`;
  return (
    <div class="view-in grid" style={{ gap: "22px" }}>
      <div>
        <h1 class="view-h">{t("nav_team")}</h1>
        <div class="sub">{sub}</div>
      </div>
      <OrgSection />
      <RosterSection />
      <ToolboxSection />
    </div>
  );
}

export const route: Route = {
  path: "/team",
  nav: { label: "nav_team", icon: "team", order: 2 },
  component: EquipeView,
};
