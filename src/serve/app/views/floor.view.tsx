// The Floor — the activity-oriented landing route. A pinned coordinator wizard
// (always visible), a scrolling floor of repo groups → specialist accordions,
// and a decision inbox rail. This replaces overview as the default view; the
// eight legacy views keep their routes and stay reachable from the nav.
import { useEffect, useState } from "preact/hooks";
import { WizardRail } from "../components/WizardRail";
import { DecisionInbox } from "../components/DecisionInbox";
import { RepoGroup } from "../components/RepoGroup";
import { ConnBadge } from "../components/ConnBadge";
import { dispatches, decisionInbox, pinnedDispatch, snapshot } from "../runtime/store";
import { t } from "../runtime/i18n";
import type { Route } from "../route-types";
import type { Dispatch } from "../runtime/store";

function byRepo(reps: Dispatch[]): { repo: string; items: Dispatch[] }[] {
  const map = new Map<string, Dispatch[]>();
  for (const d of reps) {
    const repo = String(d.repo ?? "—");
    map.set(repo, [...(map.get(repo) ?? []), d]);
  }
  const OPEN = new Set(["dispatched", "failed", "delivered", "escalated", "redirected"]);
  // Repos with open work first, then alphabetical.
  return [...map.entries()]
    .map(([repo, items]) => ({ repo, items, hasOpen: items.some((d) => OPEN.has(d.status)) }))
    .sort((a, b) => Number(b.hasOpen) - Number(a.hasOpen) || a.repo.localeCompare(b.repo))
    .map(({ repo, items }) => ({ repo, items }));
}

function FloorView() {
  const groups = byRepo(dispatches.value);
  const inboxCount = decisionInbox.value.length;
  const [inboxOpen, setInboxOpen] = useState(false);

  // ESC clears the pinned dispatch (drill-down happens in the rail, never navigates).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") pinnedDispatch.value = null;
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class="view-in">
      <div class="between" style={{ marginBottom: "10px" }}>
        <div>
          <h1 class="view-h">{t("floor_title")}</h1>
          <div class="sub">{t("floor_sub")}</div>
        </div>
        <ConnBadge />
      </div>

      <div class="floor-grid">
        <WizardRail />
        <div class="floor-scroll">
          {groups.length === 0 && <div class="repo-group" style={{ padding: "18px" }}>{snapshot.value.ok ? t("floor_empty") : t("floor_loading")}</div>}
          {groups.map((g) => (
            <RepoGroup key={g.repo} repo={g.repo} dispatches={g.items} />
          ))}
        </div>
        <DecisionInbox collapsed={!inboxOpen} />
      </div>

      {/* Mobile / tablet: a floating alarm button mirrors the inbox count. */}
      <button
        type="button"
        class={`inbox-fab${inboxCount === 0 ? " zero" : ""}`}
        onClick={() => setInboxOpen((v) => !v)}
        aria-label={t("floor_inbox")}
      >
        {inboxCount === 0 ? "✓" : `⚑ ${inboxCount}`}
      </button>
    </div>
  );
}

export const route: Route = {
  path: "/",
  nav: { label: "floor_nav", icon: "▚", order: -1, badge: "escalation" },
  component: FloorView,
};
