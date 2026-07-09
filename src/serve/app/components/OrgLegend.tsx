// Compact legend under the org chart — spells out what each node type means.
// Ported 1:1 from orgLegend (app.html:1002-1012); five fixed items.
import type { ComponentChildren } from "preact";
import { t } from "../runtime/i18n";

function LegendItem({ swatch, label }: { swatch: ComponentChildren; label: string }) {
  return (
    <span class="lg-i">
      {swatch}
      <span>{label}</span>
    </span>
  );
}

function Dot({ color }: { color: string }) {
  return <span class="lg-dot" style={{ background: color }} />;
}

export function OrgLegend() {
  return (
    <div class="orglegend">
      <span class="lg-h">{t("legend")}</span>
      <LegendItem swatch={<Dot color="var(--accent)" />} label={t("lg_coord")} />
      <LegendItem swatch={<span class="lg-box" />} label={t("lg_repo")} />
      <LegendItem swatch={<span class="lg-box mono" />} label={t("lg_monorepo")} />
      <LegendItem swatch={<Dot color="var(--sky)" />} label={t("lg_specialist")} />
      <LegendItem swatch={<span class="lg-line" />} label={t("lg_relation")} />
    </div>
  );
}
