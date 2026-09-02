# Diagram renderer

The single versioned pipeline for the six specs in `../diagrams/*.yaml`. It reads
the YAML, validates it, and emits the **published figures** as versioned assets:
one bilingual HTML (EN/PT toggle) per diagram in `../diagrams/html/` — the full
composed page (eyebrow, title, argument, full-prose kind legend, numbered note/
evidence panel) — and one Portuguese PNG per diagram in `../diagrams/png/` — the
**graph plus a compact kind legend**: boxes, arrows, edge labels, the badge
number/shape/fill that identifies each node, and a one-line-per-kind chip strip
underneath so the shape is translatable without the HTML open next to it. No
eyebrow, title, argument, node/edge count, or note panel in the PNG — those stay
in the HTML only. (The legend-vs-no-legend call was made by the PE on
j-20260831-al/png-so-o-diagrama, after comparing both: a diamond or an outlined
circle means nothing without a key.) **Nothing is authored per diagram** — every
node, edge, label, note and evidence pointer comes from the spec, so a correction
is made in exactly one place (the spec) and re-flows to all outputs. See
`../README.md` for the normative schema.

The two outputs share the graph layout and node/edge/badge CSS (`render_svg` /
`GRAPH_CSS`) — the PNG is not a screenshot of the HTML page cropped down, it is a
second, minimal page (`render_diagram_page`) built from the same graph code, so
the layout is never duplicated between the two.

The artifacts are committed. Regenerate them from the specs; never hand-edit an
HTML or PNG.

## What it guarantees

- **Validation before drawing.** Schema (every node has exactly `id/label/kind/
  note/evidence`, every edge `from/to/label`), evidence pointers (each `file:line`
  exists and the line fits inside the file), no dangling edges. An unknown `type`
  fails loud — only `graph` and `state-machine` are drawn.
- **Colour only from tokens.** `src/serve/app/styles/tokens.css` is read from disk
  and inlined verbatim; no colour literal lives in the renderer. Ledger **state**
  is coloured via `--st-<state>` (a left stripe on the state-named nodes, mirroring
  `src/serve/app/runtime/statusMeta.ts`); **kind** is a separate axis, encoded by
  badge shape + brand/grey fill — the two are never collapsed.
- **The full note is never truncated.** Each node shows only its numbered badge +
  label; the complete note and the verbatim `evidence` (as a GitHub link) live in a
  numbered `<details>` panel below the graph.
- **Non-DAG shapes survive.** Self-loops (`from == to`) draw a visible arc;
  back-edges route a left gutter, forward skips a right gutter; a de-collision pass
  guarantees no two edge labels overlap. No node or edge is dropped.
- **Bilingual, one file.** Each HTML carries both EN and PT, laid out per language,
  with an on-screen toggle (and a light/dark toggle).

## Run

```bash
# PyYAML ships with the system python3. Playwright does not — install it in a venv
# OUTSIDE the repo (chromium builds are already under ~/.cache/ms-playwright):
python3 -m venv /tmp/arch-venv && /tmp/arch-venv/bin/pip install playwright pyyaml
/tmp/arch-venv/bin/playwright install chromium   # no-op if already present

python3 render.py validate    # schema + evidence pointers, no output written
python3 render.py html         # write ../diagrams/html/*.html (bilingual)
/tmp/arch-venv/bin/python render.py all    # html + ../diagrams/png/*.pt.png (needs playwright)

# uncommitted verification shots of the composed HTML — both languages × both
# themes — to a scratch dir:
/tmp/arch-venv/bin/python render.py verify --out /tmp/arch-verify
```

The committed PNG is Portuguese, light theme, `device_scale_factor=2` (the
publication master; the site is PT), and shows the graph plus a compact kind
legend — no eyebrow, title, argument, counts, or note panel. The HTML carries
both languages and the full composition (full-prose legend included).

## Verifying a render (mandatory for any visual change)

Generating is not verifying. Run the renderer over **all six** specs, open each
HTML in chromium in **both** themes and **both** languages, and **look**: the full
note is legible, no edge label overlaps another (a `foreignObject.elabfo` bbox test
catches what the eye misses), self-loops are drawn, `evidence` shows on every node,
the kinds are distinguishable, and the node/edge counts match the spec. A green
exit code proves none of that.
