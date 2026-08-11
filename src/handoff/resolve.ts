import { basename } from "node:path";
import type { RepoInput } from "./types";

const URL_RE = /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/i;

export function resolveRepoInput(value: string): RepoInput {
  const trimmed = value.trim();
  if (URL_RE.test(trimmed)) {
    return { name: deriveNameFromUrl(trimmed), url: trimmed };
  }
  return { name: basename(trimmed.replace(/\/+$/, "")), localPath: trimmed };
}

function deriveNameFromUrl(url: string): string {
  let s = url.trim();
  if (s.endsWith(".git")) s = s.slice(0, -4);
  s = s.replace(/\/+$/, "");
  const segments = s.split(/[/:]/).filter((seg) => seg.length > 0);
  return segments[segments.length - 1] ?? s;
}
