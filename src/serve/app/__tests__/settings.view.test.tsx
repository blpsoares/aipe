import "./setup";
import { test, expect, afterEach, beforeEach, mock } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { route } from "../views/settings.view";
import { NOTIF } from "../runtime/notify";
import { lang, setLang } from "../runtime/i18n";

const SettingsView = route.component;

const DEFAULT_NOTIF = { enabled: true, desktop: false, sound: true, ev: { dispatch: true, delivered: true, escalated: true, merged: true } };

beforeEach(() => {
  localStorage.clear();
  NOTIF.value = { ...DEFAULT_NOTIF, ev: { ...DEFAULT_NOTIF.ev } };
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  cleanup();
  setLang("en");
});

test("route contract: path/order/icon preserved", () => {
  expect(route.path).toBe("/settings");
  expect(route.nav).toEqual({ label: "nav_settings", icon: "⚙", order: 7 });
});

test("header + two .card.pad sections rendered", () => {
  const { container } = render(<SettingsView />);
  expect(container.querySelector("h1.view-h")!.textContent).toBe("Settings");
  const cards = container.querySelectorAll(".card.pad");
  expect(cards.length).toBe(2);
  expect(cards[0]!.querySelector(".set-h")!.textContent).toBe("Notifications");
  expect(cards[1]!.querySelector(".set-h")!.textContent).toBe("Appearance");
});

test("enabled switch reflects NOTIF.enabled and toggling flips + persists it", () => {
  const { container } = render(<SettingsView />);
  const sw = container.querySelectorAll(".srow .sw")[0] as HTMLButtonElement;
  expect(sw.classList.contains("on")).toBe(true);
  expect(sw.getAttribute("aria-checked")).toBe("true");

  fireEvent.click(sw);
  expect(NOTIF.value.enabled).toBe(false);
  expect(JSON.parse(localStorage.getItem("aipe-notif") || "{}").enabled).toBe(false);
});

test("sound switch toggles NOTIF.sound", () => {
  const { container } = render(<SettingsView />);
  const rows = container.querySelectorAll(".srow");
  // rows: enable, desktop, sound, then 4 erows, then theme, lang
  const soundSw = rows[2]!.querySelector(".sw") as HTMLButtonElement;
  expect(soundSw.classList.contains("on")).toBe(true);
  fireEvent.click(soundSw);
  expect(NOTIF.value.sound).toBe(false);
});

test("event switches (dispatch/delivered/escalated/merged) toggle NOTIF.ev[key]", () => {
  const { container } = render(<SettingsView />);
  const erows = container.querySelectorAll(".srow.erow");
  expect(erows.length).toBe(4);
  const keys: Array<keyof typeof DEFAULT_NOTIF.ev> = ["dispatch", "delivered", "escalated", "merged"];
  const clsList = ["active", "delivered", "escalated", "merged"];
  erows.forEach((row, i) => {
    const dot = row.querySelector(".edot")!;
    expect(dot.className).toBe("edot bg-" + clsList[i]);
    const sw = row.querySelector(".sw") as HTMLButtonElement;
    expect(sw.classList.contains("on")).toBe(true);
    fireEvent.click(sw);
    expect(NOTIF.value.ev[keys[i]!]).toBe(false);
  });
});

test("desktop permission chip: granted", () => {
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { permission: "granted", requestPermission: mock(() => Promise.resolve("granted")) },
  });
  const { container } = render(<SettingsView />);
  const chip = container.querySelector(".chip.delivered");
  expect(chip).not.toBeNull();
  expect(chip!.textContent).toBe("Permission granted");
  expect(container.querySelector("[data-act='grant']")).toBeNull();
});

test("desktop permission chip: denied", () => {
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { permission: "denied", requestPermission: mock(() => Promise.resolve("denied")) },
  });
  const { container } = render(<SettingsView />);
  const chip = container.querySelector(".chip.escalated");
  expect(chip).not.toBeNull();
  expect(chip!.textContent).toBe("Blocked — allow it in the browser's site settings.");
});

test("desktop permission: default shows grant button, click requests permission", () => {
  const requestPermission = mock(() => Promise.resolve("granted"));
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { permission: "default", requestPermission },
  });
  const { container } = render(<SettingsView />);
  const btn = container.querySelector("[data-act='grant']") as HTMLButtonElement;
  expect(btn).not.toBeNull();
  expect(btn.textContent).toBe("Grant permission");
  fireEvent.click(btn);
  expect(requestPermission).toHaveBeenCalled();
});

test("toggling desktop on with permission default also requests permission", () => {
  const requestPermission = mock(() => Promise.resolve("granted"));
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { permission: "default", requestPermission },
  });
  const { container } = render(<SettingsView />);
  const desktopRow = container.querySelectorAll(".srow")[1]!;
  const sw = desktopRow.querySelector(".sw") as HTMLButtonElement;
  expect(NOTIF.value.desktop).toBe(false);
  fireEvent.click(sw);
  expect(NOTIF.value.desktop).toBe(true);
  expect(requestPermission).toHaveBeenCalled();
});

test("test button fires notify(): desktop notification with AIPe title + translated body", () => {
  NOTIF.value = { ...NOTIF.value, enabled: true, desktop: true, sound: false };
  const calls: Array<{ title: string; body?: string }> = [];
  function MockNotification(title: string, opts?: { body?: string }) {
    calls.push({ title, body: opts?.body });
  }
  MockNotification.permission = "granted";
  Object.defineProperty(window, "Notification", { configurable: true, value: MockNotification });

  const { container } = render(<SettingsView />);
  const btn = container.querySelector("[data-act='test']") as HTMLButtonElement;
  expect(btn.textContent).toContain("Send a test notification");
  fireEvent.click(btn);

  expect(calls.length).toBe(1);
  expect(calls[0]!.title).toBe("AIPe");
  expect(calls[0]!.body).toBe("Notifications are working ✓");
});

test("theme buttons set/remove data-theme; active button reflects current theme", () => {
  const { container } = render(<SettingsView />);
  const themeSeg = container.querySelectorAll(".langseg")[0]!;
  const buttons = [...themeSeg.querySelectorAll("button")];
  expect(buttons.map((b) => b.textContent)).toEqual(["Auto", "Light", "Dark"]);
  expect(buttons[0]!.classList.contains("on")).toBe(true);

  fireEvent.click(buttons[2]!);
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

  fireEvent.click(buttons[1]!);
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");

  fireEvent.click(buttons[0]!);
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
});

test("lang buttons call setLang and mark the active language", () => {
  const { container } = render(<SettingsView />);
  const langSeg = container.querySelectorAll(".langseg")[1]!;
  const buttons = [...langSeg.querySelectorAll("button")];
  expect(buttons.map((b) => b.textContent)).toEqual(["EN", "PT"]);
  expect(buttons[0]!.classList.contains("on")).toBe(true);

  fireEvent.click(buttons[1]!);
  expect(lang.value).toBe("pt");
});
