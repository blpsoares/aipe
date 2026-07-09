import { t } from "../runtime/i18n";
import type { Route } from "../route-types";

// STUB — filled in by Task 15.
function TeamView() {
  return (
    <div class="view-in">
      <h1 class="view-h">{t("nav_workers")}</h1>
    </div>
  );
}

export const route: Route = {
  path: "/team",
  nav: { label: "nav_workers", icon: "◑", order: 3 },
  component: TeamView,
};
