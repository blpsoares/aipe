import { useLayoutEffect, useRef } from "preact/hooks";
import { t } from "../runtime/i18n";
import { monMeta, monLane, monStreamEntries, monFileEntries, type MonStreamEvent } from "../runtime/monitor-store";

// app.html:1105-1112
function StreamLine({ e }: { e: MonStreamEvent }) {
  if (e.kind === "tool") {
    const body = e.cmd ? `$ ${e.cmd}` : `${e.tool || ""}${e.text ? ` · ${e.text}` : ""}`;
    return (
      <div class="mon-line tool">
        <span class="kt">{t("mon_cmd")}</span>
        <span class="mtx">{body}</span>
      </div>
    );
  }
  return (
    <div class="mon-line say">
      <span class="kt">{t("mon_reason")}</span>
      <span class="mtx">{e.text || ""}</span>
    </div>
  );
}

// app.html:1113-1117
function FileRow({ e }: { e: MonStreamEvent }) {
  return (
    <div class="mon-file">
      <span class="ft">{e.tool || "edit"}</span>
      <span class="fp2">{e.file || ""}</span>
    </div>
  );
}

// Ported from monLaneHTML (app.html:1118-1129). One lane per specialist:
// left pane is that agent's reasoning/command stream, right pane is the
// files it's touching.
//
// Auto-scroll (app.html:1136-1144 pinned the whole batch of lanes together
// before replacing wrap.innerHTML). Here each lane owns its own ref/pin
// state: onScroll tracks whether the user is within 40px of the bottom, and
// a deps-less useLayoutEffect re-pins to the bottom after every render (i.e.
// after every new stream entry) UNLESS the user scrolled up to read history.
export function MonLane({ id }: { id: string }) {
  const m = monMeta(id);
  const l = monLane(id);
  const stream = monStreamEntries(l);
  const files = monFileEntries(l);

  const streamRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useLayoutEffect(() => {
    const el = streamRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  });

  function onStreamScroll(e: Event) {
    const el = e.currentTarget as HTMLDivElement;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  return (
    <section class={`mon-lane${m.active ? "" : " idle"}`} data-agent={id}>
      <div class="mon-lane-head">
        <span class="who2">{m.persona || id}</span>
        {m.agentType ? <span class="atype">{m.agentType}</span> : null}
        <span class={`mon-live${m.active ? "" : " off"}`}>
          <span class="ld" />
          {m.active ? t("mon_active") : t("mon_idle")}
        </span>
      </div>
      <div class="mon-grid">
        <div class="mon-pane">
          <div class="eyebrow">{t("mon_stream")}</div>
          <div class="mon-stream" data-stream={id} ref={streamRef} onScroll={onStreamScroll}>
            {stream.length === 0 ? (
              <div class="sub">—</div>
            ) : (
              stream.map((e, i) => <StreamLine e={e} key={i} />)
            )}
          </div>
        </div>
        <div class="mon-pane">
          <div class="eyebrow">{t("mon_files")}</div>
          <div class="mon-files">
            {files.length === 0 ? <div class="sub">{t("mon_nofiles")}</div> : files.map((e, i) => <FileRow e={e} key={i} />)}
          </div>
        </div>
      </div>
    </section>
  );
}
