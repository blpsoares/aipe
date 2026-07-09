// Ported 1:1 from views.org (app.html:741-759). Header + toolbar (search +
// zoom/reset/fullscreen controls) + the org-stage (desktop SVG / mobile tree)
// + the legend.
import { useEffect } from "preact/hooks";
import { t } from "../runtime/i18n";
import { orgQuery, orgTransform, zoomBy, toggleFullscreen } from "../runtime/org";
import { ConnBadge } from "../components/ConnBadge";
import { OrgChart } from "../components/OrgChart";
import { OrgTree } from "../components/OrgTree";
import { OrgLegend } from "../components/OrgLegend";
import type { Route } from "../route-types";

// app.html:1021-1027 — the toolbar's zoom buttons read the wrap element's
// current size directly (mirrors the monolith's getElementById("orgwrap")),
// since OrgChart owns the ref and the buttons live outside it.
function handleZoom(dir: number) {
  const wrap = document.getElementById("orgwrap");
  const size = wrap ? wrap.getBoundingClientRect() : { width: 0, height: 0 };
  zoomBy(dir, size);
}

function handleFullscreen() {
  toggleFullscreen(document.getElementById("orgstage"));
}

function OrgView() {
  const q = orgQuery.value;

  // app.html:1013 — fullscreenchange resets pan/zoom (whichever direction the
  // transition goes, enter or exit).
  useEffect(() => {
    function onFullscreenChange() {
      orgTransform.value = { s: 1, x: 0, y: 0 };
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  return (
    <div class="view-in grid" style={{ gap: "16px" }}>
      <div class="between">
        <div>
          <h1 class="view-h">{t("nav_org")}</h1>
          <div class="sub">{t("org_sub")}</div>
        </div>
        <ConnBadge />
      </div>
      <div class="org-toolbar">
        <label class="org-search">
          <span class="ic" aria-hidden="true">
            🔍
          </span>
          <input
            id="orgSearch"
            type="search"
            value={q}
            placeholder={t("org_search_ph")}
            aria-label={t("org_search_ph")}
            autocomplete="off"
            spellcheck={false}
            onInput={(e) => {
              orgQuery.value = (e.target as HTMLInputElement).value.trim().toLowerCase();
            }}
          />
        </label>
        <div class="org-ctrls" role="group" aria-label={t("org_zoom")}>
          <button class="icon-btn" onClick={() => handleZoom(-1)} title={t("org_zoom_out")} aria-label={t("org_zoom_out")}>
            −
          </button>
          <button class="icon-btn" onClick={() => handleZoom(1)} title={t("org_zoom_in")} aria-label={t("org_zoom_in")}>
            +
          </button>
          <button class="icon-btn" onClick={() => handleZoom(0)} title={t("org_reset")} aria-label={t("org_reset")}>
            ⟲
          </button>
          <button class="icon-btn" onClick={handleFullscreen} title={t("org_fullscreen")} aria-label={t("org_fullscreen")}>
            ⛶
          </button>
        </div>
      </div>
      <div class="org-stage" id="orgstage">
        <div class="card org-desktop">
          <OrgChart />
        </div>
        <div class="org-mobile">
          <OrgTree />
        </div>
      </div>
      <OrgLegend />
    </div>
  );
}

export const route: Route = {
  path: "/org",
  nav: { label: "nav_org", icon: "◈", order: 1 },
  component: OrgView,
};
