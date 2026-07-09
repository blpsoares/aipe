import { Fragment } from "preact";
import { t } from "../runtime/i18n";
import { unitLines } from "../runtime/selectors";
import type { Worker } from "../runtime/store";

// Ported from app.html:880-887 (unitBlock's `<dl class="kv">`). Reused by
// WorkerDrawer (Task 10) and WorkerCard (Task 14).
export function UnitFacts({ worker }: { worker: Worker }) {
  const rows = unitLines(worker);
  return (
    <dl class="kv">
      {rows.map((r) => (
        <Fragment key={r.key}>
          <dt>{t("f_" + r.key)}</dt>
          <dd>{r.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
