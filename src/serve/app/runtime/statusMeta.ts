// Single source of truth for how a dispatch/worker status is presented: its
// tone (which drives color), and the i18n keys for its short label (st_*) and
// its plain-language description (sd_*). Used by the Chip (tooltip), the pipeline
// lanes, and the stage-guide legend so "what does 'escalated' mean?" has one
// answer everywhere.
export type Tone = "sky" | "accent" | "amber" | "rose" | "slate";

export interface StatusMeta {
  tone: Tone;
  labelKey: string; // st_<status>
  descKey: string; // sd_<status>
}

const META: Record<string, StatusMeta> = {
  dispatched: { tone: "sky", labelKey: "st_dispatched", descKey: "sd_dispatched" },
  active: { tone: "sky", labelKey: "st_active", descKey: "sd_active" },
  delivered: { tone: "accent", labelKey: "st_delivered", descKey: "sd_delivered" },
  verified: { tone: "accent", labelKey: "st_verified", descKey: "sd_verified" },
  merged: { tone: "accent", labelKey: "st_merged", descKey: "sd_merged" },
  failed: { tone: "rose", labelKey: "st_failed", descKey: "sd_failed" },
  escalated: { tone: "amber", labelKey: "st_escalated", descKey: "sd_escalated" },
  escalate: { tone: "amber", labelKey: "st_escalated", descKey: "sd_escalated" },
  // The specialist declared itself stuck and waiting on the coordinator — amber
  // (the same "needs a look" tone as escalated), never slate (which reads idle).
  blocked: { tone: "amber", labelKey: "st_blocked", descKey: "sd_blocked" },
  // D4 (j-20260830-w0) — slate (like `removed`), never rose: this is "no
  // verdict was ever formed", not a rejection, and must never visually read
  // like one.
  abandoned: { tone: "slate", labelKey: "st_abandoned", descKey: "sd_abandoned" },
  // A human talked to this specialist mid-flight and changed its direction —
  // amber (the same "needs a look" tone as escalated), never `slate`: `slate`
  // reads as idle/off, which is the exact opposite of a specialist whose work
  // just diverged and is still running.
  redirected: { tone: "amber", labelKey: "st_redirected", descKey: "sd_redirected" },
  available: { tone: "slate", labelKey: "st_available", descKey: "sd_available" },
  idle: { tone: "slate", labelKey: "st_idle", descKey: "sd_idle" },
  removed: { tone: "slate", labelKey: "st_removed", descKey: "sd_removed" },
};

export function statusMeta(status: string): StatusMeta {
  return META[status] ?? { tone: "slate", labelKey: `st_${status}`, descKey: `sd_${status}` };
}

// ── State color: one --st-* token per ledger state (SDD §9) ──────────────────
// The console adopted the SITE's semantic state tokens. This map — and NOT a
// per-component choice of --sky/--amber/--slate — is the single place a ledger
// state becomes a color, so the Board, the chips, the org tree and the legend
// can never disagree (invariant proven in palette.test.ts).
//
// The site ramp has nine hues (dispatched…removed). Console-only concepts the
// site does not model fold into the nearest hue, documented inline:
//   • active/running work → running
//   • blocked → escalated (both are the "needs a look / stuck" orange; there is
//     no --st-blocked in the site ramp)
//   • available/idle → removed (the grey "off / not working" hue)
const STATE_TOKEN: Record<string, string> = {
  dispatched: "dispatched",
  active: "running",
  running: "running",
  delivered: "delivered",
  verified: "verified",
  merged: "merged",
  failed: "failed",
  escalated: "escalated",
  escalate: "escalated",
  blocked: "escalated",
  redirected: "redirected",
  available: "removed",
  idle: "removed",
  removed: "removed",
};

/** The nine state-token keys that MUST exist in tokens.css (site ramp). */
export const STATE_KEYS = ["dispatched", "running", "delivered", "verified", "failed", "escalated", "merged", "redirected", "removed"] as const;

/** `rgb(var(--st-<state>))` for a status — the ONLY way to color a ledger state.
 *  Returns a resolved color (the tokens are RGB triples), safe in `style={{…}}`,
 *  `color-mix()`, SVG fill/stroke and plain CSS declarations alike. */
export function stateVar(status: string | undefined): string {
  return `rgb(var(--st-${STATE_TOKEN[status ?? ""] ?? "removed"}))`;
}

// The lifecycle order for the stage-guide legend (pipeline stages + the two
// off-track states people most need explained).
export const STAGE_GUIDE_ORDER = ["dispatched", "redirected", "delivered", "verified", "failed", "escalated", "merged"] as const;
