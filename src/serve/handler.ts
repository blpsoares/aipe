// The pure HTTP surface of `aipe serve`: given a Request and the workspace +
// embedded SPA, return a Response. No sockets, no streaming — so it is
// unit-testable in isolation. The live server (server.ts) wraps this with the
// SSE snapshot and monitor streams.
import { buildSnapshot } from "../dashboard/snapshot";

export interface HandlerCtx {
  workspace: string;
  getHtml: () => Promise<string>;
}

export async function handleRequest(req: Request, ctx: HandlerCtx): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return new Response(await ctx.getHtml(), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (req.method === "GET" && url.pathname === "/api/snapshot") {
    const snapshot = await buildSnapshot(ctx.workspace);
    return Response.json(snapshot, { headers: { "cache-control": "no-store" } });
  }

  return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
}
