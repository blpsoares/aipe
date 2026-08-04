import { reltime } from "../runtime/dom";
import { t } from "../runtime/i18n";
import { statusMeta } from "../runtime/statusMeta";
import type { ActivityEvent } from "../runtime/store";

// Ported from app.html:839-841 (DOTCLS, reltime, evHTML).
const DOTCLS: Record<string, string> = {
  dispatched: "active",
  delivered: "delivered",
  verified: "delivered",
  failed: "failed",
  merged: "merged",
  escalated: "escalated",
  removed: "idle",
};

export function EventRow({ event: e }: { event: ActivityEvent & { t?: string } }) {
  const dotCls = DOTCLS[e.status] || "active";
  const ts = e.at ? reltime(e.at, t) : e.t || "";
  // the status description as a tooltip, so the feed is self-explanatory too
  const desc = t(statusMeta(e.status).descKey);
  // #9 — WHERE line: repo[/pkg] + branch (+ worktree) + PR, shown for every
  // status (not only "dispatched"), so the feed answers who / what / WHERE.
  const fqid = e.repo ? (e.pkg ? `${e.repo}/${e.pkg}` : e.repo) : "";
  const hasWhere = !!(fqid || e.branch || e.worktree || e.pr);
  return (
    <div class="ev" title={desc}>
      <div class="tl">
        <span class={`d d-${dotCls}`} />
      </div>
      <div class="tx">
        <b>{e.w}</b> <span class="m">{e.m}</span>
        {hasWhere ? (
          <div class="ev-where">
            {fqid ? <span class="tag">{fqid}</span> : null}
            {e.branch ? <span class="ev-branch mono">⎇ {e.branch}</span> : null}
            {e.worktree && e.worktree !== e.branch ? <span class="ev-wt mono">{e.worktree}</span> : null}
            {e.pr ? (
              <a class="link" href={String(e.pr)} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>
                PR ↗
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      <div class="ts">{ts}</div>
    </div>
  );
}

export function ActivityFeed({ events }: { events: (ActivityEvent & { t?: string })[] }) {
  return (
    <div class="feed">
      {events.map((e, i) => (
        <EventRow event={e} key={i} />
      ))}
    </div>
  );
}
