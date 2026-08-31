# Diagram renderer

The single external pipeline for the six specs in `../diagrams/*.yaml`. It reads
the YAML, validates it, and emits one standalone HTML per diagram per language
(`en`, `pt`). **Nothing is authored per diagram**: every node, edge, label, note
and evidence pointer comes from the spec, so a correction is made in exactly one
place — the spec — and re-flows to all outputs. See `../README.md` for the
normative schema.

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
  back-edges route a left gutter; forward skips a right gutter. No node or edge is
  dropped.

## Run

```bash
# PyYAML ships with the system python3. Playwright does not — install it in a venv
# OUTSIDE the repo (chromium builds are already under ~/.cache/ms-playwright):
python3 -m venv /tmp/arch-venv && /tmp/arch-venv/bin/pip install playwright pyyaml
/tmp/arch-venv/bin/playwright install chromium   # no-op if already present

# validate the specs (schema + evidence pointers), no output written
python3 render.py validate

# write the 12 HTML files to ./out (git-ignored)
python3 render.py html

# screenshot each HTML in both themes to ./out (needs the venv's playwright)
/tmp/arch-venv/bin/python render.py all
```

Output lands in `../out/`, which is git-ignored: **the render is derived, the spec
is the source, and nothing rendered is committed to the repo.** For publication the
Portuguese HTML is the master (the site is PT); the English HTML lives next to the
code.

## Verifying a render (mandatory for any visual change)

Generating is not verifying. Run the renderer over **all six** specs, open the
HTML in chromium in **both** `data-theme="light"` and `data-theme="dark"`, and
**look**: the full note is legible, no edge overlaps a node, self-loops are drawn,
`evidence` shows on every node, the kinds are distinguishable, and the node/edge
counts match the spec. A green exit code proves none of that.
