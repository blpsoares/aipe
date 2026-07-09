import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { t, lang } from "../runtime/i18n";
import { NOTIF, saveNotif, notify } from "../runtime/notify";
import { LangSwitch } from "../components/LangSwitch";
import type { Route } from "../route-types";

// Settings sits in the sidebar footer, not the main nav list (Sidebar.tsx),
// but is still a normal routed view. Ported 1:1 from app.html:808-836 (view
// markup), 667-703 (NOTIF/notify — reused from runtime/notify.ts) and
// 1190-1199 (event delegation). Deviation from the monolith: NOTIF/lang are
// Preact signals, so toggling here re-renders reactively — no manual
// `go("settings")` re-render pass is needed (app.html called it after every
// data-set/data-ev/data-act/data-theme-set/data-lang-set click).

function srow(title: string, sub: string, control: JSX.Element) {
  return (
    <div class="srow">
      <div class="stx">
        <div class="stitle">{title}</div>
        {sub ? <div class="sub">{sub}</div> : null}
      </div>
      <div class="sctl">{control}</div>
    </div>
  );
}

function Switch({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button type="button" class={"sw" + (checked ? " on" : "")} role="switch" aria-checked={checked} onClick={onToggle}>
      <span class="knob" />
    </button>
  );
}

function toggleNotif(key: "enabled" | "desktop" | "sound") {
  const next = { ...NOTIF.value, [key]: !NOTIF.value[key] };
  NOTIF.value = next;
  saveNotif();
  if (key === "desktop" && next.desktop && typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

function toggleEv(key: keyof typeof NOTIF.value.ev) {
  NOTIF.value = { ...NOTIF.value, ev: { ...NOTIF.value.ev, [key]: !NOTIF.value.ev[key] } };
  saveNotif();
}

function erow(key: keyof typeof NOTIF.value.ev, label: string, cls: string) {
  return (
    <div class="srow erow">
      <div class="stx">
        <span class={"edot bg-" + cls} />
        <span class="stitle">{label}</span>
      </div>
      <div class="sctl">
        <Switch checked={NOTIF.value.ev[key]} onToggle={() => toggleEv(key)} />
      </div>
    </div>
  );
}

function ThemeSeg({ theme, onChange }: { theme: string; onChange: (v: string) => void }) {
  const opts: [string, string][] = [
    ["", "th_auto"],
    ["light", "th_light"],
    ["dark", "th_dark"],
  ];
  return (
    <div class="langseg">
      {opts.map(([v, k]) => (
        <button type="button" key={v} class={theme === v ? "on" : ""} onClick={() => onChange(v)}>
          {t(k)}
        </button>
      ))}
    </div>
  );
}

function SettingsView() {
  const notif = NOTIF.value;
  const [theme, setTheme] = useState(() => (typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") || "" : ""));

  const perm: NotificationPermission | "unsupported" = typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";

  function setThemeAttr(v: string) {
    if (v) document.documentElement.setAttribute("data-theme", v);
    else document.documentElement.removeAttribute("data-theme");
    setTheme(v);
  }

  function grant() {
    if (typeof window !== "undefined" && "Notification" in window) void Notification.requestPermission();
  }

  function sendTest() {
    notify("escalated", "AIPe", lang.value === "pt" ? "Notificações estão funcionando ✓" : "Notifications are working ✓");
  }

  return (
    <div class="view-in grid" style={{ gap: "16px", maxWidth: "720px" }}>
      <h1 class="view-h">{t("nav_settings")}</h1>
      <div class="card pad">
        <div class="set-h">{t("set_notif")}</div>
        <div class="sub" style={{ margin: "-2px 0 14px" }}>
          {t("set_notif_sub")}
        </div>
        {srow(t("set_enable"), t("set_enable_sub"), <Switch checked={notif.enabled} onToggle={() => toggleNotif("enabled")} />)}
        {srow(
          t("set_desktop"),
          t("set_desktop_sub"),
          <div class="row" style={{ gap: "8px" }}>
            {perm === "granted" ? (
              <span class="chip delivered">
                <span class="d" />
                {t("set_granted")}
              </span>
            ) : perm === "denied" ? (
              <span class="chip escalated">
                <span class="d" />
                {t("set_denied")}
              </span>
            ) : (
              <button type="button" class="btn btn-ghost" data-act="grant" onClick={grant}>
                {t("set_grant")}
              </button>
            )}
            <Switch checked={notif.desktop} onToggle={() => toggleNotif("desktop")} />
          </div>,
        )}
        {srow(t("set_sound"), t("set_sound_sub"), <Switch checked={notif.sound} onToggle={() => toggleNotif("sound")} />)}
        <div class="set-sub-h">{t("set_events")}</div>
        {erow("dispatch", t("ev_dispatch"), "active")}
        {erow("delivered", t("ev_delivered"), "delivered")}
        {erow("escalated", t("ev_escalated"), "escalated")}
        {erow("merged", t("ev_merged"), "merged")}
        <div style={{ marginTop: "16px" }}>
          <button type="button" class="btn btn-primary" data-act="test" onClick={sendTest}>
            🔔 {t("set_test")}
          </button>
        </div>
      </div>
      <div class="card pad">
        <div class="set-h" style={{ marginBottom: "14px" }}>
          {t("set_appearance")}
        </div>
        {srow(t("set_theme"), "", <ThemeSeg theme={theme} onChange={setThemeAttr} />)}
        {srow(t("set_lang"), "", <LangSwitch />)}
      </div>
    </div>
  );
}

export const route: Route = {
  path: "/settings",
  nav: { label: "nav_settings", icon: "⚙", order: 7 },
  component: SettingsView,
};
