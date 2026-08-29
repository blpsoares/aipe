// A card on the Atividade board. It carries the seven fields the PE asked for —
// responsável, status, título, repositório (primary), and harness/modelo/effort
// (the envelope, secondary) — WITHOUT re-deriving anything: every field rides in
// on the dispatch (SDD §8). The card reads clean without AIPe vocabulary: who it
// is, what the task is, what state it's in, and — for a needs-you card — the
// copyable next step (the console is read-only, SDD §3).
//
// Hierarchy with eight fields (SDD §8): the primary line always reads; the
// envelope is quiet when it matches the board norm and only SHOUTS the exception
// (the model when it differs, a non-default harness, ultracode effort). A legacy
// record with no envelope shows none — absence is not an error.
import { t, stt } from "../runtime/i18n";
import { fqidOf } from "../runtime/dom";
import { Avatar } from "./Avatar";
import { Chip } from "./Chip";
import { Icon } from "./Icon";
import { CopyCmd } from "./CopyCmd";
import { openWorkerName } from "../runtime/store";
import { taskTitle, copyCommandFor, isEnvException, type Envelope } from "../runtime/activity";
import type { BoardCard } from "../runtime/board";

const ACTOR_KEY: Record<string, string> = { you: "board_actor_you", dev: "board_actor_dev", coord: "board_actor_coord" };

function Envelope_({ card, norm }: { card: BoardCard; norm: Envelope }) {
  const d = card.dispatch;
  const model = typeof d.model === "string" ? d.model.replace(/^claude-/, "") : null;
  const harnessExc = isEnvException(d.harness, norm.harness);
  const effortExc = d.intensity === "ultracode"; // the effort exception observed in the wild
  // Nothing to say (legacy record, no envelope) → render nothing, cleanly.
  if (!model && !harnessExc && !effortExc) return null;
  const modelExc = isEnvException(d.model, norm.model);
  return (
    <div class="ac-env">
      {model ? <span class={`ac-env-i${modelExc ? " is-exc" : ""}`}>{model}</span> : null}
      {harnessExc ? <span class="ac-env-i is-exc">{d.harness}</span> : null}
      {effortExc ? <span class="ac-env-i is-exc"><Icon name="bolt" size={11} /> {t("ac_effort_ultra")}</span> : null}
    </div>
  );
}

export function ActivityCard({ card, norm }: { card: BoardCard; norm: Envelope }) {
  const d = card.dispatch;
  const name = String(d.specialist ?? "—");
  const actor = card.actor ? t(ACTOR_KEY[card.actor] ?? "board_actor_you") : null;
  const cmd = copyCommandFor(d);
  // The copyable next step shows where acting IS the next step — the needs-you
  // cards — extending the Floor-actionable pattern (#26), never on a card at rest.
  const showCmd = card.column === "needs-you" && cmd;
  return (
    <div class={`acard actor-${card.actor ?? "none"}`}>
      <button type="button" class="acard-open" onClick={() => (openWorkerName.value = name)}>
        <div class="ac-head">
          <Avatar name={name} />
          <span class="ac-name">{name}</span>
          <Chip status={d.status} />
        </div>
        <div class="ac-title" title={taskTitle(d)}>{taskTitle(d)}</div>
        <div class="ac-meta">
          <span class="tag">{fqidOf(d)}</span>
          {d.journey ? <span class="ac-journey sub">· {d.journey}</span> : null}
        </div>
        <Envelope_ card={card} norm={norm} />
        {actor ? (
          <div class="ac-actor sub">
            <span class="ac-k">{t("board_actor_pre")}</span> <b>{actor}</b>
          </div>
        ) : null}
      </button>
      {typeof d.pr === "string" && d.pr ? (
        <a class="ac-pr link" href={d.pr} target="_blank" rel="noreferrer">
          {t("card_pr")} ↗
        </a>
      ) : null}
      {showCmd ? <CopyCmd command={cmd} /> : null}
    </div>
  );
}
