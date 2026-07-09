import { t } from "../runtime/i18n";
import type { Route } from "../route-types";

// STUB — filled in by Task 18.
function MonitorView() {
  return (
    <div class="view-in">
      <h1 class="view-h">{t("nav_monitor")}</h1>
    </div>
  );
}

export const route: Route = {
  path: "/monitor",
  nav: { label: "nav_monitor", icon: "◉", order: 6 },
  component: MonitorView,
};
