// Worker/CV/unit selectors — ported 1:1 from src/serve/app.html:873-887 (cvOf,
// dispatchesOf, repoOf, kindOf, worktreeOf, unitBlock) and app.html:888-894
// (cvWork). Pure functions over the store signals; no DOM/render concerns —
// the label→string translation for unitLines happens in the component
// (UnitFacts.tsx) that consumes it, keeping this module i18n-agnostic.
import { snapshot, dispatches, type Dispatch, type Worker } from "./store";

export interface CV {
  name?: string;
  title: string;
  bio: string;
  competences: string[];
}

// app.html:873
export function cvOf(name: string): CV {
  const found = (snapshot.value.cvs as CV[]).find((c) => c.name === name);
  return found ?? { title: "", bio: "", competences: [] };
}

// app.html:874
export function dispatchesOf(name: string | undefined | null): Dispatch[] {
  const needle = (name || "").toLowerCase();
  return dispatches.value.filter((d) => (d.specialist || "").toLowerCase() === needle);
}

// app.html:877
export function repoOf(name: string | undefined | null) {
  return snapshot.value.repos.find((r) => r.name === name);
}

// app.html:878
export function kindOf(w: Pick<Worker, "repo" | "package">): string {
  if (w.package) {
    const m = (snapshot.value.packages || []).find((x) => x.repo === w.repo && x.package === w.package);
    return m ? m.kind || "" : "";
  }
  const r = repoOf(w.repo);
  return r ? r.kind : "";
}

// app.html:879
export function worktreeOf(name: string | undefined | null): string | null {
  const ds = dispatchesOf(name);
  const d = ds.find((x) => x.worktree) || ds[0];
  if (!d) return null;
  if (d.worktree) return String(d.worktree).split("/").pop() || null;
  return (d.branch as string | undefined) || null;
}

export interface CvWork {
  delivered: Dispatch[];
  inprog: Dispatch[];
}

// app.html:888-894
export function cvWork(name: string | undefined | null): CvWork {
  const ds = dispatchesOf(name);
  return {
    delivered: ds.filter((d) => d.status === "delivered" || d.status === "verified" || d.status === "merged"),
    inprog: ds.filter((d) => d.status === "dispatched" || d.status === "escalated" || d.status === "failed"),
  };
}

export interface UnitLine {
  // i18n key suffix — the caller renders t("f_" + key) as the label.
  key: "repo" | "monorepo" | "package" | "type" | "worktree";
  value: string;
}

// app.html:880-887 (unitBlock), minus the HTML rendering — returns the
// label/value rows; the component (UnitFacts) turns them into <dt>/<dd>.
export function unitLines(w: Worker): UnitLine[] {
  const r = repoOf(w.repo);
  const mono = !!r && r.packages.length > 0;
  const wt = worktreeOf(w.name);
  const rows: UnitLine[] = [];
  if (mono) {
    rows.push({ key: "monorepo", value: w.repo || "" });
    if (w.package) rows.push({ key: "package", value: w.package });
  } else {
    rows.push({ key: "repo", value: w.repo || "" });
  }
  rows.push({ key: "type", value: kindOf(w) || "—" });
  rows.push({ key: "worktree", value: wt || "—" });
  return rows;
}
