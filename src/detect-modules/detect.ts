// Proposes a monorepo's modules by reading its *own* workspace manifests, so the
// PE confirms a real list instead of hand-writing one. Deterministic + tested;
// the coordinator folds the confirmed result into brain.yaml. Supports the common
// JS/TS, Go and Rust monorepo layouts; unknown layouts return [].
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

export interface DetectedModule {
  name: string;
  path: string; // relative to the repo root
  stack?: string[];
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// Expand a workspace glob (relative to repoDir) into concrete directories. Only
// the common trailing `/*` (and `/**`) forms are expanded; an exact path is
// returned as-is if it exists.
async function expandGlob(repoDir: string, glob: string): Promise<string[]> {
  const clean = glob.replace(/\/+$/, "");
  const starIdx = clean.indexOf("*");
  if (starIdx < 0) {
    return (await isDir(join(repoDir, clean))) ? [clean] : [];
  }
  const base = clean.slice(0, starIdx).replace(/\/+$/, "");
  const baseAbs = join(repoDir, base);
  let entries: string[];
  try {
    entries = await readdir(baseAbs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries.sort()) {
    if (e.startsWith(".")) continue;
    const rel = base ? `${base}/${e}` : e;
    if (await isDir(join(repoDir, rel))) out.push(rel);
  }
  return out;
}

async function moduleAt(repoDir: string, rel: string): Promise<DetectedModule | null> {
  const abs = join(repoDir, rel);
  const basename = rel.split("/").filter(Boolean).pop() ?? rel;
  const pkgRaw = await readText(join(abs, "package.json"));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      const name = typeof pkg.name === "string" && pkg.name ? String(pkg.name).replace(/^@[^/]+\//, "") : basename;
      const ts = (await readText(join(abs, "tsconfig.json"))) !== null;
      return { name, path: rel, stack: [ts ? "TypeScript" : "JavaScript"] };
    } catch {
      return { name: basename, path: rel };
    }
  }
  if ((await readText(join(abs, "go.mod"))) !== null) return { name: basename, path: rel, stack: ["Go"] };
  if ((await readText(join(abs, "Cargo.toml"))) !== null) return { name: basename, path: rel, stack: ["Rust"] };
  return { name: basename, path: rel };
}

function tomlMembers(toml: string): string[] {
  // [workspace] members = ["a", "b/*"] — read the members array under [workspace].
  const m = /\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/.exec(toml);
  if (!m) return [];
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

function goWorkUses(text: string): string[] {
  const uses: string[] = [];
  const block = /use\s*\(([\s\S]*?)\)/.exec(text);
  if (block) for (const line of block[1]!.split("\n")) {
    const t = line.trim().replace(/^\.\//, "");
    if (t && !t.startsWith("//")) uses.push(t);
  }
  for (const m of text.matchAll(/^\s*use\s+(\.\/)?(\S+)\s*$/gm)) uses.push(m[2]!);
  return uses;
}

export async function detectModules(repoDir: string): Promise<DetectedModule[]> {
  const globs: string[] = [];

  const pnpm = await readText(join(repoDir, "pnpm-workspace.yaml"));
  if (pnpm) {
    try {
      const doc = parse(pnpm);
      if (Array.isArray(doc?.packages)) globs.push(...doc.packages.filter((p: unknown) => typeof p === "string"));
    } catch {
      // malformed → skip
    }
  }

  const pkgRaw = await readText(join(repoDir, "package.json"));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : Array.isArray(pkg.workspaces?.packages) ? pkg.workspaces.packages : [];
      globs.push(...ws.filter((p: unknown) => typeof p === "string"));
    } catch {
      // malformed → skip
    }
  }

  const goWork = await readText(join(repoDir, "go.work"));
  if (goWork) globs.push(...goWorkUses(goWork));

  const cargo = await readText(join(repoDir, "Cargo.toml"));
  if (cargo) globs.push(...tomlMembers(cargo));

  const seen = new Set<string>();
  const modules: DetectedModule[] = [];
  for (const glob of globs) {
    for (const rel of await expandGlob(repoDir, glob)) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      const mod = await moduleAt(repoDir, rel);
      if (mod) modules.push(mod);
    }
  }
  return modules;
}
