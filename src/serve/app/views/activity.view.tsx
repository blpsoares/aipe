import { t } from "../runtime/i18n";
import { activity } from "../runtime/store";
import { ActivityFeed } from "../components/ActivityFeed";
import type { Route } from "../route-types";

// app.html:786-791
function ActivityView() {
  return (
    <div class="view-in grid" style={{ gap: "16px" }}>
      <div class="between">
        <div>
          <h1 class="view-h">{t("nav_activity")}</h1>
          <div class="sub">{t("act_sub")}</div>
        </div>
        <span class="conn">
          <span class="dot" />
          {t("streaming")}
        </span>
      </div>
      <div class="card pad">
        <ActivityFeed events={activity.value} />
      </div>
    </div>
  );
}

export const route: Route = {
  path: "/activity",
  nav: { label: "nav_activity", icon: "⧗", order: 5, badge: "escalation" },
  component: ActivityView,
};
