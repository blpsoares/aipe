// Presentation of a ReportResult in the three shapes the CLI offers: a readable
// terminal table (default), --json (the whole result, stable for scripts), and
// --csv (flat group rows, for a spreadsheet / relaying to third parties). Pure:
// takes a result, returns a string. No I/O.
import type { ReportResult, ReportGroup, MetricSet, PublishState } from "./compute";

const PUB_LABEL: Record<PublishState, string> = {
  published: "publicado",
  "merged-unpublished": "mergeado, não publicado",
  unknown: "não estabelecido",
  checking: "verificando",
};

const METRIC_COLS: { key: keyof MetricSet; label: string }[] = [
  { key: "deliveries", label: "entregas" },
  { key: "qaVerified", label: "aprovadas-qa" },
  { key: "prsMerged", label: "prs-mergeados" },
  { key: "prsOpen", label: "prs-abertos" },
];

function mergedCell(m: MetricSet): string {
  return m.prsMergedDerived > 0 ? `${m.prsMerged} (+${m.prsMergedDerived} deriv.)` : String(m.prsMerged);
}

export function toJson(r: ReportResult): string {
  return JSON.stringify(r, null, 2);
}

// CSV: one row per group (or a single "TOTAL" row when ungrouped). Columns are
// the group's key dimensions followed by the four metrics. Merged keeps its
// measured value; the derived add-on rides in its own column so nothing is
// presented as measured when it is not.
export function toCsv(r: ReportResult): string {
  const dims = r.groups.length > 0 ? Object.keys(r.groups[0]!.key) : [];
  const header = [...dims, "entregas", "aprovadas_qa", "prs_mergeados", "prs_mergeados_derivados", "prs_abertos"];
  const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const line = (cells: (string | number)[]): string => cells.map((c) => esc(String(c))).join(",");
  const rows: string[] = [line(header)];
  const emit = (keyCells: string[], m: MetricSet) =>
    rows.push(line([...keyCells, m.deliveries, m.qaVerified, m.prsMerged, m.prsMergedDerived, m.prsOpen]));
  if (r.groups.length > 0) {
    for (const g of r.groups) emit(dims.map((d) => (g.key as Record<string, string>)[d] ?? ""), g.metrics);
  } else {
    emit([], r.overall);
  }
  return rows.join("\n");
}

function padRow(cells: string[], widths: number[]): string {
  return cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
}

export function toTable(r: ReportResult): string {
  const out: string[] = [];
  out.push(`Relatório de entregas — ${r.totalDispatches} dispatches`);
  if (r.empty) {
    out.push("");
    out.push("nada aqui — nenhum dispatch bate com os filtros.");
    return out.join("\n");
  }

  // Overall metrics, each with the question it answers.
  out.push("");
  out.push(`  Entregas .......... ${r.overall.deliveries}   (quanto a equipe produziu?)`);
  out.push(`  Aprovadas pela QA . ${r.overall.qaVerified}   (quanto passou na revisão de qualidade? — QA interna, não review do GitHub)`);
  out.push(`  PRs mergeados ..... ${mergedCell(r.overall)}   (quanto de fato entrou no código?)`);
  out.push(`  PRs abertos ....... ${r.overall.prsOpen}   (quanto está em voo agora?)`);

  if (r.groups.length > 0) {
    out.push("");
    const dims = Object.keys(r.groups[0]!.key);
    const header = [...dims, ...METRIC_COLS.map((c) => c.label)];
    const body = r.groups.map((g: ReportGroup) => [
      ...dims.map((d) => (g.key as Record<string, string>)[d] ?? ""),
      String(g.metrics.deliveries),
      String(g.metrics.qaVerified),
      mergedCell(g.metrics),
      String(g.metrics.prsOpen),
    ]);
    const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i]!.length)));
    out.push(padRow(header, widths));
    out.push(widths.map((w) => "─".repeat(w)).join("  "));
    for (const row of body) out.push(padRow(row, widths));
  }

  // Publication per repo — "entregue onde": merged is NOT published (src/release).
  const pubRepos = Object.keys(r.publication).sort((a, b) => a.localeCompare(b, "pt"));
  if (pubRepos.length > 0) {
    out.push("");
    out.push("Publicação por repo (merged ≠ publicado):");
    for (const repo of pubRepos) {
      const p = r.publication[repo]!;
      const tag = p.latestReleaseTag ? ` [${p.latestReleaseTag}]` : "";
      out.push(`  · ${repo}: ${PUB_LABEL[p.state]}${tag} — ${p.reason}`);
    }
  }

  // Honesty footer — spelled out, never hidden.
  out.push("");
  out.push("Honestidade sobre o dado:");
  out.push(`  · ${r.honesty.noEnvelope} registro(s) sem envelope — tratados como ausência, não como zero.`);
  if (r.honesty.personaDuplicates.length > 0) {
    for (const d of r.honesty.personaDuplicates) {
      out.push(`  · ${d.variants.join(" / ")} contados como uma pessoa (${d.canonical}).`);
    }
  } else {
    out.push("  · Sem duplicatas de persona na fatia atual.");
  }
  for (const note of r.honesty.derivedNotes) out.push(`  · ${note}`);
  return out.join("\n");
}
