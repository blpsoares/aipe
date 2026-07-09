import { t } from "../runtime/i18n";
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

// app.html:766-772 (workers view).
function TeamView() {
  const c = counts.value;
  const sub = t("work_sub").replace("{h}", String(c.hired)).replace("{a}", String(c.active)).replace("{i}", String(c.idle));
  return (
    <div class="view-in grid" style={{ gap: "16px" }}>
      <div class="between">
        <div>
          <h1 class="view-h">{t("nav_workers")}</h1>
          <div class="sub">{sub}</div>
        </div>
        <div class="row">
          <button class="btn btn-ghost">{t("all")}</button>
          <button class="btn btn-primary">{t("dispatch")}</button>
        </div>
      </div>
      <div class="cvgrid">
        {snapshot.value.workers.map((w) => (
          <WorkerCard key={w.name} w={w} />
        ))}
      </div>
    </div>
  );
}

export const route: Route = {
  path: "/team",
  nav: { label: "nav_workers", icon: "◑", order: 3 },
  component: TeamView,
};
