// Wires the PDD (Parity-Driven Development) plugin into a repo — PDD is a living
// Claude Code plugin (hooks + skills + updates), so it must be installed from its
// marketplace, not vendored/frozen. `aipe skill add pdd` merges the marketplace +
// plugin enablement into the repo's .claude/settings.json (idempotent), so opening
// the repo in Claude Code loads the real, up-to-date plugin.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MARKETPLACE = "parity-driven-development";
const MARKETPLACE_REPO = "blpsoares/parity-driven-development";
const PLUGIN_KEY = "pdd@parity-driven-development";

interface Settings {
  extraKnownMarketplaces?: Record<string, unknown>;
  enabledPlugins?: Record<string, boolean>;
  [k: string]: unknown;
}

async function readSettings(path: string): Promise<Settings> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed && typeof parsed === "object") return parsed as Settings;
  } catch {
    // missing or malformed → start fresh
  }
  return {};
}

// Merges the PDD marketplace + plugin enablement into <repo>/.claude/settings.json.
// Preserves any existing settings (other marketplaces/plugins). Returns the path.
export async function wirePdd(repoAbsDir: string): Promise<string> {
  const claudeDir = join(repoAbsDir, ".claude");
  await mkdir(claudeDir, { recursive: true });
  const settingsPath = join(claudeDir, "settings.json");

  const settings = await readSettings(settingsPath);
  settings.extraKnownMarketplaces = {
    ...(settings.extraKnownMarketplaces ?? {}),
    [MARKETPLACE]: { source: { source: "github", repo: MARKETPLACE_REPO } },
  };
  settings.enabledPlugins = { ...(settings.enabledPlugins ?? {}), [PLUGIN_KEY]: true };

  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settingsPath;
}
