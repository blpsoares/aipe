import { t } from "../runtime/i18n";
import type { Route } from "../route-types";

// STUB — filled in by Task 14.
function PipelineView() {
  return (
    <div class="view-in">
      <h1 class="view-h">{t("nav_pipeline")}</h1>
    </div>
  );
}

export const route: Route = {
  path: "/pipeline",
  nav: { label: "nav_pipeline", icon: "▦", order: 2 },
  component: PipelineView,
};
