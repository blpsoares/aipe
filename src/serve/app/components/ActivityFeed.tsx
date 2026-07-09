import { reltime } from "../runtime/dom";
import { t } from "../runtime/i18n";
import type { ActivityEvent } from "../runtime/store";

// Ported from app.html:839-841 (DOTCLS, reltime, evHTML).
const DOTCLS: Record<string, string> = {
  dispatched: "active",
  delivered: "delivered",
  merged: "merged",
  escalated: "escalated",
  removed: "idle",
};

export function EventRow({ event: e }: { event: ActivityEvent & { t?: string } }) {
  const dotCls = DOTCLS[e.status] || "active";
  const ts = e.at ? reltime(e.at, t) : e.t || "";
  return (
    <div class="ev">
      <div class="tl">
        <span class={`d d-${dotCls}`} />
      </div>
      <div class="tx">
        <b>{e.w}</b> <span class="m">{e.m}</span>
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
