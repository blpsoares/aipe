import { stringify } from "yaml";
import { parseFqid } from "./fqid";
import type { GraphNode, MergedEdge } from "./types";

export function renderGraphYaml(nodes: GraphNode[], edges: MergedEdge[]): string {
  return stringify({ nodes, edges });
}

// Renders the edge lines for one node/repo "self" fqid, from its point of view.
function edgeLines(related: MergedEdge[], self: string): string[] {
  const lines: string[] = [];
  for (const edge of related) {
    if (edge.from === self) {
      lines.push(`- ${edge.type} → ${edge.to}`);
    } else {
      lines.push(`- ${edge.from} → ${edge.type} → this`);
    }
    for (const p of edge.perspectives) {
      lines.push(`  - ${p.detail} (${p.evidence})`);
    }
  }
  return lines;
}

export function renderReadme(nodes: GraphNode[], edges: MergedEdge[], repoNames: string[]): string {
  const lines: string[] = ["# Relations", ""];

  for (const repo of [...repoNames].sort()) {
    lines.push(`## ${repo}`, "");
    const repoNodes = nodes.filter((n) => n.repo === repo).sort((a, b) => a.fqid.localeCompare(b.fqid));
    const isMonorepo = repoNodes.some((n) => n.package !== null);

    if (isMonorepo) {
      // One sub-section per package node, from that package's point of view.
      for (const node of repoNodes) {
        lines.push(`### ${node.fqid}`);
        if (node.description) lines.push(`_${node.description}_`);
        const related = edges.filter((e) => e.from === node.fqid || e.to === node.fqid);
        if (related.length === 0) {
          lines.push("- _No known relations._");
        } else {
          lines.push(...edgeLines(related, node.fqid));
        }
        lines.push("");
      }
      continue;
    }

    // Single-package repo: render exactly as the pre-package model did, keyed on
    // the whole-repo fqid (== the repo name).
    const related = edges.filter((e) => parseFqid(e.from).repo === repo || parseFqid(e.to).repo === repo);
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
