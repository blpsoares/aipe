#!/usr/bin/env bun
// Cross-platform build: compiles the unified `aipe` CLI into standalone
// executables — one per OS/arch — so the plugin runs with zero runtime
// dependency (no Bun/Node/npm on the host).
//
//   bun run scripts/build.ts            # all targets
//   bun run scripts/build.ts host       # only the current OS/arch
//   bun run scripts/build.ts linux-x64 darwin-arm64   # a subset
//
// Cross-compiling downloads the target Bun runtime (~90 MB each) on first
// use, so this needs network access. Output lands in dist/, gitignored.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildClient, genRoutes } from "../src/serve/app/build-client";

interface Target {
  label: string; // dist filename suffix; the launcher maps uname → this
  bunTarget: string; // bun build --target value
  ext: string;
}

const TARGETS: Target[] = [
  { label: "linux-x64", bunTarget: "bun-linux-x64", ext: "" },
  { label: "linux-arm64", bunTarget: "bun-linux-arm64", ext: "" },
  { label: "darwin-x64", bunTarget: "bun-darwin-x64", ext: "" },
  { label: "darwin-arm64", bunTarget: "bun-darwin-arm64", ext: "" },
  { label: "windows-x64", bunTarget: "bun-windows-x64", ext: ".exe" },
];

function hostLabel(): string {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}`;
}

function selectTargets(argv: string[]): Target[] {
  const requested = argv.filter((a) => !a.startsWith("-"));
  if (requested.length === 0) return TARGETS;
  const wanted = new Set(requested.map((r) => (r === "host" ? hostLabel() : r)));
  return TARGETS.filter((t) => wanted.has(t.label));
}

const ROOT = join(import.meta.dir, "..");
const ENTRY = join(ROOT, "src", "cli.ts");
const DIST = join(ROOT, "dist");

async function buildOne(t: Target): Promise<boolean> {
  const outfile = join(DIST, `aipe-${t.label}${t.ext}`);
  const proc = Bun.spawn(
    [
      "bun",
      "build",
      "--compile",
      `--target=${t.bunTarget}`,
      "--minify",
      ENTRY,
      "--outfile",
      outfile,
    ],
    { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
  );
  const code = await proc.exited;
  const ok = code === 0;
  console.log(`${ok ? "OK  " : "FAIL"} aipe-${t.label}${t.ext}`);
  return ok;
}

async function main(): Promise<number> {
  const targets = selectTargets(process.argv.slice(2));
  if (targets.length === 0) {
    console.log("ERROR: no matching targets. Known:", TARGETS.map((t) => t.label).join(", "));
    return 1;
  }
  await mkdir(DIST, { recursive: true });

  console.log("Building client (Preact routes + bundle)...");
  await genRoutes();
  const html = await buildClient({ minify: true });
  await Bun.write(join(ROOT, "src", "serve", "app", "app.generated.html"), html);

  console.log(`Building ${targets.length} target(s) → ${DIST}`);

  let failures = 0;
  for (const t of targets) {
    if (!(await buildOne(t))) failures++;
  }
  console.log(failures === 0 ? "All targets built." : `${failures} target(s) failed.`);
  return failures === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
