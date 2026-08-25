import { routes } from "../routes.generated";
import type { Route } from "../route-types";
import { t } from "../runtime/i18n";
import { attentionCount, attentionHasCritical, brandCtx } from "../runtime/store";
import { currentPath, navigate } from "../runtime/router";
import { toggleCollapsed } from "../runtime/ui";
import { Icon } from "./Icon";

const appRoutes = routes as Route[];
const settingsRoute = appRoutes.find((r) => r.path === "/settings");
// Settings lives in the footer (app.html:469), not the main nav list.
const mainRoutes = appRoutes.filter((r) => r.path !== "/settings");

export function Sidebar() {
  const path = currentPath.value;
  const attention = attentionCount.value;
  const crit = attentionHasCritical.value;

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
          <Icon name={r.nav.icon} title={t(r.nav.label)} />
          <span>{t(r.nav.label)}</span>
          {r.nav.badge === "escalation" && attention > 0 && (
            <span class={`badge${crit ? " crit" : ""}`} id="navBadge" title={t("needs_attention")}>
              {attention}
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
            <Icon name={settingsRoute.nav.icon} title={t(settingsRoute.nav.label)} />
            <span>{t(settingsRoute.nav.label)}</span>
          </button>
        )}
        <button type="button" class="nav-i" id="collapseBtn" onClick={toggleCollapsed}>
          <Icon name="collapse" title={t("collapse")} />
          <span class="lbl">{t("collapse")}</span>
        </button>
      </div>
    </aside>
  );
}
