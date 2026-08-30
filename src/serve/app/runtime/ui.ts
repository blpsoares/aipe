import { signal, type Signal } from "@preact/signals";

// Sidebar collapse (app.html:673, .app.collapsed) and mobile drawer
// (app.html:674/1177/1188, .app.mobileopen) — both toggle a class on the
// outer `.app` shell. Kept as signals (rather than DOM classList like the
// monolith) so any component can read/react to them.
export const collapsed: Signal<boolean> = signal(false);
export const mobileOpen: Signal<boolean> = signal(false);

export function toggleCollapsed(): void {
  collapsed.value = !collapsed.value;
}

export function toggleMobileOpen(): void {
  mobileOpen.value = !mobileOpen.value;
}

export function closeMobile(): void {
  mobileOpen.value = false;
}

// The Agora board section (WholeBoard in agora.view.tsx) — visible is the
// invariant a PE must not lose (j-20260830-r5: the PE had this board on
// screen before the redesign folded it behind a control, and arriving at
// Agora to a HIDDEN board was read as "the feature is gone"). We remember an
// explicit PE choice to collapse it, but anyone who never chose gets it
// OPEN — a stored "false" is the only thing that keeps it hidden.
const AGORA_BOARD_KEY = "aipe-agora-board-open";

function readAgoraBoardOpen(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    const v = localStorage.getItem(AGORA_BOARD_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export const agoraBoardOpen: Signal<boolean> = signal(readAgoraBoardOpen());

export function setAgoraBoardOpen(open: boolean): void {
  agoraBoardOpen.value = open;
  try {
    localStorage.setItem(AGORA_BOARD_KEY, open ? "1" : "0");
  } catch {
    // localStorage unavailable (e.g. private mode) — the choice still applies this session
  }
}

/** Test-only: clears the stored choice and resets the signal to the visible default. */
export function resetAgoraBoardOpen(): void {
  try {
    localStorage.removeItem(AGORA_BOARD_KEY);
  } catch {
    // nothing persisted to clear
  }
  agoraBoardOpen.value = true;
}
