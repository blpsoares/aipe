// The Atividade board: the columns the PE built, each with CONTAINED height and
// its own scroll so a long column never stretches the page (item 1), and a header
// that always states the count so a scrolled-off card is never read as "that's
// all" — elisão silenciosa lê-se como "isso é tudo" (SDD §5). Cards paint state
// through --st-* and show the envelope by-exception (SDD §8/§9).
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { t } from "../runtime/i18n";
import { ActivityCard } from "./ActivityCard";
import { Icon } from "./Icon";
import { groupBoard, envelopeNorm, type BoardConfig, type BoardGroupCol } from "../runtime/activity";
import type { BoardCard, BoardColumn } from "../runtime/board";
import type { Envelope } from "../runtime/activity";
import type { Dispatch } from "../runtime/store";
import type { SessionInfo } from "../../sessions";

const COL_SUB: Record<BoardColumn, string> = {
  working: "board_col_working_sub",
  "needs-you": "board_col_needs_you_sub",
  "in-review": "board_col_in_review_sub",
  ready: "board_col_ready_sub",
  integrated: "board_col_integrated_sub",
};

// A scroll container that reports whether cards are BELOW the fold, so the column
// declares "N fora da vista" instead of silently hiding them. Measured from real
// layout (scrollHeight vs clientHeight) on mount, scroll and resize; in a layout-
// less environment (tests) it simply reports zero — the header count still shows.
function ColumnBody({ cards, norm }: { cards: BoardCard[]; norm: Envelope }) {
  const ref = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(0);

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const kids = [...el.querySelectorAll<HTMLElement>(".acard")];
    const foldBottom = el.scrollTop + el.clientHeight;
    // A card counts as "below the fold" when its top starts past the visible area.
    const n = kids.filter((k) => k.offsetTop >= foldBottom - 2).length;
    setBelow(n);
  };

  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length]);

  if (cards.length === 0) return <div class="acol-body"><div class="acol-empty sub">{t("board_col_empty")}</div></div>;
  return (
    <div class="acol-wrap">
      <div class="acol-body" ref={ref} onScroll={measure}>
        {cards.map((c, i) => (
          <ActivityCard key={`${c.dispatch.specialist}|${c.dispatch.journey}|${i}`} card={c} norm={norm} />
        ))}
      </div>
      {below > 0 ? (
        <div class="acol-more sub" aria-hidden="true">
          <Icon name="collapse" size={12} /> {t("act_more_below").replace("{n}", String(below))}
        </div>
      ) : null}
    </div>
  );
}

/** The board norm stated once — so cards can stay quiet about the common envelope
 *  and only shout the exception (SDD §8). */
function NormNote({ norm }: { norm: Envelope }) {
  const parts = [norm.harness, norm.model ? norm.model.replace(/^claude-/, "") : undefined, norm.intensity].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <div class="aboard-norm sub" title={t("act_norm_hint")}>
      {t("act_norm_pre")} <code>{parts.join(" · ")}</code>
    </div>
  );
}

export function ActivityBoard({
  dispatches,
  sessions,
  config,
}: {
  dispatches: Dispatch[];
  sessions: SessionInfo[];
  config: BoardConfig;
}) {
  const cols: BoardGroupCol[] = groupBoard(dispatches, sessions, config);
  const norm = envelopeNorm(cols.flatMap((c) => c.cards.map((k) => k.dispatch)));
  return (
    <div class="aboard-wrap">
      <NormNote norm={norm} />
      <div class="aboard" role="list">
        {cols.map((col) => {
          const label = col.labelIsKey ? t(col.label) : col.label;
          return (
            <section key={col.key} class={`acol${col.column ? ` bcol-${col.column}` : ""}`} role="listitem" aria-label={label}>
              <header class="acol-head">
                <div class="acol-title">
                  <span class="bcol-dot" />
                  <span class="acol-name">{label}</span>
                  <span class="acol-count num" aria-label={t("act_count_aria")}>{col.total}</span>
                </div>
                {col.column ? <div class="acol-sub sub">{t(COL_SUB[col.column])}</div> : null}
              </header>
              <ColumnBody cards={col.cards} norm={norm} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
