// The global specialist drawer — ported from openWorker/closeDrawer
// (app.html:1203-1230). Mounted once in the shell (main.tsx); opened by
// Team cards, Pipeline cards, and the Command Palette by setting
// `openWorkerName` (Task 9 seam). `rowHTML` (app.html:863-869, dead code —
// never called) is intentionally NOT ported.
import { openWorkerName, snapshot, type Dispatch } from "../runtime/store";
import { t } from "../runtime/i18n";
import { fqid } from "../runtime/dom";
import { Avatar } from "./Avatar";
import { Chip } from "./Chip";
import { CompChips } from "./CompChips";
import { UnitFacts } from "./UnitFacts";
import { cvOf, cvWork } from "../runtime/selectors";

interface Relation {
  from: string;
  to: string;
  type: string;
}

interface WorktreeRow {
  repo: string;
  branch: string;
}

// app.html:1209 — one row of the in-progress/delivered lists.
function WorkRow({ d }: { d: Dispatch }) {
  return (
    <div class="row" style={{ gap: "8px", justifyContent: "space-between", padding: "6px 0" }}>
      <span class="row" style={{ gap: "8px" }}>
        <Chip status={d.status} />
        <span class="sub">{d.journey}</span>
      </span>
      {d.pr ? (
        <a class="link" href={String(d.pr)} target="_blank" rel="noreferrer">
          PR ↗
        </a>
      ) : null}
    </div>
  );
}

export function WorkerDrawer() {
  const name = openWorkerName.value;
  // app.html:1204 — no-op if the name doesn't resolve to a known worker.
  const w = name ? snapshot.value.workers.find((x) => x.name === name) : undefined;
  const open = !!w;

  function close() {
    openWorkerName.value = null;
  }

  if (!w) {
    return (
      <>
        <div class="scrim" />
        <aside class="drawer" />
      </>
    );
  }

  const cv = cvOf(w.name);
  const work = cvWork(w.name);
  const rel = (snapshot.value.relations as Relation[]).filter((e) => e.from === w.repo || e.to === w.repo);
  const wts = (snapshot.value.worktrees as WorktreeRow[]).filter((r) => r.repo === w.repo);

  return (
    <>
      <div class={`scrim${open ? " on" : ""}`} onClick={close} />
      <aside class={`drawer${open ? " on" : ""}`}>
        <div id="drawerContent">
          <header>
            <Avatar name={w.name} />
            <div style={{ flex: 1 }}>
              <h3>{w.name}</h3>
              <div class="sub2">
                {cv.title || w.role} · {fqid(w)}
              </div>
            </div>
            <button class="icon-btn" onClick={close}>
              ✕
            </button>
          </header>
          <div class="body">
            <UnitFacts worker={w} />
            <dl class="dl">
              <dt>{t("d_status")}</dt>
              <dd>
                <Chip status={w.status || ""} />
              </dd>
              {w.journey ? (
                <>
                  <dt>{t("d_journey")}</dt>
                  <dd>{w.journey}</dd>
                </>
              ) : null}
              {w.pr ? (
                <>
                  <dt>{t("d_pr")}</dt>
                  <dd>
                    <a class="link" href={String(w.pr)} target="_blank" rel="noreferrer">
                      PR ↗
                    </a>
                  </dd>
                </>
              ) : null}
            </dl>
            {cv.bio ? (
              <p class="cvbio" style={{ margin: "2px 0 0" }}>
                {cv.bio}
              </p>
            ) : null}
            <div>
              <h4 class="sec-h">{t("cv_competences")}</h4>
              <div class="cvcomp">
                <CompChips list={cv.competences} />
              </div>
            </div>
            <div>
              <h4 class="sec-h">
                {t("cv_inprog")} · {work.inprog.length}
              </h4>
              {work.inprog.length ? (
                <div class="mini">
                  {work.inprog.map((d, i) => (
                    <WorkRow key={i} d={d} />
                  ))}
                </div>
              ) : (
                <div class="sub">{t("none")}</div>
              )}
            </div>
            <div>
              <h4 class="sec-h">
                {t("cv_delivered")} · {work.delivered.length}
              </h4>
              {work.delivered.length ? (
                <div class="mini">
                  {work.delivered.map((d, i) => (
                    <WorkRow key={i} d={d} />
                  ))}
                </div>
              ) : (
                <div class="sub">{t("none")}</div>
              )}
            </div>
            <div>
              <h4 class="sec-h">{t("relations")}</h4>
              {rel.length ? (
                rel.map((e, i) => (
                  <div key={i} class="row" style={{ justifyContent: "space-between", padding: "7px 0" }}>
                    <span class="mono" style={{ fontSize: "12px" }}>
                      {e.from} → {e.to}
                    </span>
                    <span class="chip available">
                      <span class="d" />
                      {e.type}
                    </span>
                  </div>
                ))
              ) : (
                <div class="sub">{t("none")}</div>
              )}
            </div>
            {wts.length ? (
              <div>
                <h4 class="sec-h">
                  {t("worktree")} · {wts.length}
                </h4>
                <div class="mini">
                  {wts.map((r, i) => (
                    <div key={i} class="row">
                      <span class="mono" style={{ fontSize: "11.5px" }}>
                        {r.branch}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}
