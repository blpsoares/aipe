import type { ComponentChildren } from "preact";

// Trivial glyph span.
export function Icon({ glyph }: { glyph: ComponentChildren }) {
  return <span class="ic">{glyph}</span>;
}
