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
