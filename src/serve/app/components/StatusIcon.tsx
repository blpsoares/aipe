// Crisp, theme-aware status icons (inline SVG, stroke = currentColor so they
// take the chip/legend color and work in both themes). Decorative — the text
// label carries the meaning — so each is aria-hidden. SVGs contribute no
// textContent, so a chip's asserted text stays exactly the status label.
import type { JSX } from "preact";

const P: Record<string, JSX.Element> = {
  // handed off & running — arrow moving into a ring
  dispatched: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h7m-3-3 3 3-3 3" />
    </>
  ),
  // submitted for review — upload out of a tray
  delivered: (
    <>
      <path d="M12 14V4m-4 4 4-4 4 4" />
      <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </>
  ),
  // passed QA — check in a ring
  verified: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  // rejected by QA — x in a ring
  failed: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6m0-6-6 6" />
    </>
  ),
  // raised to the PE — chevrons up
  escalated: <path d="m6 13 6-6 6 6M6 18l6-6 6 6" />,
  // integrated — git-merge (branch folding back)
  merged: (
    <>
      <circle cx="7" cy="6" r="2.4" />
      <circle cx="7" cy="18" r="2.4" />
      <circle cx="17" cy="12" r="2.4" />
      <path d="M7 8.4v7.2M9.4 6h1.6a4 4 0 0 1 4 4v.4" />
    </>
  ),
  removed: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12h7" />
    </>
  ),
  // worker states
  active: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M4.5 12a7.5 7.5 0 0 0 15 0 7.5 7.5 0 0 0-15 0" opacity=".45" />
    </>
  ),
  available: <circle cx="12" cy="12" r="7" />,
  idle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6m4-6v6" />
    </>
  ),
};

// aliases so worker + dispatch vocabularies both resolve
P.escalate = P.escalated!;

export function StatusIcon({ k, size = 15 }: { k: string; size?: number }): JSX.Element {
  const body = P[k] ?? P.available!;
  return (
    <svg
      class="sic"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {body}
    </svg>
  );
}
