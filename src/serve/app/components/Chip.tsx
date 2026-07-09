import { stt } from "../runtime/i18n";

// Ported from app.html:706.
export function Chip({ status }: { status: string }) {
  return (
    <span class={`chip ${status}`}>
      <span class="d" />
      {stt(status)}
    </span>
  );
}
