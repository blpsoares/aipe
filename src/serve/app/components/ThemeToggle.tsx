// Cycles document.documentElement's data-theme dark → light → auto (no
// attribute) → dark, ported verbatim from app.html:668-672.
function cycleTheme(): void {
  const html = document.documentElement;
  const cur = html.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : cur === "light" ? "" : "dark";
  if (next) html.setAttribute("data-theme", next);
  else html.removeAttribute("data-theme");
}

export function ThemeToggle() {
  return (
    <button type="button" class="icon-btn" id="themeBtn" title="Theme" onClick={cycleTheme}>
      ◐
    </button>
  );
}
