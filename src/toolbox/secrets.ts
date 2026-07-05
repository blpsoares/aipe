// The toolbox catalog (.aipe/toolbox.yaml) is published with the workspace, so
// an MCP server's `config` must never carry a literal secret — only environment
// references (e.g. "${PG_URL}"). This finds likely literal secrets so
// `aipe mcp add` can refuse them.
const SECRET_KEY =
  /(pass(word|wd)?|secret|token|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|credential|client[-_ ]?secret|authorization|bearer|dsn)/i;

function isEnvRef(v: string): boolean {
  return /\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*/.test(v);
}

// user:pass@host embedded in a URL (but not ${VAR}:${VAR}@host env refs).
function hasInlineUrlCreds(v: string): boolean {
  return !isEnvRef(v) && /:\/\/[^/\s]+:[^/\s@]+@/.test(v);
}

// Returns the dotted paths of fields that look like literal secrets.
export function findSecrets(config: unknown): string[] {
  const hits = new Set<string>();

  const walk = (value: unknown, path: string, key: string | null): void => {
    if (typeof value === "string") {
      if (hasInlineUrlCreds(value)) hits.add(path || "(root)");
      if (key !== null && SECRET_KEY.test(key) && value.length > 0 && !isEnvRef(value)) {
        hits.add(path);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((e, i) => walk(e, `${path}[${i}]`, null));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        walk(v, path ? `${path}.${k}` : k, k);
      }
    }
  };

  walk(config, "", null);
  return [...hits];
}
