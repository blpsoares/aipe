import { routes } from "../routes.generated";
import type { Route } from "../route-types";
import { t } from "../runtime/i18n";
import { counts } from "../runtime/store";
import { currentPath, navigate } from "../runtime/router";

// Mobile tabbar (app.html:492-499) — only these 5, in this order (terminal
// removed). Deriving from `routes` (already order-sorted) rather than
// hardcoding icons/labels keeps this in sync with the view stubs.
const BOTTOM_PATHS = ["/overview", "/pipeline", "/team", "/activity", "/monitor"];
const items = (routes as Route[]).filter((r) => BOTTOM_PATHS.includes(r.path));

export function BottomNav() {
  const path = currentPath.value;
  const escalated = counts.value.escalated;

  return (
    <nav class="tabbar" id="tabbar">
      {items.map((r) => (
        <button type="button" key={r.path} class={path === r.path ? "on" : ""} onClick={() => navigate(r.path)}>
          <span class="ic">{r.nav.icon}</span>
          <span>{t(r.nav.label)}</span>
          {r.nav.badge === "escalation" && escalated > 0 && <span class="tbadge" />}
        </button>
      ))}
    </nav>
  );
}
