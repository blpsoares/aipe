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
import { Icon } from "./Icon";

const appRoutes = routes as Route[];

// After the redesign the console has only 5 screens (3 primary + 2 footer), so
// the palette derives its goto list straight from routes.generated, order-sorted
// — it can no longer drift from the sidebar. Every screen is reachable here.
const GOTO_PATHS = appRoutes.map((r) => r.path);

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

// Run a command and dismiss the palette. Every action here is a one-shot
// (navigate, toggle theme, open a worker) — the interface-sweep finding was that
// goto/theme left the palette open after firing. Closing here covers Enter and
// click uniformly; a worker command that already closed is closed idempotently.
function runItem(o: CmdItem): void {
  o.run();
  closePalette();
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
    // The monolith's "Write orientation spec" was a dead no-op (an `alert("(mock)")`
    // in app.html; a `() => {}` here) — an interface-sweep finding. The console is
    // read-only and authors no specs, so a control that does nothing is removed
    // rather than presented. Authoring a spec happens in the coordinator session.
    { g: A, ic: "theme", label: t("c_theme"), run: () => cycleTheme() },
  ];
}

export function cmdList(q: string): CmdItem[] {
  const needle = q.toLowerCase();
  const workers: CmdItem[] = snapshot.value.workers.map((w) => ({
    g: t("g_workers"),
    ic: "worker",
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
          const item = list[sel.value];
          if (item) runItem(item);
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
                  onClick={() => runItem(o)}
                  onMouseEnter={() => {
                    sel.value = i;
                  }}
                >
                  {o.ic ? <Icon name={o.ic} size={16} /> : <span class="ic" />}
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
