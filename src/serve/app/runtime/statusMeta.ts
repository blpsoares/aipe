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

// The lifecycle order for the stage-guide legend (pipeline stages + the two
// off-track states people most need explained).
export const STAGE_GUIDE_ORDER = ["dispatched", "redirected", "delivered", "verified", "failed", "escalated", "merged"] as const;
