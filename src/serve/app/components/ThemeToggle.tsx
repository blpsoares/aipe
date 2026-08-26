// The Topbar theme control. Cycles auto → dark → light → auto through the shared
// theme module (runtime/theme.ts) so the choice persists across reloads and can
// never disagree with the Settings "Appearance → Theme" segment.
import { theme, cycleTheme } from "../runtime/theme";
import { t } from "../runtime/i18n";

// Re-exported for callers that imported cycleTheme from here (e.g. CommandPalette).
export { cycleTheme } from "../runtime/theme";

const GLYPH: Record<string, string> = { "": "◐", light: "☀", dark: "☾" };

export function ThemeToggle() {
  const cur = theme.value;
  return (
    <button
      type="button"
      class="icon-btn"
      id="themeBtn"
      title={`${t("set_theme")} — ${t(cur === "dark" ? "th_dark" : cur === "light" ? "th_light" : "th_auto")}`}
      aria-label={t("set_theme")}
      onClick={cycleTheme}
    >
      {GLYPH[cur] ?? "◐"}
    </button>
  );
}
