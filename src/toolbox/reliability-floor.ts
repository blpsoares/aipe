// The reliability floor — skills that run inside a dispatched specialist and are
// installed into every repo (by `aipe skill preset`) so `/verify-before-done` and
// `/review-delivery` actually resolve at the leaf. Their content is embedded in
// the binary (text imports), so — like the coordinator flow-skills (#13) — they
// are refreshed from THIS binary on `aipe rehydrate`, never left stale.
import verifyBeforeDoneSkill from "../../skills/verify-before-done/SKILL.md" with { type: "text" };
import reviewDeliverySkill from "../../skills/review-delivery/SKILL.md" with { type: "text" };

export interface FloorSkill {
  name: string;
  description: string;
  objective: string;
  whenToUse: string;
  content: string;
}

export const RELIABILITY_FLOOR: FloorSkill[] = [
  {
    name: "verify-before-done",
    description: "Evidence gate: prove a unit is done before claiming it (dev + QA).",
    objective: "No done-claim without attached evidence (commands + observed output).",
    whenToUse: "Before returning delivered/passed from a dispatched specialist.",
    content: verifyBeforeDoneSkill,
  },
  {
    name: "review-delivery",
    description: "Independent skeptic review of a delivery against the diff (QA gate).",
    objective: "Verify a delivery against the diff + acceptance, never the dev's report.",
    whenToUse: "When QA gates a dev delivery before it counts as done.",
    content: reviewDeliverySkill,
  },
];

export const RELIABILITY_FLOOR_NAMES = new Set(RELIABILITY_FLOOR.map((f) => f.name));
