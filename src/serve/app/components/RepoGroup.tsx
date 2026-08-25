// One collapsible group per repo; inside, one accordion per dispatched
// specialist, grouped by fqid so a same-package serialization stacks with a
// "behind {specialist}" spur (the parallel-dispatch law made visible). Green
// (verified/merged/removed) units fold into a per-repo drawer so nothing green
// costs vertical space.
import { useState } from "preact/hooks";
import { conn, pinnedDispatch, sessions } from "../runtime/store";
import { t, stt } from "../runtime/i18n";
import { Chip } from "./Chip";
import { Icon } from "./Icon";
import {
  derivePhase,
  isGreenPhase,
  costIndexOf,
  serializedBehind,
  countsByStatus,
  sessionFor,
  fqidOf,
  type JourneyLike,
} from "../runtime/floor";
import { formatElapsed } from "../../present-time";
import type { Dispatch, Worker } from "../runtime/store";
import { snapshot } from "../runtime/store";

function journeyOf(d: Dispatch): JourneyLike | null {
  return ((snapshot.value.journeys ?? []) as JourneyLike[]).find((j) => j.id === d.journey) ?? null;
}

function elapsedMs(d: Dispatch): number {
  const j = journeyOf(d);
  const base = j?.updatedAt ? Date.parse(j.updatedAt) || 0 : 0;
  return base ? Date.now() - base : 0;
}

function activityLine(d: Dispatch): string {
  const s = sessionFor(d, sessions.value);
  if (s) {
    if (s.status === "exited") return t("floor_act_exited");
    if (s.activity === "working") return t("floor_act_working");
    if (s.activity === "waiting") return t("floor_act_waiting");
    return s.status;
  }
  return t(`sd_${d.status}`) || String(d.status);
}

function roleOf(specialist: string): string {
  const w = (snapshot.value.workers as Worker[]).find((x) => x.name?.toLowerCase() === specialist.toLowerCase());
  return w?.role ?? "";
}

function SpecialistRow({ d, all }: { d: Dispatch; all: Dispatch[] }) {
  const on = pinnedDispatch.value === d;
  const behind = serializedBehind(d, all);
  const c = costIndexOf(d);
  return (
    <button
      type="button"
      class={`spec-row${on ? " on" : ""}${behind ? " serialized" : ""}`}
      onClick={() => (pinnedDispatch.value = on ? null : d)}
    >
      <span class="persona">{String(d.specialist)}</span>
      <span class="role">{roleOf(String(d.specialist))}</span>
      <Chip status={String(d.status)} />
      <span class="activity">{behind ? <span class="behind">{t("floor_behind")} {behind}</span> : activityLine(d)}</span>
      <span class="elapsed">{formatElapsed(elapsedMs(d))}</span>
      {c.value !== null && <span class={`cost-chip${c.defaulted ? " defaulted" : ""}`}>×{c.value}</span>}
    </button>
  );
}

function GreenDrawer({ green }: { green: Dispatch[] }) {
  const [open, setOpen] = useState(false);
  if (green.length === 0) return null;
  return (
    <div class="green-drawer">
      <button type="button" class="green-head" onClick={() => setOpen(!open)}>
        <span class="dot" />
        {green.length} {t("floor_landed")} {open ? "▾" : "▸"}
      </button>
      {open && (
        <div class="green-body">
          {green.map((d, i) => (
            <div class="green-item" key={i}>
              <span>{String(d.specialist)}</span>
              <span class="st">{fqidOf(d)}</span>
              <span class="st">{stt(String(d.status))}</span>
              {typeof d.pr === "string" && <span class="st">PR</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RepoGroup({ repo, dispatches: reps }: { repo: string; dispatches: Dispatch[] }) {
  const green: Dispatch[] = [];
  const live: Dispatch[] = [];
  for (const d of reps) {
    const phase = derivePhase(d, { session: sessionFor(d, sessions.value), monConnDown: conn.value === "down", elapsedMs: elapsedMs(d) });
    (isGreenPhase(phase) ? green : live).push(d);
  }
  const allOpen = live.length === 0;
  const [open, setOpen] = useState(!allOpen);
  const counts = countsByStatus(reps);

  // Same-package law: any fqid with >1 open dispatch is being serialized.
  const byFq = new Map<string, Dispatch[]>();
  for (const d of live) {
    const fq = fqidOf(d);
    byFq.set(fq, [...(byFq.get(fq) ?? []), d]);
  }
  const serializing = [...byFq.values()].filter((g) => g.length > 1).length;

  return (
    <section class="repo-group">
      <button type="button" class={`repo-head${open ? " open" : ""}`} onClick={() => setOpen(!open)}>
        <span class="caret">▸</span>
        <span class="repo-name">{repo}</span>
        <span class="count-pills">
          {Object.entries(counts).map(([st, n]) => (
            <span class="count-pill" key={st} title={stt(st)}>{stt(st)} {n}</span>
          ))}
        </span>
        {serializing > 0 && <span class="law-badge"><Icon name="law" size={13} title={t("floor_serializing")} /> {t("floor_serializing")} {serializing}</span>}
      </button>
      {open && (
        <div class="repo-body">
          {[...byFq.values()].map((grp, gi) => (
            <div class="fq-group" key={gi}>
              {grp.map((d, i) => <SpecialistRow key={i} d={d} all={live} />)}
            </div>
          ))}
          {live.length === 0 && green.length === 0 && <div class="green-item" style={{ padding: "6px 10px" }}>{t("floor_no_dispatch")}</div>}
          <GreenDrawer green={green} />
        </div>
      )}
    </section>
  );
}
