import { t } from "../runtime/i18n";
import type { Route } from "../route-types";

// STUB — filled in by Task 16.
function ToolboxView() {
  return (
    <div class="view-in">
      <h1 class="view-h">{t("nav_toolbox")}</h1>
    </div>
  );
}

export const route: Route = {
  path: "/toolbox",
  nav: { label: "nav_toolbox", icon: "⬡", order: 4 },
  component: ToolboxView,
};
