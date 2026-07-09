import { signal, type Signal } from "@preact/signals";
import type { Dispatch } from "./store";

export interface NotifSettings {
  enabled: boolean;
  desktop: boolean;
  sound: boolean;
  ev: {
    dispatch: boolean;
    delivered: boolean;
    escalated: boolean;
    merged: boolean;
  };
}

const DEFAULT_NOTIF: NotifSettings = {
  enabled: true,
  desktop: false,
  sound: true,
  ev: { dispatch: true, delivered: true, escalated: true, merged: true },
};

function loadNotif(): NotifSettings {
  let stored = "{}";
  try {
    stored = (typeof localStorage !== "undefined" && localStorage.getItem("aipe-notif")) || "{}";
  } catch {
    stored = "{}";
  }
  let parsed: Partial<NotifSettings> = {};
  try {
    parsed = JSON.parse(stored);
  } catch {
    parsed = {};
  }
  return Object.assign({}, DEFAULT_NOTIF, parsed);
}

/**
 * NOTIF settings signal, loaded from localStorage["aipe-notif"] (app.html:681-684).
 * Guarded for environments without localStorage (e.g. some test setups).
 */
export const NOTIF: Signal<NotifSettings> = signal(loadNotif());

/** Persists NOTIF to localStorage["aipe-notif"] (app.html:685). */
export function saveNotif(): void {
  try {
    localStorage.setItem("aipe-notif", JSON.stringify(NOTIF.value));
  } catch {
    // ignore (e.g. no localStorage / storage full)
  }
}

let AC: AudioContext | null = null;

/** Plays a short Web Audio tone sequence for `kind` (app.html:687-695). */
export function beep(kind: string): void {
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    AC = AC || new (w.AudioContext || w.webkitAudioContext!)();
    const tones = kind === "escalated" ? [880, 660, 880] : kind === "merged" || kind === "delivered" ? [660, 880] : [740];
    tones.forEach((f, i) => {
      const o = AC!.createOscillator();
      const g = AC!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const s = AC!.currentTime + i * 0.11;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.14, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
      o.connect(g);
      g.connect(AC!.destination);
      o.start(s);
      o.stop(s + 0.18);
    });
  } catch {
    // no AudioContext in this environment
  }
}

const NOTE_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%2310b981'/%3E%3Ctext x='16' y='22' font-size='17' font-family='monospace' font-weight='700' fill='white' text-anchor='middle'%3EA%3C/text%3E%3C/svg%3E";

/** Fires a sound/desktop notification per NOTIF settings (app.html:696-703). */
export function notify(kind: string, title: string, body: string): void {
  if (!NOTIF.value.enabled) return;
  if (NOTIF.value.sound) beep(kind);
  if (NOTIF.value.desktop && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body, icon: NOTE_ICON, tag: "aipe-" + kind });
    } catch {
      // ignore (e.g. denied mid-flight, unsupported)
    }
  }
}

const STATUS_TO_EV_KEY: Record<string, keyof NotifSettings["ev"] | null> = {
  dispatched: "dispatch",
  delivered: "delivered",
  escalated: "escalated",
  merged: "merged",
  removed: null,
};

/**
 * Wires the activity-diff `changed` list (from applySnapshot) to notify calls,
 * per NOTIF.ev (app.html:658-659). `evMsgFn` builds the notification body;
 * `notifyFn` defaults to the real `notify` but is injectable for testing.
 * Also short-circuits on `!NOTIF.enabled` (mirrors the top of `notify()`) so
 * the decision logic is fully testable even with a fake `notifyFn`.
 */
export function wireActivityNotifications(
  changed: Dispatch[],
  evMsgFn: (d: Dispatch) => string,
  notifyFn: (kind: string, title: string, body: string) => void = notify,
): void {
  if (!NOTIF.value.enabled) return;
  changed.forEach((d) => {
    const key = STATUS_TO_EV_KEY[d.status] ?? null;
    if (key && NOTIF.value.ev[key]) {
      notifyFn(d.status, "AIPe · " + d.specialist, evMsgFn(d));
    }
  });
}
