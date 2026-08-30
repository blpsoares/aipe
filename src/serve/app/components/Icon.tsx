import type { JSX } from "preact";

// Real icons, not glyphs: inline SVG, currentColor, sized by CSS/props. Fully
// self-contained — no icon font, no CDN, no network — because the SPA is inlined
// into app.generated.html and embedded in the binary via text import. Every icon
// carries an accessible name via `title` (role="img" + aria-label); decorative
// ones pass no title and become aria-hidden. One shared 24×24 stroke grid keeps
// the set visually consistent across fonts and platforms (the old Unicode
// symbols rendered differently on each, which is part of why the rail looked
// broken).
const PATHS: Record<string, JSX.Element> = {
  // ── nav ──
  floor: (
    <>
      <rect x="3" y="3" width="7" height="10" rx="1.5" />
      <rect x="14" y="3" width="7" height="6" rx="1.5" />
      <rect x="14" y="13" width="7" height="8" rx="1.5" />
      <rect x="3" y="17" width="7" height="4" rx="1.5" />
    </>
  ),
  overview: (
    <>
      <path d="M3 11 12 3l9 8" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  org: (
    <>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v3M6 16v-2h12v2" />
    </>
  ),
  pipeline: (
    <>
      <rect x="3" y="4" width="4" height="16" rx="1" />
      <rect x="10" y="4" width="4" height="11" rx="1" />
      <rect x="17" y="4" width="4" height="7" rx="1" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.5M20.5 20a5.5 5.5 0 0 0-4-5.3" />
    </>
  ),
  toolbox: (
    <>
      <path d="M3 8h18v11H3z" />
      <path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18M11 12h2" />
    </>
  ),
  activity: <path d="M3 12h4l2.5 7 5-14 2.5 7H21" />,
  monitor: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
      <path d="M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8" opacity=".5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </>
  ),
  book: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M8 8h7M8 12h5" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 1 3 6.7" />
      <path d="M3 20v-5h5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  report: (
    <>
      <path d="M3 3v18h18" />
      <rect x="7" y="12" width="3" height="6" rx="0.5" />
      <rect x="12" y="8" width="3" height="10" rx="0.5" />
      <rect x="17" y="5" width="3" height="13" rx="0.5" />
    </>
  ),
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  // ── ui ──
  collapse: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 9l-3 3 3 3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  edit: (
    <>
      <path d="M4 20h4L18.5 9.5l-4-4L4 16z" />
      <path d="M13 7l4 4" />
    </>
  ),
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  flag: <path d="M6 21V4M6 4h11l-2 4 2 4H6" />,
  bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />,
  law: <path d="M6 4h12M6 20h12M8 4v3l4 5 4-5V4M8 20v-3l4-5 4 5v3" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  check: <path d="M5 12.5 9 16.5 19 6" />,
  warn: (
    <>
      <path d="M12 3.5 21 19.5H3z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  ),
  worker: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  reset: (
    <>
      <path d="M4 12a8 8 0 1 1 2.4 5.7" />
      <path d="M4 20v-5h5" />
    </>
  ),
  theme: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" />
    </>
  ),
};

export function hasIcon(name: string): boolean {
  return name in PATHS;
}

export function Icon({
  name,
  size = 18,
  title,
  class: cls = "ic",
}: {
  name: string;
  size?: number;
  /** Accessible name. Given ⇒ role="img" + aria-label; omitted ⇒ aria-hidden. */
  title?: string;
  class?: string;
}): JSX.Element {
  const body = PATHS[name] ?? PATHS.check;
  return (
    <svg
      class={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": "true" })}
    >
      {body}
    </svg>
  );
}
