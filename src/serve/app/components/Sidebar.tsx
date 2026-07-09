import { routes } from "../routes.generated";
import type { Route } from "../route-types";
import { t } from "../runtime/i18n";
import { counts, brandCtx } from "../runtime/store";
import { currentPath, navigate } from "../runtime/router";
import { toggleCollapsed } from "../runtime/ui";

const appRoutes = routes as Route[];
const settingsRoute = appRoutes.find((r) => r.path === "/settings");
// Settings lives in the footer (app.html:469), not the main nav list.
const mainRoutes = appRoutes.filter((r) => r.path !== "/settings");

export function Sidebar() {
  const path = currentPath.value;
  const escalated = counts.value.escalated;

  return (
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <div class="mark">A</div>
        <div class="name">
          AIPe<small id="brandCtx">{brandCtx.value}</small>
        </div>
      </div>
      {mainRoutes.map((r) => (
        <button type="button" key={r.path} class={`nav-i${path === r.path ? " on" : ""}`} onClick={() => navigate(r.path)}>
          <span class="ic">{r.nav.icon}</span>
          <span>{t(r.nav.label)}</span>
          {r.nav.badge === "escalation" && escalated > 0 && (
            <span class="badge" id="navBadge">
              {escalated}
            </span>
          )}
        </button>
      ))}
      <div class="sb-foot">
        {settingsRoute && (
          <button
            type="button"
            class={`nav-i${path === settingsRoute.path ? " on" : ""}`}
            onClick={() => navigate(settingsRoute.path)}
          >
            <span class="ic">{settingsRoute.nav.icon}</span>
            <span>{t(settingsRoute.nav.label)}</span>
          </button>
        )}
        <button type="button" class="nav-i" id="collapseBtn" onClick={toggleCollapsed}>
          <span class="ic">⇤</span>
          <span class="lbl">{t("collapse")}</span>
        </button>
      </div>
    </aside>
  );
}
