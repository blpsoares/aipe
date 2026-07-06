// The functional category of a repo or module — "api", "web", "lib", or the
// generic "service" fallback. It is a *declared* field on brain.yaml
// (RepoEntry.kind / PackageEntry.kind); when absent, inferKind() guesses from the
// unit's name and stack so existing workspaces still get a sensible label.

const WEB = ["react", "next", "nextjs", "vue", "svelte", "sveltekit", "angular", "tailwind", "vite", "astro", "remix", "solid", "nuxt", "gatsby", "expo", "react-native"];
const API = ["go", "golang", "rust", "express", "fastify", "nest", "nestjs", "django", "flask", "rails", "spring", "postgres", "postgresql", "prisma", "grpc", "graphql", "hono", "koa", "gin", "fiber", "axum"];
const LIB = ["library", "sdk", "package"];

// Normalize a tech token so "Next.js", "next-js", "NextJS" all collapse to "nextjs".
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function has(tokens: string[], needles: string[]): boolean {
  const set = new Set(needles.map(norm));
  return tokens.some((t) => set.has(norm(t)));
}

function nameHints(name: string): string | null {
  const n = name.toLowerCase();
  if (/(^|[-_/])(web|app|frontend|front|ui|site|dashboard|console|admin)([-_/]|$)/.test(n)) return "web";
  if (/(^|[-_/])(api|backend|server|service|gateway|worker|edge)([-_/]|$)/.test(n)) return "api";
  if (/(^|[-_/])(lib|sdk|pkg|core|shared|common|utils|types|schema|proto)([-_/]|$)/.test(n)) return "lib";
  return null;
}

// Returns the declared kind if given, else a best-effort guess (never throws).
export function inferKind(name: string, stack: string[] = [], declared?: string): string {
  if (declared && declared.trim()) return declared.trim();
  const tokens = stack.map((s) => s.toLowerCase().trim());
  // Stack is the strongest signal; name is a tiebreaker/fallback.
  if (has(tokens, WEB)) return "web";
  if (has(tokens, LIB)) return "lib";
  if (has(tokens, API)) return "api";
  const hint = nameHints(name);
  if (hint) return hint;
  return "service";
}
