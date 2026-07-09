import { test, expect, beforeEach } from "bun:test";
import { t, stt, setLang, lang, interpolate, STR } from "../runtime/i18n";

beforeEach(() => { lang.value = "en"; });

test("t() resolve en e pt", () => {
  expect(t("nav_overview")).toBe("Overview");
  setLang("pt");
  expect(t("nav_overview")).toBe("Visão geral");
});

test("t() cai no fallback en para idioma não suportado", () => {
  // @ts-expect-error forçar valor inválido
  lang.value = "fr";
  expect(t("nav_overview")).toBe("Overview");
});

test("t() retorna a própria chave se ausente em ambos", () => {
  expect(t("__missing__")).toBe("__missing__");
});

test("stt() prefixa st_ e traduz status", () => {
  expect(stt("active")).toBe("active");
  setLang("pt");
  expect(stt("active")).toBe("ativo");
});

test("STR.en e STR.pt têm exatamente as mesmas chaves", () => {
  const en = Object.keys(STR.en).sort();
  const pt = Object.keys(STR.pt).sort();
  expect(pt).toEqual(en);
});

test("interpolate substitui placeholders", () => {
  expect(interpolate("{n} escalation needs you", { n: 2 })).toBe("2 escalation needs you");
});

test("rel_now existe em ambos os idiomas (migrado de reltime hardcoded)", () => {
  expect(STR.en.rel_now).toBe("now");
  expect(STR.pt.rel_now).toBe("agora");
});
