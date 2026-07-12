// Ported from app.html:599-604 (STAGES). Shared by overview.view.tsx (mini
// pipeline) and pipeline.view.tsx (board lanes) — kept in one place so both
// stay in sync.
export const STAGES = [
  { key: "dispatched", label: "Dispatched", cls: "active" },
  { key: "delivered", label: "Delivered", cls: "delivered" },
  { key: "verified", label: "Verified", cls: "verified" },
  { key: "escalated", label: "Escalated", cls: "escalated" },
  { key: "merged", label: "Merged", cls: "merged" },
] as const;
