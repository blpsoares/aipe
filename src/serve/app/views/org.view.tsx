import { t } from "../runtime/i18n";
import type { Route } from "../route-types";

// STUB — filled in by Task 13.
function OrgView() {
  return (
    <div class="view-in">
      <h1 class="view-h">{t("nav_org")}</h1>
    </div>
  );
}

export const route: Route = {
  path: "/org",
  nav: { label: "nav_org", icon: "◈", order: 1 },
  component: OrgView,
};
