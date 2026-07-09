// The mobile organogram: a vertical tree (coordinator -> repo/monorepo cards
// -> specialist rows), colored by state like the SVG but avoiding its wide
// horizontal layout. Ported 1:1 from renderOrgTree (app.html:982-1000).
import { snapshot, openWorkerName } from "../runtime/store";
import { t } from "../runtime/i18n";
import { orgColor, orgRepoVisible, orgWorkersFor } from "../runtime/org";
import { Avatar } from "./Avatar";
import { Chip } from "./Chip";

export function OrgTree() {
  const s = snapshot.value;
  const coord = s.context.coordinator || "coordinator";
  const repos = s.repos.filter((r) => orgRepoVisible(s.workers, r.name));

  if (repos.length === 0) {
    return (
      <div class="otree">
        <div class="sub" style={{ padding: "16px 4px" }}>
          {t("org_nomatch")}
        </div>
      </div>
    );
  }

  return (
    <div class="otree">
      <div class="ot-coord">
        <span class="ot-dot" style={{ background: "var(--accent)" }} />
        <div>
          <div class="ot-name">{coord}</div>
          <div class="ot-sub">coordinator</div>
        </div>
      </div>
      <div class="ot-branches">
        {repos.map((r) => {
          const mono = r.packages.length > 0;
          const people = orgWorkersFor(s.workers, r.name);
          const kindLbl = mono ? `${t("t_monorepo")}${r.kind ? " · " + r.kind : ""}` : r.kind || t("t_repo");
          return (
            <div key={r.name} class={`ot-repo${mono ? " mono" : ""}`}>
              <div class="ot-rhead">
                <span class="ot-rname">{r.name}</span>
                <span class="ot-kind">{kindLbl}</span>
              </div>
              <div class="ot-people">
                {people.length ? (
                  people.map((w) => (
                    <button
                      key={w.name}
                      class="ot-person"
                      onClick={() => {
                        // seam mirrored from openWorker(): sets the shared
                        // openWorkerName signal the WorkerDrawer renders off.
                        openWorkerName.value = w.name;
                      }}
                    >
                      <span class="ot-pdot" style={{ background: orgColor(w.status) }} />
                      <Avatar name={w.name} />
                      <span class="ot-pmeta">
                        <span class="ot-pname">{w.name}</span>
                        <span class="ot-prole">{w.package ? `${w.role} · ${w.package}` : w.role}</span>
                      </span>
                      <Chip status={w.status || ""} />
                    </button>
                  ))
                ) : (
                  <div class="sub" style={{ padding: "8px 13px" }}>
                    {t("nospec")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
