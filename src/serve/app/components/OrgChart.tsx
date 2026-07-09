// The live organogram: coordinator hub -> repo/monorepo clusters -> package
// clusters -> specialist nodes, over the cross-repo relation edges. Ported
// 1:1 from renderOrgSvg (app.html:925-978) — every layout constant, the
// column/row math, and the SVG markup shape are reproduced exactly so the
// rendered graph is pixel-for-pixel the same as the monolith's.
//
// Pan/zoom (app.html:1014-1072) is wired here via a ref + useEffect instead
// of the monolith's getElementById()-based initOrgPanZoom/applyOrgTransform,
// but the math (wheel-zoom-at-cursor, drag-pan, dblclick-reset, the
// pointerdown-on-a-clickable-node drag guard) is unchanged.
import { useEffect, useRef } from "preact/hooks";
import { snapshot, openWorkerName, type Repo, type Worker } from "../runtime/store";
import { t } from "../runtime/i18n";
import { orgQuery, orgTransform, orgColor, orgRepoVisible, orgWorkersFor, zoomAtPoint } from "../runtime/org";

// app.html:927
const yC = 42;
const yR = 152;
const yS0 = 262;
const sH = 64;
const pkgH = 28;
const grpGap = 14;
const colW = 212;
const gap = 34;

interface Relation {
  from: string;
  to: string;
  type: string;
}

type Row = { type: "pkg"; label: string; y: number } | { type: "spec"; w: Worker; y: number };

interface Col {
  r: string;
  info: Repo;
  mono: boolean;
  rows: Row[];
  botY: number;
  x: number;
  cx: number;
}

// app.html:951-957 — a rect + optional colored dot + title/sub text, with a11y
// wiring: nodes with an onClick get tabIndex=0/role="button" and respond to
// Enter/Space; non-interactive nodes (coordinator, repo header) get role="img".
// Deviation: the monolith detects "is this node clickable" via the literal
// onclick="..." HTML attribute (querySelector(".onode[onclick]")); Preact
// attaches click handlers as JS listeners, not attributes, so we use
// role="button" as the equivalent marker (see the pointerdown drag-guard and
// keydown handler below, both of which select on it).
function OrgNode({
  cx,
  y,
  w,
  h,
  fill,
  stroke,
  label,
  sub,
  onClick,
  tone,
  pulse,
}: {
  cx: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  label: string;
  sub: string;
  onClick?: () => void;
  tone: string;
  pulse: boolean;
}) {
  const x0 = cx - w / 2;
  const clickable = !!onClick;
  const aria = sub ? `${label} — ${sub}` : label;
  function onKeyDown(e: KeyboardEvent) {
    if (!clickable) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onClick?.();
  }
  return (
    <g class="onode" tabIndex={0} role={clickable ? "button" : "img"} aria-label={aria} onClick={onClick} onKeyDown={onKeyDown}>
      <rect x={x0} y={y} width={w} height={h} rx="12" fill={fill} stroke={stroke} stroke-width="1.4" />
      {tone ? <circle class={pulse ? "odot-active" : undefined} cx={x0 + 14} cy={y + h / 2} r="4.5" fill={tone} /> : null}
      <text class="otitle" x={cx + (tone ? 7 : 0)} y={y + (sub ? 21 : h / 2 + 4)} text-anchor="middle" fill="var(--ink)" font-size="13">
        {label}
      </text>
      {sub ? (
        <text x={cx + (tone ? 7 : 0)} y={y + 37} text-anchor="middle" fill="var(--ink-3)" font-size="11">
          {sub}
        </text>
      ) : null}
    </g>
  );
}

// app.html:966-968 — the dashed package-cluster header. Not built via
// OrgNode: it carries no click handler, no tabIndex/role/aria at all.
function PkgCluster({ cx, y, label }: { cx: number; y: number; label: string }) {
  const x0 = cx - (colW - 12) / 2;
  return (
    <g class="onode">
      <rect
        x={x0}
        y={y}
        width={colW - 12}
        height={pkgH - 6}
        rx="8"
        fill="color-mix(in srgb, var(--accent) 7%, var(--panel-2))"
        stroke="var(--accent)"
        stroke-opacity="0.5"
        stroke-dasharray="3 3"
        stroke-width="1"
      />
      <text class="otitle" x={cx} y={y + 15} text-anchor="middle" fill="var(--ink-2)" font-size="11">
        {label}
      </text>
    </g>
  );
}

export function OrgChart() {
  const s = snapshot.value;
  // Subscribe to the filter/pan-zoom signals so this component re-renders on
  // every keystroke and every zoom/pan tick.
  orgQuery.value;
  const xf = orgTransform.value;
  const wrapRef = useRef<HTMLDivElement>(null);

  // app.html:1014-1065 — wheel-zoom-at-cursor, drag-pan, dblclick-reset.
  // Attached imperatively (not via onWheel/onPointerDown JSX props) so the
  // wheel listener can be registered non-passive (preventDefault needs it).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    wrap.style.cursor = "grab";
    let drag: { x: number; y: number; ox: number; oy: number } | null = null;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = wrap!.getBoundingClientRect();
      zoomAtPoint(e.clientX - r.left, e.clientY - r.top, e.deltaY);
    }
    function onPointerDown(e: PointerEvent) {
      // Don't start a drag when the pointer comes down on a clickable node —
      // let the click open the specialist's CV instead.
      if ((e.target as HTMLElement).closest?.('.onode[role="button"]')) return;
      const cur = orgTransform.value;
      drag = { x: e.clientX, y: e.clientY, ox: cur.x, oy: cur.y };
      wrap!.style.cursor = "grabbing";
      try {
        wrap!.setPointerCapture(e.pointerId);
      } catch {
        // ignored, matches the monolith's try/catch(_) around setPointerCapture
      }
    }
    function onPointerMove(e: PointerEvent) {
      if (!drag) return;
      orgTransform.value = { ...orgTransform.value, x: drag.ox + (e.clientX - drag.x), y: drag.oy + (e.clientY - drag.y) };
    }
    function onPointerUp() {
      drag = null;
      wrap!.style.cursor = "grab";
    }
    function onDblClick() {
      orgTransform.value = { s: 1, x: 0, y: 0 };
    }

    wrap.addEventListener("wheel", onWheel, { passive: false });
    wrap.addEventListener("pointerdown", onPointerDown);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerup", onPointerUp);
    wrap.addEventListener("dblclick", onDblClick);
    return () => {
      wrap.removeEventListener("wheel", onWheel);
      wrap.removeEventListener("pointerdown", onPointerDown);
      wrap.removeEventListener("pointermove", onPointerMove);
      wrap.removeEventListener("pointerup", onPointerUp);
      wrap.removeEventListener("dblclick", onDblClick);
    };
  }, []);

  const repos = s.repos.filter((r) => orgRepoVisible(s.workers, r.name)).map((r) => r.name);

  if (repos.length === 0) {
    return (
      <div class="orgwrap" id="orgwrap" ref={wrapRef}>
        <div class="sub" style={{ padding: "24px 12px" }}>
          {t("org_nomatch")}
        </div>
      </div>
    );
  }

  // app.html:929-940 — per repo, group specialists by package (w.package);
  // "" = repo-level. Each package becomes a labelled cluster.
  const colsData = repos.map((r) => {
    const info = s.repos.find((x) => x.name === r) as Repo;
    const mono = !!(info.packages && info.packages.length > 0);
    const g = new Map<string, Worker[]>();
    orgWorkersFor(s.workers, r).forEach((w) => {
      const k = w.package || "";
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(w);
    });
    const rows: Row[] = [];
    let y = yS0;
    for (const [pkg, ws] of g) {
      if (pkg) {
        rows.push({ type: "pkg", label: pkg, y });
        y += pkgH;
      }
      ws.forEach((w) => {
        rows.push({ type: "spec", w, y });
        y += sH;
      });
      y += grpGap;
    }
    return { r, info, mono, rows, botY: y };
  });

  let x = 24;
  const cols: Col[] = colsData.map((cd) => {
    const col = { ...cd, x, cx: x + colW / 2 };
    x += colW + gap;
    return col;
  });
  const totalW = Math.max(560, x + 24);
  const totalH = Math.max(yS0, ...cols.map((c) => c.botY)) + 16;
  const cxAll = totalW / 2;

  // app.html:944-946 — cross-repo relation edges (drawn first, behind the
  // link/node layers).
  const edges = (s.relations as Relation[]).flatMap((e) => {
    const a = cols.find((c) => c.r === e.from);
    const b = cols.find((c) => c.r === e.to);
    if (!a || !b) return [];
    const y = yR - 10;
    const mid = (a.cx + b.cx) / 2;
    const lift = 44 + Math.abs(a.cx - b.cx) * 0.05;
    return [
      <path key={`oedge-${e.from}-${e.to}`} class="oedge" d={`M ${a.cx} ${y} Q ${mid} ${y - lift} ${b.cx} ${y}`} />,
      <text key={`oedge-l-${e.from}-${e.to}`} class="oedge-l" x={mid} y={y - lift + 3} text-anchor="middle">
        {e.type}
      </text>,
    ];
  });

  // app.html:947-948 — coordinator->column and column->row connector links.
  const links = cols.flatMap((c) => [
    <path key={`olink-${c.r}`} class="olink" d={`M ${cxAll} ${yC + 22} C ${cxAll} ${yR}, ${c.cx} ${yR}, ${c.cx} ${yR - 14}`} />,
    ...c.rows.map((row, i) => <path key={`olink-${c.r}-${i}`} class="olink" d={`M ${c.cx} ${yR + 34} L ${c.cx} ${row.y - 2}`} />),
  ]);

  return (
    <div class="orgwrap" id="orgwrap" ref={wrapRef}>
      <svg
        width={totalW}
        height={totalH}
        viewBox={`0 0 ${totalW} ${totalH}`}
        style={{ transformOrigin: "0 0", transform: `translate(${xf.x}px, ${xf.y}px) scale(${xf.s})` }}
      >
        {edges}
        {links}
        <OrgNode
          cx={cxAll}
          y={yC}
          w={208}
          h={44}
          fill="color-mix(in srgb, var(--accent) 11%, var(--panel))"
          stroke="var(--accent)"
          label={s.context.coordinator || "coordinator"}
          sub="coordinator"
          tone="var(--accent)"
          pulse={false}
        />
        {cols.map((c) => {
          const cat = c.info.kind || "";
          const rsub = c.mono ? (cat ? `${t("t_monorepo")} · ${cat}` : t("t_monorepo")) : cat || t("t_repo");
          return (
            <>
              <OrgNode
                key={`repo-${c.r}`}
                cx={c.cx}
                y={yR - 14}
                w={colW - 12}
                h={48}
                fill="var(--panel-2)"
                stroke={c.mono ? "var(--accent)" : "var(--line-2)"}
                label={c.r}
                sub={rsub}
                tone={c.mono ? "var(--accent)" : ""}
                pulse={false}
              />
              {c.rows.length === 0 ? (
                <text x={c.cx} y={yS0 + 14} text-anchor="middle" class="oedge-l">
                  {t("nospec")}
                </text>
              ) : null}
              {c.rows.map((row, i) =>
                row.type === "pkg" ? (
                  <PkgCluster key={`pkg-${c.r}-${i}`} cx={c.cx} y={row.y} label={row.label} />
                ) : (
                  <OrgNode
                    key={`spec-${c.r}-${i}`}
                    cx={c.cx}
                    y={row.y}
                    w={colW - 12}
                    h={48}
                    fill={`color-mix(in srgb, ${orgColor(row.w.status)} 8%, var(--panel))`}
                    stroke={orgColor(row.w.status)}
                    label={row.w.name}
                    sub={row.w.role || ""}
                    onClick={() => {
                      openWorkerName.value = row.w.name;
                    }}
                    tone={orgColor(row.w.status)}
                    pulse={row.w.status === "active"}
                  />
                ),
              )}
            </>
          );
        })}
      </svg>
    </div>
  );
}
