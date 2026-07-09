import { test, expect } from "bun:test";
import { connectSnapshotStream } from "../runtime/sse";

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
