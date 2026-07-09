// CommandPalette (⌘K) — ported from app.html:1232-1275.
// Differences from the monolith, by design:
//  - No terminal command (`c_openterm`/`go("terminal")`) — the terminal view
//    is gone in this migration.
//  - `c_writespec` is kept as a harmless no-op for UI parity (the monolith's
//    was itself a mock: `alert("(mock)")`). We don't call `alert()` so tests
//    (and the DOM in general) stay quiet — building a real spec-writer is out
//    of scope for this task.
//  - Goto commands are derived from `routes.generated` (all 8 views) instead
//    of a hardcoded list, so the palette can't drift from the sidebar/routes.
//  - Opening a worker doesn't render a drawer here — it sets
//    `store.openWorkerName`, the seam Task 10's WorkerDrawer renders off.
import { Fragment } from "preact";
import { signal, type Signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { routes } from "../routes.generated";
import type { Route } from "../route-types";
import { t } from "../runtime/i18n";
import { navigate } from "../runtime/router";
import { snapshot, openWorkerName } from "../runtime/store";
import { fqid } from "../runtime/dom";
import { cycleTheme } from "./ThemeToggle";

const appRoutes = routes as Route[];

// The monolith's palette (app.html:1236-1241) lists goto for EXACTLY these 6
// views, in this order — note it excludes /toolbox and /settings, which the
// sidebar has but the palette does not. This is a parity migration, so we pin
// the goto list to these paths rather than deriving from all of routes.generated
// (which would silently add "Go to Toolbox"/"Go to Settings"). We still resolve
// each path through routes.generated to keep its label/icon in sync.
const GOTO_PATHS = ["/overview", "/org", "/pipeline", "/team", "/activity", "/monitor"];

export interface CmdItem {
  g: string;
  ic: string;
  label: string;
  run: () => void;
}

// ── State (signals; module-level, mirrors the monolith's cmdScrim/cmdSel) ──

export const paletteOpen: Signal<boolean> = signal(false);
const query: Signal<string> = signal("");
const sel: Signal<number> = signal(0);

export function openPalette(): void {
  query.value = "";
  sel.value = 0;
  paletteOpen.value = true;
}

export function closePalette(): void {
  paletteOpen.value = false;
}

function togglePalette(): void {
  if (paletteOpen.value) closePalette();
  else openPalette();
}

// ── Command sources (app.html:1233-1251) ────────────────────────────────────

export function commands(): CmdItem[] {
  const V = t("g_views");
  const A = t("g_actions");
  const goto = t("c_goto");

  const gotoCmds: CmdItem[] = GOTO_PATHS.map((path) => {
    const r = appRoutes.find((x) => x.path === path);
    return {
      g: V,
      ic: r?.nav.icon ?? "",
      label: `${goto} ${t(r?.nav.label ?? "")}`,
      run: () => navigate(path),
    };
  });

  return [
    ...gotoCmds,
    {
      g: A,
      ic: "✎",
      label: t("c_writespec"),
      // Mock kept for parity with the monolith's `alert("(mock)")` — no real
      // spec-writing feature is implemented here.
      run: () => {},
    },
    { g: A, ic: "◐", label: t("c_theme"), run: () => cycleTheme() },
  ];
}

export function cmdList(q: string): CmdItem[] {
  const needle = q.toLowerCase();
  const workers: CmdItem[] = snapshot.value.workers.map((w) => ({
    g: t("g_workers"),
    ic: "◑",
    label: `${w.name} · ${fqid(w)}`,
    run: () => {
      openWorkerName.value = w.name;
      closePalette();
    },
  }));
  return [...commands(), ...workers].filter((o) => o.label.toLowerCase().includes(needle));
}

// ── Component ────────────────────────────────────────────────────────────

export function CommandPalette() {
  const open = paletteOpen.value;
  const q = query.value;
  const items = cmdList(q);
  const selection = Math.min(sel.value, Math.max(0, items.length - 1));

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
        return;
      }
      if (paletteOpen.value) {
        if (e.key === "Escape") {
          closePalette();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          const len = cmdList(query.value).length;
          sel.value = Math.min(sel.value + 1, Math.max(0, len - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          sel.value = Math.max(sel.value - 1, 0);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const list = cmdList(query.value);
          list[sel.value]?.run();
        }
      } else if (e.key === "Escape") {
        // app.html:1274 closes the specialist drawer here. WorkerDrawer
        // (Task 10) renders off `openWorkerName`; clearing it is the seam.
        openWorkerName.value = null;
      }
    }
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, []);

  if (!open) return null;

  let lastG: string | null = null;

  return (
    <div
      class="cmd-scrim on"
      onClick={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div class="palette">
        <input
          autoFocus
          value={q}
          placeholder={t("cmd_ph")}
          onInput={(e) => {
            query.value = (e.target as HTMLInputElement).value;
            sel.value = 0;
          }}
        />
        <div class="cmd-res">
          {items.length === 0 && <div class="grp">{t("nomatch")}</div>}
          {items.map((o, i) => {
            const groupHeader = o.g !== lastG;
            lastG = o.g;
            return (
              <Fragment key={`row-${i}`}>
                {groupHeader && <div class="grp">{o.g}</div>}
                <div
                  class={`opt${i === selection ? " sel" : ""}`}
                  onClick={() => o.run()}
                  onMouseEnter={() => {
                    sel.value = i;
                  }}
                >
                  <span class="ic">{o.ic}</span>
                  {o.label}
                  {i === selection && <span class="kbd k2">↵</span>}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
