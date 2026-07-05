#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { BrainFile, Phase, StateFile } from "../context-brain/types";
import { renderSessionContext } from "./awareness";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) return undefined;
  return v;
}

function sanitize(v: string): string {
  return v.replace(/[\x00-\x1f]+/g, " ").trim();
}

function isPhase(v: unknown): v is Phase {
  return v === "pending" || v === "done";
}

export interface Fields {
  brain: "present" | "absent";
  contextName: string;
  coordinator: string;
  phaseBrain: Phase;
  phaseWorkspace: Phase;
  phaseRelationship: Phase;
  phaseSpecialists: Phase;
  repos: string[];
}

async function readYaml(path: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined; // absent
  }
  try {
    return parse(raw);
  } catch {
    return undefined; // malformed
  }
}

function absentFields(): Fields {
  return {
    brain: "absent",
    contextName: "",
    coordinator: "",
    phaseBrain: "pending",
    phaseWorkspace: "pending",
    phaseRelationship: "pending",
    phaseSpecialists: "pending",
    repos: [],
  };
}

export async function readState(workspaceDir: string): Promise<Fields> {
  const aipe = join(workspaceDir, ".aipe");
  const brainParsed = await readYaml(join(aipe, "brain.yaml"));
  if (!brainParsed || typeof brainParsed !== "object") {
    return absentFields();
  }

  const brain = brainParsed as Partial<BrainFile>;
  const contextName = sanitize(String(brain.context?.name ?? ""));
  const coordinator = sanitize(String(brain.context?.coordinator ?? ""));
  const repos = Array.isArray(brain.repos)
    ? brain.repos
        .map((r) => sanitize(String((r as { name?: unknown } | null)?.name ?? "")))
        .filter((n) => n.length > 0)
    : [];

  const stateParsed = await readYaml(join(aipe, "state.yaml"));
  const phase = (stateParsed as Partial<StateFile> | undefined)?.phase;
  const readPhase = (v: unknown, fallback: Phase): Phase => (isPhase(v) ? v : fallback);

  return {
    brain: "present",
    contextName,
    coordinator,
    phaseBrain: readPhase(phase?.brain, "done"),
    phaseWorkspace: readPhase(phase?.workspace, "pending"),
    phaseRelationship: readPhase(phase?.relationship, "pending"),
    phaseSpecialists: readPhase(phase?.specialists, "pending"),
    repos,
  };
}

export function formatFields(f: Fields): string {
  return [
    `BRAIN=${f.brain}`,
    `CONTEXT_NAME=${f.contextName}`,
    `COORDINATOR=${f.coordinator}`,
    `PHASE_BRAIN=${f.phaseBrain}`,
    `PHASE_WORKSPACE=${f.phaseWorkspace}`,
    `PHASE_RELATIONSHIP=${f.phaseRelationship}`,
    `PHASE_SPECIALISTS=${f.phaseSpecialists}`,
    `REPOS=${f.repos.join(",")}`,
  ].join("\n");
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  console.log(formatFields(await readState(workspace)));
  return 0;
}

export async function runSessionContext(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  if (!workspace) {
    console.log("{}");
    return 0;
  }
  console.log(renderSessionContext(await readState(workspace)));
  return 0;
}

if (import.meta.main) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
