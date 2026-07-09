import { test, expect } from "bun:test";
import { connectSnapshotStream, bootstrap } from "../runtime/sse";

class FakeES {
  onopen: any; onerror: any; readyState = 1;
  listeners: Record<string, (m: any) => void> = {};
  constructor(public url: string) {}
  addEventListener(ev: string, fn: (m: any) => void) { this.listeners[ev] = fn; }
  emit(ev: string, data: string) { this.listeners[ev]?.({ data }); }
}

test("evento snapshot dispara onSnapshot; message não", () => {
  let got: any = null; let status = "";
  const es = connectSnapshotStream((s) => (got = s), (st) => (status = st), FakeES as any) as unknown as FakeES;
  es.onopen();
  expect(status).toBe("live");
  es.emit("snapshot", JSON.stringify({ ok: true }));
  expect(got).toEqual({ ok: true });
  es.emit("message", JSON.stringify({ ok: false }));
  expect(got).toEqual({ ok: true }); // inalterado
});

test("onerror só marca down em readyState CLOSED(2)", () => {
  let status = "live";
  const es = connectSnapshotStream(() => {}, (st) => (status = st), FakeES as any) as unknown as FakeES;
  es.readyState = 0; es.onerror();
  expect(status).toBe("live");
  es.readyState = 2; es.onerror();
  expect(status).toBe("down");
});

test("connectSnapshotStream degrada para down se o construtor lança", () => {
  let status = "";
  class ThrowingES { constructor() { throw new Error("boom"); } }
  const es = connectSnapshotStream(() => {}, (st) => (status = st), ThrowingES as any);
  expect(es).toBeNull();
  expect(status).toBe("down");
});

test("bootstrap aguarda o fetch inicial antes de conectar o stream", async () => {
  const order: string[] = [];
  const fakeFetch = (async () => {
    // resolve num tick posterior — se bootstrap não await, o connect corre antes
    await Promise.resolve();
    order.push("fetch");
    return { ok: true, json: async () => ({ ok: true }) } as any;
  }) as unknown as typeof fetch;

  let connectedAt = -1;
  class OrderES extends FakeES {
    constructor(url: string) { super(url); order.push("connect"); connectedAt = order.length; }
  }

  await bootstrap(undefined, fakeFetch, OrderES as any);

  expect(order).toEqual(["fetch", "connect"]);
  expect(connectedAt).toBe(2);
});
