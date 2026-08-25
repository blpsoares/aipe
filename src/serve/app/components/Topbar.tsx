import { routes } from "../routes.generated";
import type { Route } from "../route-types";
import { t } from "../runtime/i18n";
import { currentPath } from "../runtime/router";
import { toggleMobileOpen } from "../runtime/ui";
import { ConnBadge } from "./ConnBadge";
import { LangSwitch } from "./LangSwitch";
import { ThemeToggle } from "./ThemeToggle";
import { Icon } from "./Icon";

const appRoutes = routes as Route[];

export interface TopbarProps {
  /** Task 9 fills the real command palette; this is its open seam. */
  onOpenCommandPalette?: () => void;
}

export function Topbar({ onOpenCommandPalette }: TopbarProps = {}) {
  const path = currentPath.value;
  const active = appRoutes.find((r) => r.path === path);
  const title = active ? t(active.nav.label) : t("nav_overview");

  return (
    <div class="topbar">
      <button type="button" class="icon-btn" id="hamb" onClick={toggleMobileOpen}>
        <Icon name="menu" title={t("open_menu")} />
      </button>
      <div>
        <div class="tb-title" id="tbTitle">
          {title}
        </div>
      </div>
      <button type="button" class="cmdk" id="cmdkBtn" onClick={() => onOpenCommandPalette?.()}>
        <Icon name="search" title={t("search")} size={15} />
        <span class="lbl2">{t("search")}</span>
        <span class="kbd" style="margin-left:auto">
          ⌘K
        </span>
      </button>
      <ConnBadge />
      <LangSwitch />
      <ThemeToggle />
    </div>
  );
}
