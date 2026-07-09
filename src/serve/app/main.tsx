import { render } from "preact";
import { useEffect } from "preact/hooks";
import { LocationProvider, Router, Route } from "preact-iso";
import "./styles/tokens.css";
import "./styles/base.css";
import { routes } from "./routes.generated";
import type { Route as RouteContract } from "./route-types";
import { Sidebar } from "./components/Sidebar";
import { BottomNav } from "./components/BottomNav";
import { Topbar } from "./components/Topbar";
import { CommandPalette, openPalette } from "./components/CommandPalette";
import { WorkerDrawer } from "./components/WorkerDrawer";
import { currentPath } from "./runtime/router";
import { collapsed, mobileOpen, closeMobile } from "./runtime/ui";

const appRoutes = routes as RouteContract[];

// preact-iso does the actual path→component matching for the view area.
// Keyed on currentPath so a hash-driven navigation (runtime/router.ts) remounts
// LocationProvider with the new `url` — see runtime/router.ts for why we don't
// drive navigation through preact-iso's own pushState-based `route()`.
function Shell() {
  return (
    // preact-iso's LocationProvider supports a `url` prop for initial state
    // (router.js:102-103) but its .d.ts omits it — same gap the library's own
    // prerender.js works around.
    // @ts-expect-error - `url` is a real (if untyped) LocationProvider prop
    <LocationProvider key={currentPath.value} url={currentPath.value}>
      <Router>
        {appRoutes.map((r) => (
          <Route key={r.path} path={r.path} component={r.component} />
        ))}
      </Router>
    </LocationProvider>
  );
}

export function App() {
  // Mobile drawer: tapping outside the sidebar/hamburger closes it
  // (app.html:1187-1189).
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!mobileOpen.value) return;
      const target = e.target as HTMLElement | null;
      if (target && !target.closest("#sidebar") && !target.closest("#hamb")) closeMobile();
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const cls = `app${collapsed.value ? " collapsed" : ""}${mobileOpen.value ? " mobileopen" : ""}`;

  return (
    <>
      <div class={cls}>
        <Sidebar />
        <div class="main">
          <Topbar onOpenCommandPalette={openPalette} />
          <div class="view" id="view">
            <Shell />
          </div>
        </div>
      </div>
      <BottomNav />
      <CommandPalette />
      <WorkerDrawer />
    </>
  );
}

// Guard: only mount when the shell's #app div exists (i.e. the real browser
// bundle, shell.html:11). In tests, importing this module for <App> must NOT
// trigger a side-effecting render into a nonexistent node.
const mount = typeof document !== "undefined" ? document.getElementById("app") : null;
if (mount) render(<App />, mount);
