import { stt, t } from "../runtime/i18n";
import { statusMeta } from "../runtime/statusMeta";
import { StatusIcon } from "./StatusIcon";

// A status pill: a meaningful icon + the label, with the plain-language
// description as an accessible tooltip (hover + screen readers) so every status
// is self-explanatory. The className stays exactly `chip <status>` and the text
// stays exactly the label — the icon is an SVG (contributes no textContent).
export function Chip({ status }: { status: string }) {
  const desc = t(statusMeta(status).descKey);
  return (
    <span class={`chip ${status}`} title={desc} aria-label={`${stt(status)} — ${desc}`}>
      <StatusIcon k={status} size={13} />
      {stt(status)}
    </span>
  );
}
