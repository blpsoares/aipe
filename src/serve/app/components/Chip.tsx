import { stt, t } from "../runtime/i18n";
import { statusMeta } from "../runtime/statusMeta";
import { StatusIcon } from "./StatusIcon";
import { navigate, focusAnchor } from "../runtime/router";

// A status chip. Clicking it opens the status guide (5.3) scrolled to this
// status — the chip is the affordance to learn what a state means. It lives
// inside clickable rows (which are <button>s), so it stops propagation and stays
// a <span> (a nested <button> would be invalid HTML) with link semantics.
export function Chip({ status }: { status: string }) {
  const desc = t(statusMeta(status).descKey);
  const go = (e: Event) => {
    e.stopPropagation();
    focusAnchor.value = `s-${status}`;
    navigate("/status");
  };
  return (
    <span
      class={`chip chip-link ${status}`}
      role="link"
      tabIndex={0}
      title={`${desc} — ${t("sg_col_means")}`}
      aria-label={`${stt(status)} — ${desc}`}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") go(e);
      }}
    >
      <StatusIcon k={status} size={13} />
      {stt(status)}
    </span>
  );
}
