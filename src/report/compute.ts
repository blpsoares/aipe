// The delivery-report engine. PURE — no node deps — so the exact same function
// feeds the CLI (`aipe report`, reading ledgers via listJourneys) and the web
// console tela (`/report`, running it over the snapshot's journeys). One
// definition of "a delivery", one place it is counted (no second derivation).
//
// The honesty discipline the brief demands lives HERE, not in the presentation:
//  - a unit delivered in several ledger rows (status progression, or a fix loop)
//    counts ONCE — no inflated count;
//  - a persona spelled two ways (Jesse/jesse) is ONE person — case-insensitive;
//  - a record with no envelope is ABSENCE, never a zero folded into a real bucket;
//  - a derived number (integration proved by git, a date parsed from a journey
//    id) is labelled derived, never presented as a measured fact.

// The loose dispatch shape both the ledger (JourneyDispatch) and the client
// snapshot (runtime/store Dispatch) satisfy. Only the fields the report reads.
export interface ReportDispatch {
  repo?: string | null;
  package?: string | null;
  task?: string | null;
  specialist?: string | null;
  status?: string;
  pr?: unknown;
  integrated?: boolean;
  harness?: string;
  model?: string;
  tier?: string;
  intensity?: string;
}

export interface ReportJourney {
  id: string;
  dispatches?: ReportDispatch[];
}

export type GroupDim = "repo" | "persona" | "status" | "period" | "model" | "harness" | "tier";

export interface ReportFilter {
  repo?: string[];
  persona?: string[]; // matched case-insensitively
  status?: string[];
  since?: string; // YYYY-MM-DD inclusive (by journey date)
  until?: string; // YYYY-MM-DD inclusive
}

// The publication position of a repo — merged is NOT published (j-20260830-zd's
// src/release knows the difference). This is INJECTED, never re-derived here:
// the CLI resolves it from local git (resolveReleaseStates); the serve view reads
// it off the payload. `checking` = the serve cache is still cold (say
// "verificando", never a false zero); `unknown` = git could not establish it.
export type PublishState = "published" | "merged-unpublished" | "unknown" | "checking";
export interface RepoPublication {
  state: PublishState;
  latestReleaseTag: string | null;
  reason: string;
}

export interface ReportOptions {
  filter?: ReportFilter;
  groupBy?: GroupDim[];
  now?: string; // ISO, for a stable generatedAt in tests
  publication?: Record<string, RepoPublication>; // per-repo, injected from src/release
}

// The four metrics, each answering a question (see the SDD §4).
export interface MetricSet {
  deliveries: number; // distinct done units — "quanto a equipe produziu?"
  qaVerified: number; // distinct verified/merged units — "quanto passou na QA?"
  prsMerged: number; // distinct PRs with status merged (MEASURED)
  prsMergedDerived: number; // + PRs proven integrated by git (DERIVED)
  prsOpen: number; // distinct PRs not yet merged — "quanto está em voo?"
}

export interface ReportGroup {
  key: Partial<Record<GroupDim, string>>;
  label: string; // human label of the composite key
  metrics: MetricSet;
  dispatches: number; // ledger rows in this group
}

export interface PersonaDuplicate {
  canonical: string;
  variants: string[];
}

export interface ReportResult {
  totalDispatches: number; // ledger rows matched by the filter
  overall: MetricSet;
  groups: ReportGroup[]; // empty when no groupBy
  honesty: {
    noEnvelope: number; // rows lacking harness+model+tier — absence, not zero
    personaDuplicates: PersonaDuplicate[]; // spellings merged into one person
    derivedNotes: string[]; // what in this report is derived, spelled out
  };
  // Per-repo publication position, for every repo present in the filtered rows.
  // A repo with rows but no injected state is `unknown` (honest absence) — never
  // silently "published", never zero.
  publication: Record<string, RepoPublication>;
  empty: boolean; // true ⇒ "nada aqui"
  generatedAt: string;
}

// ── internals ─────────────────────────────────────────────────────────────────

// A ledger row, normalized: raw fields + the derivations the report needs.
interface Row {
  journey: string;
  date: string | null; // parsed from the journey id, null when unparseable
  repo: string;
  pkg: string;
  task: string;
  personaKey: string; // lowercased — Jesse and jesse collapse here
  persona: string; // the exact spelling on this row
  status: string;
  pr: string | null;
  integrated: boolean;
  model: string | null;
  harness: string | null;
  tier: string | null;
  hasEnvelope: boolean;
}

const DONE = new Set(["delivered", "verified", "merged"]);
const QA_PASSED = new Set(["verified", "merged"]);
const SEM_DATA = "— sem data —";
// Per-dimension "absent" bucket. Precise on purpose: a row missing only `model`
// lands in "— sem modelo —", NOT a blanket "sem envelope" (which would blur it
// with rows missing the WHOLE envelope). Absence stays visible AND accurate.
const SEM: Record<"model" | "harness" | "tier", string> = {
  model: "— sem modelo —",
  harness: "— sem harness —",
  tier: "— sem tier —",
};

const personaKeyOf = (name: string | null | undefined): string => (name ?? "").trim().toLowerCase();

// A date parsed from the journey id (j-AAAAMMDD-xx) — DERIVED, labelled as such.
export function journeyDate(id: string): string | null {
  const m = id.match(/^j-(\d{4})(\d{2})(\d{2})-/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function toRow(j: ReportJourney, d: ReportDispatch): Row {
  const model = d.model?.trim() || null;
  const harness = d.harness?.trim() || null;
  const tier = d.tier?.trim() || null;
  const pr = typeof d.pr === "string" && d.pr.trim() ? d.pr.trim() : null;
  const persona = (d.specialist ?? "").trim();
  return {
    journey: j.id,
    date: journeyDate(j.id),
    repo: (d.repo ?? "").trim() || "—",
    pkg: (d.package ?? "").trim(),
    task: (d.task ?? "").trim(),
    personaKey: personaKeyOf(persona),
    persona,
    status: (d.status ?? "").trim(),
    pr,
    integrated: d.integrated === true,
    model,
    harness,
    tier,
    hasEnvelope: !!(model || harness || tier),
  };
}

const unitKey = (r: Row): string => `${r.journey}|${r.repo}|${r.pkg}|${r.task}|${r.personaKey}`;

function passesFilter(r: Row, f: ReportFilter | undefined): boolean {
  if (!f) return true;
  if (f.repo && f.repo.length > 0 && !f.repo.includes(r.repo)) return false;
  if (f.persona && f.persona.length > 0 && !f.persona.map((p) => p.toLowerCase()).includes(r.personaKey)) return false;
  if (f.status && f.status.length > 0 && !f.status.includes(r.status)) return false;
  if (f.since && (r.date === null || r.date < f.since)) return false;
  if (f.until && (r.date === null || r.date > f.until)) return false;
  return true;
}

function computeMetrics(rows: Row[]): MetricSet {
  const deliveredUnits = new Set<string>();
  const qaUnits = new Set<string>();
  const mergedPrs = new Set<string>();
  const integratedPrs = new Set<string>();
  const anyPrs = new Set<string>();
  for (const r of rows) {
    if (DONE.has(r.status)) deliveredUnits.add(unitKey(r));
    if (QA_PASSED.has(r.status)) qaUnits.add(unitKey(r));
    if (r.pr) {
      anyPrs.add(r.pr);
      if (r.status === "merged") mergedPrs.add(r.pr);
      if (r.integrated) integratedPrs.add(r.pr);
    }
  }
  // A PR proven integrated by git but not ledger-merged counts as a DERIVED merge.
  let derived = 0;
  for (const pr of integratedPrs) if (!mergedPrs.has(pr)) derived++;
  let open = 0;
  for (const pr of anyPrs) if (!mergedPrs.has(pr) && !integratedPrs.has(pr)) open++;
  return {
    deliveries: deliveredUnits.size,
    qaVerified: qaUnits.size,
    prsMerged: mergedPrs.size,
    prsMergedDerived: derived,
    prsOpen: open,
  };
}

// The group value of a row on one dimension. Missing envelope/date land in their
// OWN visible bucket — never folded into a real value, never a silent zero.
// `personaCanonical` collapses case-duplicates (Jesse/jesse) to ONE display name,
// so grouping-by-persona agrees with the deliveries count (which dedups on the
// normalized key) instead of double-listing the same person.
function dimValue(r: Row, dim: GroupDim, personaCanonical: Map<string, string>): string {
  switch (dim) {
    case "repo": return r.repo;
    case "persona": return personaCanonical.get(r.personaKey) ?? (r.persona || r.personaKey || "—");
    case "status": return r.status || "—";
    case "period": return r.date ?? SEM_DATA;
    case "model": return r.model ?? SEM.model;
    case "harness": return r.harness ?? SEM.harness;
    case "tier": return r.tier ?? SEM.tier;
  }
}

function canonicalPersona(variants: Map<string, number>): string {
  return [...variants.entries()]
    .sort((a, b) => {
      const up = Number(/^[A-ZÀ-Þ]/.test(b[0])) - Number(/^[A-ZÀ-Þ]/.test(a[0]));
      if (up !== 0) return up;
      return b[1] - a[1]; // more frequent spelling wins
    })[0]![0];
}

// ── the engine ─────────────────────────────────────────────────────────────────
export function computeReport(journeys: ReportJourney[], opts: ReportOptions = {}): ReportResult {
  const generatedAt = opts.now ?? new Date().toISOString();
  const all: Row[] = [];
  for (const j of journeys) for (const d of j.dispatches ?? []) all.push(toRow(j, d));
  const rows = all.filter((r) => passesFilter(r, opts.filter));

  // Persona spellings → one canonical display per normalized key (Jesse over
  // jesse). Built ONCE, before grouping, so grouping-by-persona and the honesty
  // block agree on who is one person.
  const spellings = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.persona) continue;
    let m = spellings.get(r.personaKey);
    if (!m) spellings.set(r.personaKey, (m = new Map()));
    m.set(r.persona, (m.get(r.persona) ?? 0) + 1);
  }
  const personaCanonical = new Map<string, string>();
  for (const [key, m] of spellings) personaCanonical.set(key, canonicalPersona(m));

  const groupBy = opts.groupBy ?? [];
  let groups: ReportGroup[] = [];
  if (groupBy.length > 0 && rows.length > 0) {
    const buckets = new Map<string, { key: Partial<Record<GroupDim, string>>; rows: Row[] }>();
    for (const r of rows) {
      const key: Partial<Record<GroupDim, string>> = {};
      for (const dim of groupBy) key[dim] = dimValue(r, dim, personaCanonical);
      const id = groupBy.map((dim) => key[dim]).join("|");
      let b = buckets.get(id);
      if (!b) buckets.set(id, (b = { key, rows: [] }));
      b.rows.push(r);
    }
    groups = [...buckets.values()]
      .map((b) => ({
        key: b.key,
        label: groupBy.map((dim) => b.key[dim]).join(" · "),
        metrics: computeMetrics(b.rows),
        dispatches: b.rows.length,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt"));
  }

  // Honesty block, computed over the FILTERED rows (what this report shows).
  const noEnvelope = rows.filter((r) => !r.hasEnvelope).length;
  const personaDuplicates: PersonaDuplicate[] = [];
  for (const [key, m] of spellings) {
    if (m.size > 1) personaDuplicates.push({ canonical: personaCanonical.get(key)!, variants: [...m.keys()] });
  }
  personaDuplicates.sort((a, b) => a.canonical.localeCompare(b.canonical, "pt"));

  const derivedNotes = [
    "PRs mergeados: contagem medida do ledger; “+N derivados” = PRs cujo branch já é ancestral de origin/main por git merge-base (derivado, não do ledger).",
  ];
  if (groupBy.includes("period")) {
    derivedNotes.push("Período derivado do id da jornada (j-AAAAMMDD); jornada sem data parseável cai em “— sem data —”.");
  }

  // Publication per repo present in the filtered rows. Injected state passes
  // through verbatim; a repo with no injected state is explicitly `unknown` —
  // absence is stated, never assumed published, never a zero.
  const publication: Record<string, RepoPublication> = {};
  for (const r of rows) {
    if (publication[r.repo]) continue;
    publication[r.repo] = opts.publication?.[r.repo] ?? {
      state: "unknown",
      latestReleaseTag: null,
      reason: "estado de publicação não fornecido (src/release não consultado nesta fatia)",
    };
  }

  return {
    totalDispatches: rows.length,
    overall: computeMetrics(rows),
    groups,
    honesty: { noEnvelope, personaDuplicates, derivedNotes },
    publication,
    empty: rows.length === 0,
    generatedAt,
  };
}
