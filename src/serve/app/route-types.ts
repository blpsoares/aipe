import type { ComponentType } from "preact";

// The contract every src/serve/app/views/*.view.tsx must export as `route`.
// genRoutes() (build-client.ts) globs those files and stitches them into
// routes.generated.ts — this type is what gives that untyped array a shape.
export interface NavInfo {
  /** i18n key (STR.en/pt in runtime/i18n.ts), e.g. "nav_overview". */
  label: string;
  /** Single glyph rendered in .ic spans (Sidebar/BottomNav). */
  icon: string;
  /** Sort key — routes.generated.ts orders by this. */
  order: number;
  /** Optional badge kind. Only "escalation" exists today (Activity nav item). */
  badge?: "escalation";
}

export interface Route {
  path: string;
  nav: NavInfo;
  component: ComponentType;
}
