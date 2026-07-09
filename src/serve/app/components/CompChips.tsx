import { t } from "../runtime/i18n";

// Ported from app.html:895-896.
export function CompChips({ list, max }: { list: string[]; max?: number }) {
  if (list.length === 0) return <span class="sub">{t("none")}</span>;
  const arr = max ? list.slice(0, max) : list;
  const extra = max && list.length > max ? list.length - max : 0;
  return (
    <>
      {arr.map((c) => (
        <span class="comp" key={c}>
          {c}
        </span>
      ))}
      {extra ? <span class="comp more">+{extra}</span> : null}
    </>
  );
}
