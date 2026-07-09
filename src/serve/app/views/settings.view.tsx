import { t } from "../runtime/i18n";
import type { Route } from "../route-types";

// STUB — filled in by a later task. Settings sits in the sidebar footer, not
// the main nav list (Sidebar.tsx), but is still a normal routed view.
function SettingsView() {
  return (
    <div class="view-in">
      <h1 class="view-h">{t("nav_settings")}</h1>
    </div>
  );
}

export const route: Route = {
  path: "/settings",
  nav: { label: "nav_settings", icon: "⚙", order: 7 },
  component: SettingsView,
};
