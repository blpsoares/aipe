import { t } from "../runtime/i18n";
import { snapshot, type Snapshot } from "../runtime/store";
import type { Route } from "../route-types";

type Skill = Snapshot["toolbox"]["skills"][number];
type Mcp = Snapshot["toolbox"]["mcps"][number];

const ROW_STYLE = { padding: "10px 0", borderTop: "1px solid var(--line)" };

function SkillRow({ s }: { s: Skill }) {
  return (
    <div class="between" style={ROW_STYLE}>
      <div>
        <b>{s.name}</b>
        <div class="sub">{s.when}</div>
      </div>
      <span class="tag">{s.repos.join(", ")}</span>
    </div>
  );
}

function McpRow({ m }: { m: Mcp }) {
  return (
    <div class="between" style={ROW_STYLE}>
      <b>{m.name}</b>
      <span class="chip idle">
        <span class="d" />
        {m.scope}
      </span>
    </div>
  );
}

// app.html:773-785 (toolbox view). No .between/action buttons on the header
// (unlike other views) and no empty-state markup — parity with the monolith.
// Deviation: the monolith escaped only `s.when` via esc(); `s.name`, `s.repos`,
// `m.name`, `m.scope` were interpolated raw/unescaped. JSX auto-escapes all
// text uniformly, so those fields are now escaped too — an intended, safer
// side effect of the Preact migration, not reproduced as raw HTML here.
function ToolboxView() {
  const tb = snapshot.value.toolbox;
  return (
    <div class="view-in grid" style={{ gap: "16px" }}>
      <div>
        <h1 class="view-h">{t("nav_toolbox")}</h1>
        <div class="sub">{t("tb_sub")}</div>
      </div>
      <div class="grid cols-2">
        <div class="card pad">
          <div class="eyebrow" style={{ marginBottom: "12px" }}>
            {t("skillpkgs")}
          </div>
          {tb.skills.map((s) => (
            <SkillRow key={s.name} s={s} />
          ))}
        </div>
        <div class="card pad">
          <div class="eyebrow" style={{ marginBottom: "12px" }}>
            {t("mcps")}
          </div>
          {tb.mcps.map((m) => (
            <McpRow key={m.name} m={m} />
          ))}
        </div>
      </div>
    </div>
  );
}

export const route: Route = {
  path: "/toolbox",
  nav: { label: "nav_toolbox", icon: "⬡", order: 4 },
  component: ToolboxView,
};
