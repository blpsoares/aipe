// Ported from views.monitor (app.html:792-797) + renderMonitor/initMonitor
// (app.html:1132-1154).
import { useEffect } from "preact/hooks";
import { t } from "../runtime/i18n";
import {
  monVersion,
  showAll,
  monConnDown,
  monVisibleAgents,
  monHiddenCount,
  monAgentCount,
  monToggle,
  connectMonitorStream,
} from "../runtime/monitor-store";
import { MonLane } from "../components/MonLane";
import type { Route } from "../route-types";

function MonitorView() {
  // Subscribe to the reducer's version counter + the showAll toggle so this
  // component re-renders on every SSE push and every toolbar click (see
  // monitor-store.ts for why the Maps themselves aren't signals).
  monVersion.value;
  const all = showAll.value;
  const down = monConnDown.value;

  // app.html:1148 — one shared EventSource for the whole session,
  // connectMonitorStream() itself no-ops on repeat calls, so navigating away
  // from /monitor and back doesn't reopen the stream. The store keeps
  // accumulating even while this view isn't mounted.
  useEffect(() => {
    connectMonitorStream();
  }, []);

  const agentCount = monAgentCount();
  const ids = monVisibleAgents();
  const hidden = monHiddenCount();

  return (
    <div class="view-in grid" style={{ gap: "16px" }}>
      <div class="between">
        <div>
          <h1 class="view-h">{t("nav_monitor")}</h1>
          <div class="sub">{t("mon_sub")}</div>
        </div>
        <span class={`conn${down ? " down" : ""}`} id="monConn">
          <span class="dot" />
          {t("live")}
        </span>
      </div>
      <div id="monwrap">
        {agentCount > 0 && (
          <div class="mon-toolbar">
            <button class={`mon-chip${all ? "" : " on"}`} onClick={monToggle}>
              {t("mon_active_only")}
            </button>
            <button class={`mon-chip${all ? " on" : ""}`} onClick={monToggle}>
              {t("mon_all")}
            </button>
          </div>
        )}
        {ids.length === 0 ? (
          <div class="card mon-empty" style={{ marginTop: agentCount ? "12px" : "0" }}>
            {t("mon_empty")}
            {!all && hidden > 0 && (
              <div class="sub" style={{ marginTop: "12px" }}>
                <a
                  class="link"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    monToggle();
                  }}
                >
                  {t("mon_hidden").replace("{n}", String(hidden))}
                </a>
              </div>
            )}
          </div>
        ) : (
          <div class="mon-lanes" style={{ marginTop: agentCount ? "12px" : "0" }}>
            {ids.map((id) => (
              <MonLane id={id} key={id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const route: Route = {
  path: "/monitor",
  nav: { label: "nav_monitor", icon: "◉", order: 6 },
  component: MonitorView,
};
