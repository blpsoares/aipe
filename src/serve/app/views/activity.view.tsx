import { t } from "../runtime/i18n";
import type { Route } from "../route-types";

// STUB — filled in by Task 17.
function ActivityView() {
  return (
    <div class="view-in">
      <h1 class="view-h">{t("nav_activity")}</h1>
    </div>
  );
}

export const route: Route = {
  path: "/activity",
  nav: { label: "nav_activity", icon: "⧗", order: 5, badge: "escalation" },
  component: ActivityView,
};
