import { signal } from "@preact/signals";
import { stt, t } from "../runtime/i18n";
import { statusMeta, STAGE_GUIDE_ORDER } from "../runtime/statusMeta";
import { StatusIcon } from "./StatusIcon";

// The stage guide: a plain-language glossary of every pipeline stage, so anyone
// can read (and explain) what "dispatched / delivered / verified / failed /
// escalated / merged" actually mean. Collapsible; open state is a signal (the
// app's state primitive), shared across mounts.
const legendOpen = signal(true);

export function StatusLegend() {
  const shown = legendOpen.value;
  return (
    <div class="card legend">
      <button
        class="legend-head"
        aria-expanded={shown}
        onClick={() => (legendOpen.value = !legendOpen.value)}
      >
        <span class="eyebrow">{t("legend_title")}</span>
        <span class="legend-toggle">{shown ? t("legend_hide") : t("legend_show")}</span>
      </button>
      {shown ? (
        <div class="legend-grid">
          {STAGE_GUIDE_ORDER.map((s) => (
            <div class="legend-item" key={s}>
              <span class={`chip ${s}`}>
                <StatusIcon k={s} size={13} />
                {stt(s)}
              </span>
              <span class="legend-desc">{t(statusMeta(s).descKey)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
