// "Agora" — the home screen. Answers the governing question first: what needs
// you right now, and what is your team doing. Three zones by urgency (SDD §6.1):
//   1) Precisa de você — decisions only the PE can unblock (empty IS success).
//   2) Acontecendo agora — the specialists working this moment.
//   3) O quadro completo — the full four-column board + what others handle,
//      collapsed by default (progressive disclosure).
import { useEffect, useState } from "preact/hooks";
import { ConnBadge } from "../components/ConnBadge";
import { Icon } from "../components/Icon";
import { Avatar } from "../components/Avatar";
import { Board } from "../components/Board";
import { ActionRow } from "../components/DecisionInbox";
import { t } from "../runtime/i18n";
import { fqidOf } from "../runtime/dom";
import { decisions, observations, dispatches, sessions, openWorkerName, pinnedDispatch } from "../runtime/store";
import { buildBoard } from "../runtime/board";
import type { Route } from "../route-types";

function NeedsYou() {
  const decs = decisions.value;
  return (
    <section class="zone zone-needs" aria-label={t("now_needs_you")}>
      <header class="zone-h">
        <div>
          <h2 class="zone-title">{t("now_needs_you")}</h2>
          <div class="zone-sub">{t("now_needs_you_sub")}</div>
        </div>
        {decs.length > 0 && <span class="zone-n num">{decs.length}</span>}
      </header>
      {decs.length === 0 ? (
        <div class="allclear">
          <span class="allclear-orb"><Icon name="check" size={20} title={t("now_allclear_h")} /></span>
          <div>
            <b>{t("now_allclear_h")}</b>
            <p class="sub">{t("now_allclear_p")}</p>
          </div>
        </div>
      ) : (
        <div class="zone-cards">
          {decs.map((it, i) => (
            <ActionRow key={`d|${it.kind}|${it.unit}|${it.journey}|${i}`} item={it} />
          ))}
        </div>
      )}
    </section>
  );
}

function HappeningNow() {
  const working = buildBoard(dispatches.value, sessions.value).find((g) => g.column === "working")?.cards ?? [];
  return (
    <section class="zone zone-happening" aria-label={t("now_happening")}>
      <header class="zone-h">
        <div>
          <h2 class="zone-title">{t("now_happening")}</h2>
          <div class="zone-sub">{t("now_happening_sub")}</div>
        </div>
        {working.length > 0 && <span class="zone-n num">{working.length}</span>}
      </header>
      {working.length === 0 ? (
        <div class="zone-empty sub">{t("now_happening_empty")}</div>
      ) : (
        <ul class="happening-list">
          {working.map((c, i) => {
            const name = String(c.dispatch.specialist ?? "—");
            return (
              <li key={i}>
                <button type="button" class="happening-row" onClick={() => (openWorkerName.value = name)}>
                  <Avatar name={name} />
                  <span class="happening-name">{name}</span>
                  <span class="tag">{fqidOf(c.dispatch)}</span>
                  {c.dispatch.task ? <span class="sub happening-task">· {c.dispatch.task}</span> : null}
                  {c.dispatch.liveness === "unknown" ? <span class="sub happening-flag">· {t("board_unknown")}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function WholeBoard() {
  const [open, setOpen] = useState(false);
  const obs = observations.value;
  return (
    <section class="zone zone-board" aria-label={t("board_title")}>
      <button type="button" class="board-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={16} />
        <span class="zone-title">{t("board_title")}</span>
        <span class="zone-sub">{open ? t("board_hide") : t("board_show")}</span>
      </button>
      {open && (
        <div class="board-wrap">
          <p class="zone-sub board-lead">{t("board_sub")}</p>
          <Board dispatches={dispatches.value} sessions={sessions.value} />
          {obs.length > 0 && (
            <div class="observations">
              <div class="zone-title obs-h">{t("now_observations")}</div>
              <div class="zone-sub">{t("now_observations_sub")}</div>
              <div class="zone-cards">
                {obs.map((it, i) => (
                  <ActionRow key={`o|${it.kind}|${it.unit}|${it.journey}|${i}`} item={it} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AgoraView() {
  // ESC clears the pinned dispatch (the coordinator wizard drill-down).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") pinnedDispatch.value = null;
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class="view-in grid" style={{ gap: "18px" }}>
      <div class="between">
        <div>
          <h1 class="view-h">{t("nav_now")}</h1>
          <div class="sub">{t("now_sub")}</div>
        </div>
        <ConnBadge />
      </div>
      <NeedsYou />
      <HappeningNow />
      <WholeBoard />
    </div>
  );
}

export const route: Route = {
  path: "/",
  nav: { label: "nav_now", icon: "floor", order: 0, badge: "escalation" },
  component: AgoraView,
};
