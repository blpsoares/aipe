// The four-column live board (SDD §11) — rendered from the pure buildBoard
// derivation. Each card carries the persona, the state, the task, the branch and
// the PR TOGETHER, so the PE never switches screens to complete the picture.
import { t } from "../runtime/i18n";
import { fqidOf } from "../runtime/dom";
import { statusMeta } from "../runtime/statusMeta";
import { StatusIcon } from "./StatusIcon";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { openWorkerName, type Dispatch } from "../runtime/store";
import { buildBoard, BOARD_COLUMNS, type BoardCard, type BoardColumn, type BoardActor } from "../runtime/board";
import type { SessionInfo } from "../../sessions";

const COL_TITLE: Record<BoardColumn, string> = {
  working: "board_col_working",
  "needs-you": "board_col_needs_you",
  "in-review": "board_col_in_review",
  ready: "board_col_ready",
  integrated: "board_col_integrated",
};
const COL_SUB: Record<BoardColumn, string> = {
  working: "board_col_working_sub",
  "needs-you": "board_col_needs_you_sub",
  "in-review": "board_col_in_review_sub",
  ready: "board_col_ready_sub",
  integrated: "board_col_integrated_sub",
};
const ACTOR_KEY: Record<BoardActor, string> = { you: "board_actor_you", dev: "board_actor_dev", coord: "board_actor_coord" };

function CardNote({ card }: { card: BoardCard }) {
  const d = card.dispatch;
  // The honest liveness footnotes, so the card never overclaims.
  if (card.waitingApproval) return <div class="bc-note you"><Icon name="flag" size={12} /> {t("board_waiting_approval")}</div>;
  if (d.liveness === "dead-silent") return <div class="bc-note warn"><Icon name="warn" size={12} /> {t("board_deadsilent")}</div>;
  if (d.liveness === "unknown") return <div class="bc-note muted">{t("board_unknown")}</div>;
  return null;
}

function Card({ card }: { card: BoardCard }) {
  const d = card.dispatch;
  const name = String(d.specialist ?? "—");
  const actor = card.actor ? t(ACTOR_KEY[card.actor]) : null;
  return (
    <button type="button" class={`bcard actor-${card.actor ?? "none"}`} onClick={() => (openWorkerName.value = name)}>
      <div class="bc-head">
        <Avatar name={name} />
        <span class="bc-name">{name}</span>
        <span class="bc-chip" title={t(statusMeta(d.status).descKey)}>
          <StatusIcon k={d.status} size={12} />
        </span>
      </div>
      <div class="bc-meta">
        <span class="tag">{fqidOf(d)}</span>
        {d.task ? <span class="bc-task">· {d.task}</span> : null}
      </div>
      {d.branch ? <div class="bc-branch"><span class="bc-k">{t("card_branch")}</span> <code>{d.branch}</code></div> : null}
      {card.actor ? <div class="bc-actor"><span class="bc-k">{t("board_actor_pre")}</span> <b>{actor}</b></div> : null}
      <CardNote card={card} />
      {typeof d.pr === "string" && d.pr ? (
        <a class="bc-pr link" href={d.pr} target="_blank" rel="noreferrer" onClick={(e: MouseEvent) => e.stopPropagation()}>
          {t("card_pr")} ↗
        </a>
      ) : null}
    </button>
  );
}

export function Board({ dispatches, sessions }: { dispatches: Dispatch[]; sessions: SessionInfo[] }) {
  const groups = buildBoard(dispatches, sessions);
  const byCol = Object.fromEntries(groups.map((g) => [g.column, g.cards])) as Record<BoardColumn, BoardCard[]>;
  return (
    <div class="board4" role="list">
      {BOARD_COLUMNS.map((col) => {
        const cards = byCol[col] ?? [];
        return (
          <section key={col} class={`bcol bcol-${col}`} role="listitem" aria-label={t(COL_TITLE[col])}>
            <header class="bcol-head">
              <div class="bcol-title">
                <span class="bcol-dot" />
                {t(COL_TITLE[col])}
                <span class="bcol-count num">{cards.length}</span>
              </div>
              <div class="bcol-sub">{t(COL_SUB[col])}</div>
            </header>
            <div class="bcol-body">
              {cards.length ? cards.map((c, i) => <Card key={i} card={c} />) : <div class="bcol-empty sub">{t("board_col_empty")}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
