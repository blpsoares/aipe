#!/usr/bin/env python3
"""
AIPe architecture diagram renderer — the single versioned pipeline.

Reads the six machine-readable specs in ../diagrams/*.yaml and emits, for each,
ONE bilingual standalone HTML (EN/PT toggle) into ../diagrams/html/, plus a
Portuguese PNG into ../diagrams/png/. Nothing here is hand-authored per diagram:
every node, edge, label, note and evidence pointer comes from the YAML, so a
correction is made in exactly one place — the spec — and re-flows to all outputs.
See ../README.md for the normative schema.

The specs are the single source; these generated artifacts are versioned assets:
regenerate them from the specs, never hand-edit an HTML or PNG.

Design decisions (checkable against the house rules):
  * Colour comes only from tokens. ``tokens.css`` (src/serve/app/styles) is read
    from disk and inlined verbatim; no colour literal appears in this file. Ledger
    STATE is coloured via ``--st-<state>`` (mirroring statusMeta.ts) as a left
    stripe on the state-named nodes of the two ledger diagrams; ``kind`` is a
    SEPARATE axis, encoded by badge SHAPE + brand/grey fill — never an --st-* hue.
  * ``note`` is prose (13–94 words EN, longer in PT), so it never sits in a node
    box: each node shows only its numbered badge + label; the full note and the
    verbatim ``evidence`` (as a GitHub link) live in a numbered <details> panel.
  * The graphs are NOT DAGs. Self-loops draw a visible arc; back-edges route a
    left gutter, forward skips a right gutter; a de-collision pass guarantees no
    two edge labels overlap. Nothing is dropped.
  * Unknown ``type`` fails loud — only ``graph`` and ``state-machine`` are drawn.

Usage:
    python3 render.py validate                 # schema + evidence pointers only
    python3 render.py html                     # write ../diagrams/html/*.html
    python3 render.py shoot                    # write ../diagrams/png/*.pt.png (needs playwright)
    python3 render.py all                      # validate -> html -> shoot
    python3 render.py verify [--out DIR]       # extra shots (both langs+themes) to DIR, uncommitted
"""
from __future__ import annotations

import argparse
import glob
import html
import math
import os
import sys

import yaml

# ── Paths ────────────────────────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)                      # docs/architecture
REPO = os.path.dirname(os.path.dirname(PKG))     # repo root
DIAGRAMS = os.path.join(PKG, "diagrams")
HTML_DIR = os.path.join(DIAGRAMS, "html")        # committed asset
PNG_DIR = os.path.join(DIAGRAMS, "png")          # committed asset
TOKENS_CSS = os.path.join(REPO, "src", "serve", "app", "styles", "tokens.css")

LANGS = ("en", "pt")
KNOWN_TYPES = {"graph", "state-machine"}
NODE_KEYS = {"id", "label", "kind", "note", "evidence"}
EDGE_KEYS = {"from", "to", "label"}

# The nine ledger-state ids that get an --st-* stripe (mirror of STATE_KEYS in
# src/serve/app/runtime/statusMeta.ts). A node earns the stripe only if its id is
# one of these — i.e. the ledger-state-machine / rework-loop state nodes.
STATE_KEYS = {"dispatched", "running", "delivered", "verified", "failed",
              "escalated", "merged", "redirected", "removed"}

KIND_DEF = {
    "deterministic": {"en": "tested CLI", "pt": "CLI testada"},
    "judgment": {"en": "SKILL.md prose", "pt": "prosa de SKILL.md"},
    "gate": {"en": "a human decision", "pt": "decisão humana"},
    "denied": {"en": "refused by a rule", "pt": "recusado por uma regra"},
    "structure": {"en": "substrate", "pt": "substrato"},
}
KIND_ORDER = ["deterministic", "judgment", "gate", "denied", "structure"]

# Presentation-only title, derived mechanically from the spec id (no new claim).
TITLE = {
    "demand-to-merge": {"en": "Demand → Merge", "pt": "Demanda → Merge"},
    "ledger-state-machine": {"en": "Ledger state machine", "pt": "Máquina de estados do ledger"},
    "concurrency-model": {"en": "Concurrency model", "pt": "Modelo de concorrência"},
    "harness-containment": {"en": "Harness containment", "pt": "Contenção de harness"},
    "rework-loop": {"en": "Rework loop", "pt": "Loop de conserto"},
    "merge-to-production": {"en": "Merge → Production", "pt": "Merge → Produção"},
}
UI = {
    "eyebrow": {"en": "AIPe · Architecture", "pt": "AIPe · Arquitetura"},
    "nodes": {"en": "nodes", "pt": "nós"},
    "edges": {"en": "edges", "pt": "arestas"},
    "legend": {"en": "Kinds in this diagram", "pt": "Kinds neste diagrama"},
    "detail": {"en": "Nodes — note & evidence", "pt": "Nós — nota & evidência"},
    "evidence": {"en": "evidence", "pt": "evidência"},
    "type": {"graph": {"en": "graph", "pt": "grafo"},
             "state-machine": {"en": "state machine", "pt": "máquina de estados"}},
}
GITHUB_BLOB = "https://github.com/blpsoares/aipe/blob/main/"


# ── Loading & validation ─────────────────────────────────────────────────────
def load_specs():
    files = sorted(glob.glob(os.path.join(DIAGRAMS, "*.yaml")))
    if not files:
        raise SystemExit(f"no specs found under {DIAGRAMS}")
    return [(f, yaml.safe_load(open(f, encoding="utf-8"))) for f in files]


def validate(specs):
    """Schema + evidence. Raises SystemExit (loud) on any defect."""
    problems = []
    tot_nodes = tot_edges = 0
    kind_tally = {}
    for f, d in specs:
        base = os.path.basename(f)
        if d.get("type") not in KNOWN_TYPES:
            problems.append(f"{base}: unknown type {d.get('type')!r} (renderer refuses to draw)")
            continue
        ids = set()
        for n in d.get("nodes", []):
            tot_nodes += 1
            if set(n.keys()) != NODE_KEYS:
                problems.append(f"{base}:{n.get('id')}: keys {set(n.keys())} != {NODE_KEYS}")
            ids.add(n["id"])
            kind_tally[n["kind"]] = kind_tally.get(n["kind"], 0) + 1
            if n["kind"] not in KIND_DEF:
                problems.append(f"{base}:{n['id']}: unknown kind {n['kind']!r}")
            p, _, l = n["evidence"].rpartition(":")
            fp = os.path.join(REPO, p)
            if not os.path.exists(fp):
                problems.append(f"{base}:{n['id']}: evidence file missing: {n['evidence']}")
            elif not l.isdigit() or int(l) > sum(1 for _ in open(fp, errors="replace")):
                problems.append(f"{base}:{n['id']}: evidence line out of range: {n['evidence']}")
            for lang in LANGS:
                if not n["label"].get(lang) or lang not in n["note"]:
                    problems.append(f"{base}:{n['id']}: missing {lang} label/note")
        for e in d.get("edges", []):
            tot_edges += 1
            if set(e.keys()) != EDGE_KEYS:
                problems.append(f"{base}: edge keys {set(e.keys())} != {EDGE_KEYS}")
            if e["from"] not in ids or e["to"] not in ids:
                problems.append(f"{base}: dangling edge {e['from']} -> {e['to']}")
    if problems:
        for p in problems:
            print("FAIL", p, file=sys.stderr)
        raise SystemExit(f"validation failed: {len(problems)} problem(s)")
    print(f"OK  {len(specs)} specs, {tot_nodes} nodes, {tot_edges} edges, 0 dead pointers")
    print(f"    kinds: {kind_tally}")
    return tot_nodes, tot_edges


# ── Layout ───────────────────────────────────────────────────────────────────
NODE_W = 360
GAP_Y = 54                 # vertical gap between node boxes (room for arrows)
PAD = 40
GUT_STEP = 42              # lane spacing in the gutters
SELF_R = 26                # self-loop radius
LABEL_ROOM = 150           # gutter allowance so apex labels never clip


def est_lines(text, chars_per_line=40, max_lines=4):
    return max(1, min(max_lines, math.ceil(len(text) / chars_per_line)))


def layout(spec, lang):
    nodes = spec["nodes"]
    edges = spec["edges"]
    order = [n["id"] for n in nodes]          # spec order = reading order = rows
    row = {nid: i for i, nid in enumerate(order)}
    nmap = {n["id"]: n for n in nodes}

    heights = {}
    for nid in order:
        heights[nid] = 30 + est_lines(nmap[nid]["label"][lang], 34) * 20

    fwd_skip, back = [], []
    for e in edges:
        if e["from"] == e["to"]:
            continue
        rf, rt = row[e["from"]], row[e["to"]]
        if rt > rf + 1:
            fwd_skip.append(e)
        elif rt < rf:
            back.append(e)

    def lanes(group):
        lane, active = {}, []
        spans = [(min(row[e["from"]], row[e["to"]]),
                  max(row[e["from"]], row[e["to"]]), id(e)) for e in group]
        for a, b, eid in sorted(spans, key=lambda s: (s[0], -(s[1]))):
            used = {ln for (end, ln) in active if end >= a}
            k = 0
            while k in used:
                k += 1
            lane[eid] = k
            active.append((b, k))
        return lane, (max(lane.values()) + 1 if lane else 0)

    back_lane, n_back = lanes(back)
    fwd_lane, n_fwd = lanes(fwd_skip)

    gutter_l = PAD + n_back * GUT_STEP + LABEL_ROOM
    gutter_r = PAD + n_fwd * GUT_STEP + SELF_R + LABEL_ROOM
    cx = gutter_l + NODE_W / 2

    box, y = {}, PAD
    for nid in order:
        h = heights[nid]
        box[nid] = dict(x=gutter_l, y=y, w=NODE_W, h=h, cx=cx, cy=y + h / 2)
        y += h + GAP_Y

    return dict(order=order, row=row, box=box, nmap=nmap,
                back_lane=back_lane, fwd_lane=fwd_lane,
                gutter_l=gutter_l, gutter_r=gutter_r, cx=cx,
                w=gutter_l + NODE_W + gutter_r, h=y - GAP_Y + PAD)


# ── SVG rendering ────────────────────────────────────────────────────────────
def esc(s):
    return html.escape(str(s), quote=True)


def make_label(anchor_x, cy, text, align, side):
    """Compute a label box (foreignObject) without emitting it yet."""
    w = min(190, max(64, len(text) * 7 + 16))
    lines = est_lines(text, int((w - 12) / 6.6), 3)
    h = 8 + lines * 15
    fx = (anchor_x - w / 2 if align == "middle"
          else anchor_x if align == "start" else anchor_x - w)
    return dict(fx=fx, cy=cy, w=w, h=h, text=text, side=side)


def _overlap(a, b):
    ax2, bx2 = a["fx"] + a["w"], b["fx"] + b["w"]
    ay1, ay2 = a["cy"] - a["h"] / 2, a["cy"] + a["h"] / 2
    by1, by2 = b["cy"] - b["h"] / 2, b["cy"] + b["h"] / 2
    return not (ax2 <= b["fx"] or bx2 <= a["fx"] or ay2 <= by1 or by2 <= ay1)


def decollide(labels):
    """Per gutter side, push labels down until none overlap. Deterministic."""
    for side in ("left", "right", "spine"):
        grp = sorted([l for l in labels if l["side"] == side], key=lambda l: l["cy"])
        placed = []
        for l in grp:
            bumped = True
            while bumped:
                bumped = False
                for q in placed:
                    if _overlap(l, q):
                        l["cy"] = q["cy"] + q["h"] / 2 + l["h"] / 2 + 5
                        bumped = True
            placed.append(l)
    return labels


def render_svg(spec, lang, mid):
    L = layout(spec, lang)
    box, row = L["box"], L["row"]
    edge_svg, node_svg, labels = [], [], []

    for e in spec["edges"]:
        a, b = e["from"], e["to"]
        ba, bb = box[a], box[b]
        lbl = e["label"].get(lang, "")
        if a == b:  # self-loop
            x0, y0, y1, r = ba["x"] + ba["w"], ba["cy"] - 10, ba["cy"] + 10, SELF_R
            edge_svg.append(
                f'<path class="edge" d="M {x0:.1f} {y0:.1f} '
                f'C {x0+r*1.6:.1f} {y0-r*0.4:.1f} {x0+r*1.6:.1f} {y1+r*0.4:.1f} '
                f'{x0:.1f} {y1:.1f}" marker-end="url(#{mid})"/>')
            if lbl:
                labels.append(make_label(x0 + r * 1.7 + 4, ba["cy"], lbl, "start", "right"))
            continue
        rf, rt = row[a], row[b]
        if rt == rf + 1:  # adjacent forward: spine
            x0, y0, x1, y1 = ba["cx"], ba["y"] + ba["h"], bb["cx"], bb["y"]
            edge_svg.append(f'<path class="edge" d="M {x0:.1f} {y0:.1f} L {x1:.1f} {y1:.1f}" '
                            f'marker-end="url(#{mid})"/>')
            if lbl:
                labels.append(make_label((x0 + x1) / 2, (y0 + y1) / 2, lbl, "middle", "spine"))
        elif rt > rf + 1:  # forward skip: right gutter
            lane = L["fwd_lane"][id(e)]
            gx = ba["x"] + ba["w"] + 20 + lane * GUT_STEP
            x0, y0, x1, y1 = ba["x"] + ba["w"], ba["cy"], bb["x"] + bb["w"], bb["cy"]
            edge_svg.append(
                f'<path class="edge" d="M {x0:.1f} {y0:.1f} '
                f'C {gx:.1f} {y0:.1f} {gx:.1f} {y1:.1f} {x1:.1f} {y1:.1f}" '
                f'marker-end="url(#{mid})"/>')
            if lbl:  # anchor near the TARGET end so labels separate by target row
                labels.append(make_label(gx + 6, y1, lbl, "start", "right"))
        else:  # back edge: left gutter
            lane = L["back_lane"][id(e)]
            gx = ba["x"] - 20 - lane * GUT_STEP
            x0, y0, x1, y1 = ba["x"], ba["cy"], bb["x"], bb["cy"]
            edge_svg.append(
                f'<path class="edge back" d="M {x0:.1f} {y0:.1f} '
                f'C {gx:.1f} {y0:.1f} {gx:.1f} {y1:.1f} {x1:.1f} {y1:.1f}" '
                f'marker-end="url(#{mid})"/>')
            if lbl:
                labels.append(make_label(gx - 6, y1, lbl, "end", "left"))

    decollide(labels)

    # canvas grows to fit any de-collided / off-edge label — no clamp, no overlap
    w, h = L["w"], L["h"]
    for l in labels:
        if l["fx"] < 4:
            l["fx"] = 4
        w = max(w, l["fx"] + l["w"] + 8)
        h = max(h, l["cy"] + l["h"] / 2 + 8)

    label_svg = [
        f'<foreignObject x="{l["fx"]:.1f}" y="{l["cy"]-l["h"]/2:.1f}" '
        f'width="{l["w"]:.1f}" height="{l["h"]:.1f}" class="elabfo">'
        f'<div xmlns="http://www.w3.org/1999/xhtml" class="elab">{esc(l["text"])}</div>'
        f'</foreignObject>' for l in labels]

    for i, nid in enumerate(L["order"], start=1):
        n = L["nmap"][nid]
        bx = box[nid]
        kind = n["kind"]
        state_cls = " state" if nid in STATE_KEYS else ""
        stripe = f' style="--stripe: rgb(var(--st-{nid}))"' if nid in STATE_KEYS else ""
        node_svg.append(
            f'<foreignObject x="{bx["x"]:.1f}" y="{bx["y"]:.1f}" '
            f'width="{bx["w"]:.1f}" height="{bx["h"]:.1f}">'
            f'<div xmlns="http://www.w3.org/1999/xhtml" class="node kind-{kind}{state_cls}"{stripe}>'
            f'<span class="badge kind-{kind}"><i>{i}</i></span>'
            f'<span class="nlabel">{esc(n["label"][lang])}</span>'
            f'</div></foreignObject>')

    return (
        f'<svg viewBox="0 0 {w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}" '
        f'xmlns="http://www.w3.org/2000/svg" role="img" class="diagram">'
        f'<defs><marker id="{mid}" viewBox="0 0 10 10" refX="9" refY="5" '
        f'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0 0 L10 5 L0 10 z" class="arrowhead"/></marker></defs>'
        + "".join(edge_svg) + "".join(label_svg) + "".join(node_svg) + "</svg>")


# ── One language view (header + graph + numbered panel) ──────────────────────
def render_view(spec, lang):
    did = spec["id"]
    svg = render_svg(spec, lang, f"arrow-{lang}")
    kinds_used = [k for k in KIND_ORDER if any(n["kind"] == k for n in spec["nodes"])]
    nn, ne = len(spec["nodes"]), len(spec["edges"])
    title = TITLE[did][lang]
    tlabel = UI["type"][spec["type"]][lang]

    legend = "".join(
        f'<span class="lg"><span class="badge kind-{k} sm"></span>'
        f'<b>{esc(k)}</b> · {esc(KIND_DEF[k][lang])}</span>' for k in kinds_used)

    rows = []
    for i, n in enumerate(spec["nodes"], start=1):
        ev = n["evidence"]
        p, _, ln = ev.rpartition(":")
        state_tag = (f'<span class="sttag" style="--stripe: rgb(var(--st-{n["id"]}))">'
                     f'{esc(n["id"])}</span>' if n["id"] in STATE_KEYS else "")
        rows.append(
            f'<details open class="drow kind-{n["kind"]}">'
            f'<summary><span class="badge kind-{n["kind"]}"><i>{i}</i></span>'
            f'<span class="dlabel">{esc(n["label"][lang])}</span>'
            f'<span class="kindtag">{esc(n["kind"])}</span>{state_tag}</summary>'
            f'<p class="note">{esc(n["note"][lang])}</p>'
            f'<a class="evidence" href="{GITHUB_BLOB}{esc(p)}#L{esc(ln)}" '
            f'target="_blank" rel="noopener">'
            f'<span class="evk">{esc(UI["evidence"][lang])}</span> {esc(ev)}</a>'
            f'</details>')

    return f"""<div class="view" data-lang="{lang}"{' hidden' if lang == 'pt' else ''}>
  <div class="eyebrow">{esc(UI['eyebrow'][lang])} · {esc(title)}</div>
  <h1>{esc(title)}</h1>
  <div class="kicker"><span class="tag">{esc(tlabel)}</span>
    <span>{nn} {esc(UI['nodes'][lang])} · {ne} {esc(UI['edges'][lang])}</span></div>
  <p class="argument">{esc(spec['argument'][lang])}</p>
  <div class="legend"><span class="lgtitle">{esc(UI['legend'][lang])}</span>{legend}</div>
  <div class="scroller">{svg}</div>
  <div class="detail-h">{esc(UI['detail'][lang])}</div>
  {''.join(rows)}
</div>"""


# ── Full bilingual page ──────────────────────────────────────────────────────
def render_page(spec, tokens):
    did = spec["id"]
    views = "\n".join(render_view(spec, lang) for lang in LANGS)
    return f"""<!DOCTYPE html>
<html lang="en" data-diagram="{esc(did)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AIPe · {esc(TITLE[did]['en'])}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
/* tokens.css — inlined VERBATIM from src/serve/app/styles/tokens.css.
   The renderer reads it from disk; no colour literal lives in the pipeline. */
{tokens}
</style>
<style>
:root {{ --sans-ui: "Inter", var(--sans); --mono-ui: "JetBrains Mono", var(--mono); }}
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; max-width: 100%; overflow-x: hidden; }}
body {{
  background: var(--bg); color: rgb(var(--text)); font-family: var(--sans-ui);
  -webkit-font-smoothing: antialiased; line-height: 1.5; padding: 40px 28px 64px;
}}
.wrap {{ max-width: 1100px; margin: 0 auto; }}
.view[hidden] {{ display: none !important; }}

.controls {{
  position: sticky; top: 12px; z-index: 5; display: flex; gap: 8px;
  justify-content: flex-end; margin-bottom: -18px;
}}
.controls button {{
  font-family: var(--mono-ui); font-size: 12px; font-weight: 600; cursor: pointer;
  padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line-2);
  background: rgb(var(--surface-1)); color: rgb(var(--text)); box-shadow: var(--shadow-1);
}}
.controls button:hover {{ border-color: rgb(var(--brand)); color: rgb(var(--brand)); }}

.eyebrow {{
  font-family: var(--mono-ui); font-size: 12px; letter-spacing: .12em;
  text-transform: uppercase; color: rgb(var(--brand)); font-weight: 600;
}}
h1 {{ font-size: 30px; font-weight: 700; margin: 8px 0 6px; letter-spacing: -.01em; }}
.kicker {{
  font-family: var(--mono-ui); font-size: 12px; color: rgb(var(--faint));
  display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 14px;
}}
.kicker .tag {{ border: 1px solid var(--line-2); border-radius: 999px; padding: 2px 10px; }}
.argument {{
  font-size: 15.5px; color: rgb(var(--muted)); max-width: 780px;
  border-left: 3px solid rgb(var(--brand) / .5); padding-left: 16px; margin: 0 0 24px;
}}
.legend {{
  display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 0 0 22px;
  font-size: 12.5px; color: rgb(var(--muted));
}}
.legend .lgtitle {{
  font-family: var(--mono-ui); font-size: 11px; letter-spacing: .08em;
  text-transform: uppercase; color: rgb(var(--faint)); width: 100%; margin-bottom: 2px;
}}
.lg {{ display: inline-flex; align-items: center; gap: 7px; }}
.lg b {{ color: rgb(var(--text)); font-weight: 600; font-family: var(--mono-ui); font-size: 12px; }}

.scroller {{ overflow-x: auto; padding: 8px 0 4px; }}
svg.diagram {{
  display: block; margin: 0 auto; max-width: 100%; height: auto;
  background: rgb(var(--surface-2) / .4); border: 1px solid var(--line);
  border-radius: var(--radius-lg, 16px); padding: 8px;
}}
.edge {{ fill: none; stroke: rgb(var(--faint)); stroke-width: 1.7; }}
.edge.back {{ stroke: rgb(var(--faint) / .85); stroke-dasharray: 5 4; }}
.arrowhead {{ fill: rgb(var(--faint)); }}
.elabfo {{ overflow: visible; }}
.elab {{
  font-family: var(--mono-ui); font-size: 10.5px; line-height: 1.25;
  color: rgb(var(--muted)); background: var(--bg); border: 1px solid var(--line);
  border-radius: 6px; padding: 2px 6px; text-align: center; box-shadow: var(--shadow-1);
}}
.node {{
  height: 100%; display: flex; align-items: center; gap: 12px;
  background: rgb(var(--surface-1)); border: 1px solid var(--line-2);
  border-radius: var(--radius, 12px); padding: 10px 14px; box-shadow: var(--shadow-1);
  overflow: hidden;
}}
.node.state {{ border-left: 5px solid var(--stripe); }}
.nlabel {{
  font-family: var(--mono-ui); font-size: 13px; font-weight: 500;
  color: rgb(var(--text)); line-height: 1.3;
}}
/* kind badge — SHAPE + fill encode kind (brand/grey only, never --st-*).
   The number is wrapped in <i> above the shape so a rotated diamond never tilts it. */
.badge {{
  position: relative; flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--mono-ui); font-weight: 700; font-size: 13px;
}}
.badge > i {{ position: relative; z-index: 1; font-style: normal; }}
.badge.sm {{ width: 16px; height: 16px; }}
.badge.kind-deterministic {{ background: rgb(var(--brand)); color: var(--on-brand); }}
.badge.kind-judgment {{
  background: rgb(var(--surface-1)); color: rgb(var(--brand-strong));
  border: 2px solid rgb(var(--brand));
}}
.badge.kind-structure {{ background: rgb(var(--muted)); color: var(--on-brand); border-radius: 6px; }}
.badge.kind-denied {{
  background: rgb(var(--surface-2)); color: rgb(var(--muted));
  border: 2px double rgb(var(--faint));
}}
.badge.kind-gate {{ background: transparent; color: var(--on-brand); }}
.badge.kind-gate::before {{
  content: ""; position: absolute; inset: 1px; z-index: 0;
  background: rgb(var(--brand-strong)); border-radius: 5px; transform: rotate(45deg);
}}
.detail-h {{
  font-family: var(--mono-ui); font-size: 11px; letter-spacing: .08em;
  text-transform: uppercase; color: rgb(var(--faint));
  margin: 34px 0 10px; border-top: 1px solid var(--line); padding-top: 20px;
}}
.drow {{
  border: 1px solid var(--line); border-radius: var(--radius, 12px);
  margin-bottom: 8px; background: rgb(var(--surface-1)); overflow: hidden;
}}
.drow summary {{
  list-style: none; cursor: pointer; display: flex; align-items: center;
  gap: 12px; padding: 12px 14px;
}}
.drow summary::-webkit-details-marker {{ display: none; }}
.drow .dlabel {{
  font-family: var(--mono-ui); font-size: 13.5px; font-weight: 600;
  color: rgb(var(--text)); flex: 1 1 auto;
}}
.kindtag {{
  font-family: var(--mono-ui); font-size: 10px; letter-spacing: .06em;
  text-transform: uppercase; padding: 3px 8px; border-radius: 999px;
  color: rgb(var(--muted)); background: rgb(var(--surface-3));
  border: 1px solid var(--line-2); flex: 0 0 auto;
}}
.sttag {{
  font-family: var(--mono-ui); font-size: 10px; padding: 3px 8px; border-radius: 999px;
  color: var(--stripe); border: 1px solid var(--stripe); background: transparent; flex: 0 0 auto;
}}
.note {{ margin: 0 14px 12px; padding-left: 42px; font-size: 14.5px; color: rgb(var(--muted)); max-width: 820px; }}
.evidence {{
  display: inline-block; margin: 0 14px 14px 14px; font-family: var(--mono-ui);
  font-size: 12.5px; text-decoration: none; color: rgb(var(--brand-strong)); word-break: break-all;
}}
.evidence:hover {{ text-decoration: underline; }}
.evidence .evk {{
  color: rgb(var(--faint)); text-transform: uppercase; font-size: 10px;
  letter-spacing: .08em; margin-right: 6px;
}}
footer {{
  margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--line);
  font-family: var(--mono-ui); font-size: 11.5px; color: rgb(var(--faint));
  display: flex; gap: 20px; flex-wrap: wrap;
}}
footer a {{ color: rgb(var(--faint)); text-decoration: none; }}
footer a:hover {{ color: rgb(var(--brand)); }}
</style>
</head>
<body>
<div class="wrap">
  <div class="controls">
    <button id="langBtn" type="button" aria-label="toggle language">PT</button>
    <button id="themeBtn" type="button" aria-label="toggle theme">Dark</button>
  </div>
  {views}
  <footer>
    <a href="https://github.com/blpsoares/aipe" target="_blank" rel="noopener">github.com/blpsoares/aipe</a>
    <a href="https://aipe.openvibes.tech" target="_blank" rel="noopener">aipe.openvibes.tech</a>
  </footer>
</div>
<script>
(function () {{
  var root = document.documentElement, cur = "en";
  var langBtn = document.getElementById("langBtn"), themeBtn = document.getElementById("themeBtn");
  function setLang(l) {{
    cur = l;
    document.querySelectorAll(".view").forEach(function (v) {{ v.hidden = v.dataset.lang !== l; }});
    langBtn.textContent = l === "en" ? "PT" : "EN";   // shows the language you switch TO
    root.setAttribute("lang", l);
  }}
  function prefDark() {{ try {{ return matchMedia("(prefers-color-scheme: dark)").matches; }} catch (e) {{ return false; }} }}
  function setTheme(t) {{ root.setAttribute("data-theme", t); themeBtn.textContent = t === "dark" ? "Light" : "Dark"; }}
  langBtn.onclick = function () {{ setLang(cur === "en" ? "pt" : "en"); }};
  themeBtn.onclick = function () {{ setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark"); }};
  window.__setLang = setLang; window.__setTheme = setTheme;  // for the screenshot pipeline
  setLang("en"); setTheme(prefDark() ? "dark" : "light");
}})();
</script>
</body>
</html>"""


# ── Commands ─────────────────────────────────────────────────────────────────
def _tokens():
    if not os.path.exists(TOKENS_CSS):
        raise SystemExit(f"tokens.css not found at {TOKENS_CSS}")
    return open(TOKENS_CSS, encoding="utf-8").read()


def cmd_html():
    specs = load_specs()
    validate(specs)
    tokens = _tokens()
    os.makedirs(HTML_DIR, exist_ok=True)
    out = []
    for _, d in specs:
        fn = os.path.join(HTML_DIR, f"{d['id']}.html")
        page = render_page(d, tokens)
        open(fn, "w", encoding="utf-8").write(page)
        out.append((fn, len(page)))
    for fn, size in out:
        print(f"  wrote {os.path.relpath(fn, PKG)}  ({size/1024:.1f} KB)")
    print(f"{len(out)} bilingual HTML -> {os.path.relpath(HTML_DIR, PKG)}")
    return [fn for fn, _ in out]


def cmd_shoot():
    """The committed publication asset: Portuguese, light, 2x."""
    from playwright.sync_api import sync_playwright
    specs = load_specs()
    htmls = [(d["id"], os.path.join(HTML_DIR, f"{d['id']}.html")) for _, d in specs]
    missing = [h for _, h in htmls if not os.path.exists(h)]
    if missing:
        raise SystemExit(f"HTML not built yet (run 'html'): {missing[:2]}")
    os.makedirs(PNG_DIR, exist_ok=True)
    shots = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for did, h in htmls:
            page = browser.new_page(viewport={"width": 1180, "height": 900}, device_scale_factor=2)
            page.goto("file://" + h)
            page.evaluate("() => { window.__setLang('pt'); window.__setTheme('light'); }")
            try:
                page.wait_for_load_state("networkidle", timeout=6000)
            except Exception:
                pass
            png = os.path.join(PNG_DIR, f"{did}.pt.png")
            page.screenshot(path=png, full_page=True)
            shots.append(png)
            page.close()
        browser.close()
    for s in shots:
        print(f"  shot {os.path.relpath(s, PKG)}")
    print(f"{len(shots)} PT PNG -> {os.path.relpath(PNG_DIR, PKG)}")
    return shots


def cmd_verify(out):
    """Uncommitted verification shots: both languages × both themes."""
    from playwright.sync_api import sync_playwright
    specs = load_specs()
    os.makedirs(out, exist_ok=True)
    shots = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for _, d in specs:
            h = os.path.join(HTML_DIR, f"{d['id']}.html")
            for lang in LANGS:
                for theme in ("light", "dark"):
                    page = browser.new_page(viewport={"width": 1180, "height": 900}, device_scale_factor=2)
                    page.goto("file://" + h)
                    page.evaluate(f"() => {{ window.__setLang('{lang}'); window.__setTheme('{theme}'); }}")
                    try:
                        page.wait_for_load_state("networkidle", timeout=6000)
                    except Exception:
                        pass
                    fn = os.path.join(out, f"{d['id']}.{lang}.{theme}.png")
                    page.screenshot(path=fn, full_page=True)
                    shots.append(fn)
                    page.close()
        browser.close()
    print(f"{len(shots)} verification shots -> {out}")
    return shots


def main():
    ap = argparse.ArgumentParser(description="AIPe architecture diagram renderer")
    ap.add_argument("cmd", choices=["validate", "html", "shoot", "all", "verify"])
    ap.add_argument("--out", default="/tmp/arch-verify")
    a = ap.parse_args()
    if a.cmd == "validate":
        validate(load_specs())
    elif a.cmd == "html":
        cmd_html()
    elif a.cmd == "shoot":
        cmd_shoot()
    elif a.cmd == "all":
        cmd_html()
        cmd_shoot()
    elif a.cmd == "verify":
        cmd_verify(a.out)


if __name__ == "__main__":
    main()
