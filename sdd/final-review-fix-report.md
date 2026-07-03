# Fix: reject relations with out-of-enum type or missing fields in reports.ts

## Finding addressed

`src/relationship/reports.ts:5-9` — `isValidReport` only checked that `relations`
was an array, not that each element was shaped correctly. A report like
`{ repo: "x", stack: [], relations: [{ to: "x", type: "depends-on" }] }` passed
validation and would flow into `mergeEdges`'s `canonicalize`
(`src/relationship/merge.ts`), which has no branch for an unknown `type` and
falls through to the default case — writing an invalid edge straight into
`graph.yaml`, the durable source of truth. This defeated the closed-enum
invariant (`imports | published-by | consumes | exposed-by | shares-infra`)
that spec section 2 relies on for pairing edges during merge.

## What changed

`src/relationship/reports.ts`:

- Added a `RELATION_TYPES` constant listing the five closed-enum
  `RelationType` values (kept in sync with `src/relationship/types.ts`).
- Added a new `isValidRelation(value): value is RawRelation` helper that
  checks each relation element is an object with:
  - `to`: non-empty string
  - `type`: string, and must be one of `RELATION_TYPES`
  - `detail`: string
  - `evidence`: string
- Extended `isValidReport` to call `r.relations.every(isValidRelation)` in
  addition to the existing `repo`/`stack`/`relations` shape checks. If any
  element of `relations[]` is invalid, the whole report is now rejected —
  same treatment as any other malformed report (skipped by `readReports`,
  repo shows as "missing").

Empty `relations: []` remains valid (vacuous `every`), and reports with a
missing/non-array `relations` are still rejected as before — no behavior
change for those paths.

## Validation logic (exact)

```ts
const RELATION_TYPES: readonly RelationType[] = [
  "imports",
  "published-by",
  "consumes",
  "exposed-by",
  "shares-infra",
];

function isValidRelation(value: unknown): value is RawRelation {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.to === "string" &&
    r.to.length > 0 &&
    typeof r.type === "string" &&
    (RELATION_TYPES as readonly string[]).includes(r.type) &&
    typeof r.detail === "string" &&
    typeof r.evidence === "string"
  );
}

function isValidReport(value: unknown): value is RepoReport {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.repo === "string" &&
    Array.isArray(r.stack) &&
    Array.isArray(r.relations) &&
    r.relations.every(isValidRelation)
  );
}
```

## Tests added (TDD)

In `src/relationship/__tests__/reports.test.ts`:

1. `rejects a report whose relations contain an out-of-enum type` — writes a
   report with `relations: [{ to: "x", type: "depends-on", detail: "d",
   evidence: "e" }]` (well-formed except for the enum value) and asserts
   `readReports` returns zero reports for that directory.
2. `rejects a report whose relations element is missing a required field` —
   writes a report with `relations: [{ to: "x", type: "imports", detail: "d"
   }]` (missing `evidence`) and asserts it's rejected the same way.

### RED (before the fix)

```
error: expect(received).toHaveLength(expected)
Expected length: 0
Received length: 1
(fail) rejects a report whose relations contain an out-of-enum type [4.09ms]

error: expect(received).toHaveLength(expected)
Expected length: 0
Received length: 1
(fail) rejects a report whose relations element is missing a required field [2.37ms]

 5 pass
 2 fail
 7 expect() calls
```

### GREEN (after the fix)

```
bun test v1.3.14 (0d9b296a)

 7 pass
 0 fail
 7 expect() calls
Ran 7 tests across 1 file. [21.00ms]
```

### Full `src/relationship/` suite

```
bun test v1.3.14 (0d9b296a)

 29 pass
 0 fail
 57 expect() calls
Ran 29 tests across 7 files. [228.00ms]
```

### `bunx tsc --noEmit -p tsconfig.json`

No output — zero errors.

## Files changed

- `src/relationship/reports.ts` — added `isValidRelation` helper and deep
  validation of `relations[]` inside `isValidReport`.
- `src/relationship/__tests__/reports.test.ts` — added two new tests proving
  out-of-enum `type` and missing-field relation elements are rejected.

## Self-review

A report with `type: "depends-on"` is now rejected end-to-end: the new test
`rejects a report whose relations contain an out-of-enum type` writes exactly
such a report to a temp directory, calls the real `readReports`, and asserts
zero reports come back (verified GREEN above, and RED before the fix
confirms the test actually exercises the gap). This closes the finding: an
invalid/out-of-enum edge can no longer reach `mergeEdges`/`graph.yaml` via
`readReports`.

## Concerns

None. The fix is narrowly scoped to `reports.ts`, keeps all prior behavior
(empty `relations: []`, missing/non-array `relations`) unchanged, and the
enum list is a literal duplicate of `RelationType` from `types.ts` (TypeScript
provides no runtime reflection to derive it automatically) — if `RelationType`
is ever extended, `RELATION_TYPES` in `reports.ts` needs a matching update.
