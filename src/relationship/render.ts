import { stringify } from "yaml";
import type { MergedEdge } from "./types";

export function renderGraphYaml(edges: MergedEdge[]): string {
  return stringify({ edges });
}

export function renderReadme(edges: MergedEdge[], repoNames: string[]): string {
  const lines: string[] = ["# Relations", ""];

  for (const repo of [...repoNames].sort()) {
    lines.push(`## ${repo}`, "");
    const related = edges.filter((e) => e.from === repo || e.to === repo);

    if (related.length === 0) {
      lines.push("_No known relations._", "");
      continue;
    }

    for (const edge of related) {
      if (edge.from === repo) {
        lines.push(`- ${edge.type} → ${edge.to}`);
      } else {
        lines.push(`- ${edge.from} → ${edge.type} → this repo`);
      }
      for (const p of edge.perspectives) {
        lines.push(`  - ${p.detail} (${p.evidence})`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
