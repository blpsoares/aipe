import { conn } from "../runtime/store";
import { t } from "../runtime/i18n";

// Mirrors setConn (app.html:1280-1285): renders the current `conn` signal
// as .conn / .conn.wait / .conn.down with the matching translated label.
export function ConnBadge() {
  const state = conn.value;
  const cls = state === "down" ? "conn down" : state === "wait" ? "conn wait" : "conn";
  const label = state === "down" ? t("conn_down") : state === "wait" ? t("conn_wait") : t("live");
  return (
    <span class={cls} id="conn">
      <span class="dot" />
      <span id="connLabel">{label}</span>
    </span>
  );
}
