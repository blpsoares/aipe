// The four-column live board (SDD §11) — the collapsible section inside "Agora".
// It answers the PE's real question by grouping every live unit of work into the
// column that says what it needs, with each card carrying task/persona/branch/PR/
// state TOGETHER (rendered by the component off the Dispatch).
//
// It CONSUMES the canonical liveness the server already computed (`d.liveness`,
// the same `dispatchPhase` `aipe status` runs — serve/payload.ts) rather than
// re-deriving an optimistic reading. Two known traps are handled here:
//   • waiting-approval (armadilha 1): a live session whose agentop `activity` is
//     "waiting" is waiting on a PERSON — it belongs in "needs you", not "working".
//     We only read agentop's already-debounced `activity` (the #243 asymmetry),
//     never invent a fresh optimistic read.
//   • dispatched ≠ alive (armadilha 2): a dead record surfaces as `dead-silent`
//     via the server cross-check, so it lands in "needs you", never "working".
import { sessionFor } from "./floor";
import type { Dispatch } from "./store";
import type { SessionInfo } from "../../sessions";

export type BoardColumn = "working" | "needs-you" | "in-review" | "ready";

// Left-to-right order: what is moving → what is stuck on a human → what is under
// review → what is ready to land.
export const BOARD_COLUMNS: BoardColumn[] = ["working", "needs-you", "in-review", "ready"];

export type BoardActor = "you" | "dev" | "coord";

export interface BoardCard {
  dispatch: Dispatch;
  column: BoardColumn;
  /** Who acts next — only set for "needs you" cards; null everywhere else. */
  actor: BoardActor | null;
  /** A live session that is waiting on a person (agentop activity "waiting"). */
  waitingApproval: boolean;
}

export interface BoardGroup {
  column: BoardColumn;
  cards: BoardCard[];
}

/** A live session that is waiting on a person (not just mid-tool-call). */
function isWaitingApproval(d: Dispatch, session?: SessionInfo): boolean {
  return d.liveness === "running" && session?.status === "running" && session?.activity === "waiting";
}

/**
 * The column a dispatch belongs to, or null when it is off the board (merged /
 * removed — that is history, not live work; it lives in Histórico). See §11.2.
 */
export function columnOf(d: Dispatch, session?: SessionInfo): BoardColumn | null {
  switch (d.status) {
    case "merged":
    case "removed":
      return null;
    case "verified":
      return "ready";
    case "delivered":
      return "in-review";
    case "failed":
    case "escalated":
    case "blocked":
    case "redirected":
      return "needs-you";
  }
  // status === "dispatched" (or any live status): the canonical liveness decides.
  if (d.liveness === "dead-silent" || d.liveness === "waiting" || d.liveness === "redirected") return "needs-you";
  if (isWaitingApproval(d, session)) return "needs-you";
  // running (working), unknown (cannot verify — never claimed dead), or a
  // subagent with no liveness: all "working". `unknown` is flagged in the card.
  return "working";
}

/** Who acts next on a "needs you" card — so the view can recede what is not the PE's. */
export function boardActor(d: Dispatch, session?: SessionInfo): BoardActor | null {
  if (columnOf(d, session) !== "needs-you") return null;
  if (d.status === "escalated") return "you";
  if (d.status === "failed") return "dev";
  if (d.status === "blocked") return "coord";
  if (d.status === "redirected") return "coord";
  if (d.liveness === "dead-silent") return "you"; // inspect; kill/re-dispatch is the PE's call
  if (isWaitingApproval(d, session)) return "you"; // waiting on a person
  return "you";
}

// PE-owned items ("you") rise to the top of the "needs you" column so the PE's
// attention is spent on what only they can unblock (armadilha 1).
const ACTOR_RANK: Record<BoardActor, number> = { you: 0, dev: 1, coord: 2 };

/** Group all dispatches into the four columns, in order. Off-board units drop out. */
export function buildBoard(dispatches: Dispatch[], sessions: SessionInfo[]): BoardGroup[] {
  const cards: Record<BoardColumn, BoardCard[]> = { working: [], "needs-you": [], "in-review": [], ready: [] };
  for (const d of dispatches) {
    const session = sessionFor(d, sessions);
    const column = columnOf(d, session);
    if (!column) continue;
    cards[column].push({ dispatch: d, column, actor: boardActor(d, session), waitingApproval: isWaitingApproval(d, session) });
  }
  cards["needs-you"].sort((a, b) => ACTOR_RANK[a.actor ?? "you"] - ACTOR_RANK[b.actor ?? "you"]);
  return BOARD_COLUMNS.map((column) => ({ column, cards: cards[column] }));
}
