import { DEFAULT_STATUS_PREF, type StatusUpdatesPref } from "./types";

// Read-path resolution of the (10) follow-preference from a parsed
// `brain.context`. It NEVER throws and NEVER migrates the file: this runs at
// SessionStart (item 8 — must not break session open) and on every status
// render. Absence of the field, a non-object, or an invalid/absent `format` all
// degrade to the default (`auto:false`, `detailed`), because the dangerous
// direction here is crashing the hook, not quietly reading "off" for a brain
// that simply predates the feature. The write path (context-brain/validate)
// is the opposite: there an invalid value is a loud `ValidationError`, never a
// silent default.
export function resolveStatusPref(context: unknown): StatusUpdatesPref {
  if (!context || typeof context !== "object") return DEFAULT_STATUS_PREF;
  const su = (context as Record<string, unknown>).statusUpdates;
  if (!su || typeof su !== "object") return DEFAULT_STATUS_PREF;
  const o = su as Record<string, unknown>;
  return {
    auto: o.auto === true,
    format: o.format === "compact" ? "compact" : "detailed",
  };
}
