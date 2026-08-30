// One-click copy of an exact command. Copying is inherently read-only — the
// console's explicit choice (SDD §3): a console that SHOWS the command carries no
// risk of a destructive click, because it never runs anything. Shared by the
// Floor's decision inbox and the Atividade board's cards so the affordance is
// identical wherever "here is the next step" appears.
import { useState } from "preact/hooks";
import { t } from "../runtime/i18n";

export function CopyCmd({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: MouseEvent) => {
    e.stopPropagation();
    try {
      void navigator?.clipboard?.writeText(command);
    } catch {
      // clipboard unavailable — the command text is still visible to select by hand
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div class="ic-cmd">
      <code class="ic-cmd-text">{command}</code>
      <button type="button" class="ic-cmd-copy" onClick={copy} aria-label={t("fa_copy")}>
        {copied ? t("fa_copied") : t("fa_copy")}
      </button>
    </div>
  );
}
