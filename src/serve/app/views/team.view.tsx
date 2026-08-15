import { useState } from "preact/hooks";
import { t, stt } from "../runtime/i18n";
import { snapshot, counts, openWorkerName, type Worker } from "../runtime/store";
import { cvOf, cvWork } from "../runtime/selectors";
import { Avatar } from "../components/Avatar";
import { Chip } from "../components/Chip";
import { UnitFacts } from "../components/UnitFacts";
import { CompChips } from "../components/CompChips";
import type { Route } from "../route-types";

// app.html:897-908 (cvCard). Card click opens the shared WorkerDrawer (Task 10)
// via the openWorkerName seam. `rowHTML` (app.html:863-869) is dead code and
// intentionally not ported.
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
      <div class="cvcomp">
        <CompChips list={cv.competences} max={4} />
      </div>
      <div class="cvstats">
        <span class="cvstat">
          <b>{work.delivered.length}</b>
          {t("cv_delivered")}
        </span>
        <span class="cvstat">
          <b>{work.inprog.length}</b>
          {t("cv_inprog")}
        </span>
      </div>
    </button>
  );
}

// #4 — group workers by project / activity (status) / specialty (role).
type GroupBy = "project" | "activity" | "specialty";
const GROUP_OPTIONS: GroupBy[] = ["project", "activity", "specialty"];

function groupKey(w: Worker, by: GroupBy): string {
  if (by === "project") return w.package ? `${w.repo}/${w.package}` : w.repo || "—";
  if (by === "activity") return w.status || "—";
  return w.role || "—"; // specialty
}

// Section label: raw for project (repo/pkg) and specialty (role); translated
// status label for activity.
function groupLabel(key: string, by: GroupBy): string {
  return by === "activity" ? stt(key) : key;
}

// Stable, intentional section order per dimension. `redirected` ties
// `escalated` for the top tier — both mean "this needs a look" — rather than
// falling through the `?? 99` default, which would have sorted it dead LAST,
// even after `available`: exactly backwards for a status whose entire point
// is to be loud.
const STATUS_RANK: Record<string, number> = { escalated: 0, redirected: 0, active: 1, delivered: 2, available: 3 };
const ROLE_RANK: Record<string, number> = { "dev-fullstack": 0, dev: 0, qa: 1 };
function sortGroups(entries: [string, Worker[]][], by: GroupBy): [string, Worker[]][] {
  const rank = by === "activity" ? STATUS_RANK : by === "specialty" ? ROLE_RANK : null;
  return entries.slice().sort((a, b) => {
    if (rank) return (rank[a[0]] ?? 99) - (rank[b[0]] ?? 99) || a[0].localeCompare(b[0]);
    return a[0].localeCompare(b[0]); // project: alphabetical
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

// app.html:766-772 (workers view) — the dead "All"/"+Dispatch" buttons are
// removed (the serve console is a read-only observation surface by design;
// dispatching happens in the CLI/coordinator flow, not the web).
function TeamView() {
  const c = counts.value;
  const [by, setBy] = useState<GroupBy>("project");
  const sub = t("work_sub").replace("{h}", String(c.hired)).replace("{a}", String(c.active)).replace("{i}", String(c.idle));
  const groups = groupWorkers(snapshot.value.workers, by);
  return (
    <div class="view-in grid" style={{ gap: "16px" }}>
      <div class="between">
        <div>
          <h1 class="view-h">{t("nav_workers")}</h1>
          <div class="sub">{sub}</div>
        </div>
        <div class="row" style={{ alignItems: "center", gap: "8px" }}>
          <span class="sub">{t("team_group")}</span>
          <div class="langseg team-groupby">
            {GROUP_OPTIONS.map((g) => (
              <button key={g} class={by === g ? "on" : ""} onClick={() => setBy(g)}>
                {t(`team_by_${g}`)}
              </button>
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
          <div class="cvgrid">
            {ws.map((w) => (
              <WorkerCard key={w.name} w={w} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export const route: Route = {
  path: "/team",
  nav: { label: "nav_workers", icon: "◑", order: 3 },
  component: TeamView,
};
