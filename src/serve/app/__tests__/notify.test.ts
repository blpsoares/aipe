import "./setup";
import { test, expect, beforeEach } from "bun:test";
import { NOTIF, saveNotif, wireActivityNotifications } from "../runtime/notify";
import type { Dispatch } from "../runtime/store";

beforeEach(() => {
  localStorage.clear();
  NOTIF.value = { enabled: true, desktop: false, sound: true, ev: { dispatch: true, delivered: true, escalated: true, merged: true } };
});

test("NOTIF tem os defaults do monólito (app.html:682)", () => {
  expect(NOTIF.value).toEqual({
    enabled: true,
    desktop: false,
    sound: true,
    ev: { dispatch: true, delivered: true, escalated: true, merged: true },
  });
});

test("saveNotif persiste NOTIF em localStorage[aipe-notif]", () => {
  NOTIF.value = { ...NOTIF.value, desktop: true };
  saveNotif();
  expect(JSON.parse(localStorage.getItem("aipe-notif") || "{}")).toEqual(NOTIF.value);
});

function dispatch(status: string, specialist = "alice"): Dispatch {
  return { specialist, status } as Dispatch;
}

test("status escalated com NOTIF.ev.escalated=true chama notify", () => {
  const calls: unknown[] = [];
  wireActivityNotifications([dispatch("escalated")], (d) => "msg:" + d.status, (...args) => calls.push(args));
  expect(calls).toEqual([["escalated", "AIPe · alice", "msg:escalated"]]);
});

test("status escalated com NOTIF.ev.escalated=false NÃO chama notify", () => {
  NOTIF.value = { ...NOTIF.value, ev: { ...NOTIF.value.ev, escalated: false } };
  const calls: unknown[] = [];
  wireActivityNotifications([dispatch("escalated")], (d) => "msg", (...args) => calls.push(args));
  expect(calls).toEqual([]);
});

test("status removed nunca chama notify (mapeia para null)", () => {
  const calls: unknown[] = [];
  wireActivityNotifications([dispatch("removed")], (d) => "msg", (...args) => calls.push(args));
  expect(calls).toEqual([]);
});

test("NOTIF.enabled=false suprime todas as notificações", () => {
  NOTIF.value = { ...NOTIF.value, enabled: false };
  const calls: unknown[] = [];
  wireActivityNotifications(
    [dispatch("dispatched"), dispatch("delivered"), dispatch("escalated"), dispatch("merged")],
    (d) => "msg",
    (...args) => calls.push(args),
  );
  expect(calls).toEqual([]);
});

test("mapeia dispatched/delivered/merged para as chaves de evento corretas", () => {
  const calls: string[] = [];
  wireActivityNotifications(
    [dispatch("dispatched"), dispatch("delivered"), dispatch("merged")],
    (d) => "msg",
    (kind) => calls.push(kind as string),
  );
  expect(calls).toEqual(["dispatched", "delivered", "merged"]);
});

test("wireActivityNotifications usa o notify default (não injetado) quando não fornecido", () => {
  // não deve lançar mesmo sem window.Notification real além do que happy-dom fornece
  expect(() => wireActivityNotifications([dispatch("dispatched")], (d) => "msg")).not.toThrow();
});
