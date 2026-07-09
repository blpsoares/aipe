import { t } from "../runtime/i18n";
import type { Route } from "../route-types";

// STUB — filled in by Task 11. Establishes the views/*.view.tsx convention
// that genRoutes() (build-client.ts) globs into routes.generated.ts.
function OverviewView() {
  return (
    <div class="view-in">
      <h1 class="view-h">{t("nav_overview")}</h1>
    </div>
  );
}

export const route: Route = {
  path: "/overview",
  nav: { label: "nav_overview", icon: "◎", order: 0 },
  component: OverviewView,
};
