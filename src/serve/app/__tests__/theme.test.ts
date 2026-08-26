import "./setup";
import { expect, test, beforeEach } from "bun:test";
import { theme, setTheme, cycleTheme, applyTheme, readStoredTheme, THEME_KEY } from "../runtime/theme";

beforeEach(() => {
  try { localStorage.removeItem(THEME_KEY); } catch {}
  document.documentElement.removeAttribute("data-theme");
  theme.value = "";
});

test("setTheme persists to localStorage and applies the attribute — survives a reload", () => {
  setTheme("dark");
  expect(theme.value).toBe("dark");
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  // a reload re-reads storage
  expect(readStoredTheme()).toBe("dark");
});

test("setTheme('') means auto — removes the attribute and stores empty", () => {
  setTheme("dark");
  setTheme("");
  expect(theme.value).toBe("");
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  // auto is a real stored choice (not 'never chosen'), so a reload keeps auto
  expect(readStoredTheme()).toBe("");
});

test("cycleTheme walks auto → dark → light → auto through the SAME setter both controls use", () => {
  setTheme(""); // auto
  cycleTheme();
  expect(theme.value).toBe("dark");
  cycleTheme();
  expect(theme.value).toBe("light");
  cycleTheme();
  expect(theme.value).toBe("");
  // and every hop persisted — the Topbar toggle and the Settings segment can never disagree
  expect(localStorage.getItem(THEME_KEY)).toBe("");
});

test("applyTheme is a pure attribute writer usable before hydration", () => {
  applyTheme("light");
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  applyTheme("");
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
});

test("readStoredTheme returns null when nothing was ever chosen (true auto default)", () => {
  try { localStorage.removeItem(THEME_KEY); } catch {}
  expect(readStoredTheme()).toBeNull();
});
