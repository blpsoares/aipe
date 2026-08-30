// "Quadro" — the whole board, now a primary screen with its own route
// (j-20260830-sk). Before this journey the board lived folded into "Agora" as a
// collapsible section (SDD §5, decision A); the PE asked for it to become a page
// reachable from the nav, using the full viewport width.
//
// Decision (where the board page enters): a FOURTH primary screen, not a
// re-shuffle of the approved Agora/Equipe/Histórico map. Agora stays the
// urgency-first inbox (Precisa de você / Acontecendo agora / Observações); the
// board — the full "tipo um Jira" surface — gets the whole viewport it always
// wanted. Keeping the board ALSO inside Agora would duplicate one context in two
// places, which the brief's "um contexto por lugar" forbids; so the section left
// Agora and lives only here. Here it is ALWAYS visible — no toggle to discover,
// which is precisely the "board born hidden" defect r5 fixed, now made
// structural rather than defaulted. The board CONTENT is unchanged: the same
// <WorkBoard/> (its Integrados merge-truth, tri-state signal, server-owned
// no-network payload) reused verbatim — only its home changed.
import { ConnBadge } from "../components/ConnBadge";
import { WorkBoard } from "../components/WorkBoard";
import { t } from "../runtime/i18n";
import type { Route } from "../route-types";

function QuadroView() {
  return (
    // .view-wide opts out of .view-in's 1180px reading column so the board uses
    // the full viewport; the board scrolls horizontally (.aboard) only when its
    // columns genuinely overflow, never inside a permanently-narrow container.
    <div class="view-in view-wide grid" style={{ gap: "14px" }}>
      <div class="between">
        <div>
          <h1 class="view-h">{t("nav_board")}</h1>
          <div class="sub">{t("board_sub")}</div>
        </div>
        <ConnBadge />
      </div>
      <WorkBoard />
    </div>
  );
}

export const route: Route = {
  path: "/board",
  nav: { label: "nav_board", icon: "board", order: 1, badge: "escalation" },
  component: QuadroView,
};
