import { routes } from "../routes.generated";
import type { Route } from "../route-types";
import { t } from "../runtime/i18n";
import { attentionCount, attentionHasCritical } from "../runtime/store";
import { currentPath, navigate } from "../runtime/router";
import { Icon } from "./Icon";

// Mobile tabbar — the 3 primary screens (Agora / Equipe / Histórico). Derived
// from `routes` (already order-sorted) so it stays in sync with the view set.
const items = (routes as Route[]).filter((r) => r.nav.group !== "footer");

export function BottomNav() {
  const path = currentPath.value;
  const attention = attentionCount.value;
  const crit = attentionHasCritical.value;

  return (
    <nav class="tabbar" id="tabbar">
      {items.map((r) => (
        <button type="button" key={r.path} class={path === r.path ? "on" : ""} onClick={() => navigate(r.path)}>
          <Icon name={r.nav.icon} title={t(r.nav.label)} />
          <span>{t(r.nav.label)}</span>
          {r.nav.badge === "escalation" && attention > 0 && <span class={`tbadge${crit ? " crit" : ""}`} />}
        </button>
      ))}
    </nav>
  );
}
