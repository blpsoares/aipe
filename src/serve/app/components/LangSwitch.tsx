import { lang, setLang } from "../runtime/i18n";

// EN/PT segmented control (app.html:480 header + 828 settings — same markup,
// reused by both instead of duplicated). Reads the `lang` signal directly so
// it re-renders on language change without any manual applyI18n() pass.
export function LangSwitch() {
  const cur = lang.value;
  return (
    <div class="langseg" id="langSeg">
      <button type="button" data-lang="en" class={cur === "en" ? "on" : ""} onClick={() => setLang("en")}>
        EN
      </button>
      <button type="button" data-lang="pt" class={cur === "pt" ? "on" : ""} onClick={() => setLang("pt")}>
        PT
      </button>
    </div>
  );
}
