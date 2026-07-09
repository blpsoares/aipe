import { Glob } from "bun";
import shell from "./shell.html" with { type: "text" };

const ENTRY = new URL("./main.tsx", import.meta.url).pathname;

export async function buildClient(opts: { minify?: boolean } = {}): Promise<string> {
  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "browser",
    minify: opts.minify ?? true,
    // CSS importado nos .tsx sai como outputs separados (kind: "asset")
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "buildClient failed");
  }
  let js = "";
  let css = "";
  for (const out of result.outputs) {
    if (out.kind === "entry-point" || out.kind === "chunk") js += await out.text();
    else if (out.path.endsWith(".css")) css += await out.text();
  }
  return (shell as unknown as string)
    .replace("/*<!--CLIENT-CSS-->*/", css)
    .replace("<!--CLIENT-JS-->", js);
}

// AUTO-GERADO: escreve src/serve/app/routes.generated.ts a partir de
// src/serve/app/views/*.view.tsx. Tolerante a zero views (routes = []) —
// nenhuma view real existe ainda (chegam na Task 8+).
export async function genRoutes(): Promise<void> {
  const viewsDir = new URL("./views/", import.meta.url).pathname;
  const glob = new Glob("*.view.tsx");
  const files: string[] = [];
  try {
    for await (const f of glob.scan(viewsDir)) files.push(f);
  } catch {
    // views/ ainda não existe — routes = []
  }
  files.sort();
  const imports = files
    .map((f, i) => `import { route as r${i} } from "./views/${f.replace(/\.tsx$/, "")}";`)
    .join("\n");
  const arr = files.map((_, i) => `r${i}`).join(", ");
  const body = `// AUTO-GERADO por genRoutes() — não editar.\n${imports}\n// biome-ignore lint/suspicious/noExplicitAny: array is untyped until Task 8+ defines the Route/view contract\nexport const routes: any[] = [${arr}].sort((a: any, b: any) => a.nav.order - b.nav.order);\n`;
  await Bun.write(new URL("./routes.generated.ts", import.meta.url).pathname, body);
}
