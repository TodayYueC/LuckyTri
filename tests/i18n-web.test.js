import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { collectInterfaceText } from "./helpers/i18n-keys.js";

// The web interface is written in Chinese and translated through a table keyed
// by that Chinese text. These tests keep the table and the code in step: every
// wording that is shown has an English entry, nothing stale is left behind,
// and an English line carries the same {placeholders} as its source.

const source = fileURLToPath(new URL("../studio-web/src", import.meta.url));
const { keys, dynamic } = collectInterfaceText(source);
// The page title is set from i18n/index.ts itself, which the scan skips.
keys.set("LuckyTri · TA 的小世界", {
  files: new Set(["i18n/index.ts"]),
  kinds: new Set(["t"]),
});
const { englishTable, t, tn, localized, N_, setLocale, locale, intlLocale } =
  await import("../studio-web/src/i18n/index.ts");

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;
const FULLWIDTH = /[，。：；？！（）「」、]|[\uff01-\uff5e]/;
const placeholders = (text) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("every interface wording is a literal the tests can see", () => {
  assert.deepEqual(
    dynamic,
    [],
    "t()/tn()/N_() need a string literal so the text can be checked and translated: " +
      dynamic.map((d) => `${d.file}:${d.line} ${d.call}`).join(", "),
  );
  assert.ok(keys.size > 1000, "the scan should find the interface wording");
});

test("every wording has an English entry", () => {
  const missing = [...keys.keys()].filter((key) => {
    if (!HAN.test(key)) return false;
    const value = englishTable[key];
    return typeof value !== "string" || !value.trim();
  });
  assert.deepEqual(missing, []);
});

test("English entries are used, not left over", () => {
  const spare = Object.keys(englishTable).filter((key) => !keys.has(key));
  assert.deepEqual(spare, []);
});

test("English entries keep the placeholders of their source", () => {
  const broken = Object.entries(englishTable)
    .filter(([key, value]) => {
      const want = placeholders(key).join();
      // tn() supplies {n} itself, so a counted entry may use it freely.
      const counted = keys.get(key)?.kinds.has("tn");
      const got = placeholders(
        counted ? value.replace(/\{n\}/g, "") : value,
      ).join();
      return want !== got;
    })
    .map(([key, value]) => `${key} -> ${value}`);
  assert.deepEqual(broken, []);
});

test("English entries are in English", () => {
  const stray = Object.entries(englishTable)
    .filter(([, value]) => HAN.test(value) || FULLWIDTH.test(value))
    .map(([key, value]) => `${key} -> ${value}`);
  assert.deepEqual(stray, []);
});

test("the language switches live and falls back to Chinese", () => {
  setLocale("zh");
  assert.equal(t("刚刚"), "刚刚");
  assert.equal(t("{minutes} 分钟前", { minutes: 5 }), "5 分钟前");
  assert.equal(intlLocale(), "zh-CN");

  setLocale("en");
  try {
    assert.equal(locale.value, "en");
    assert.equal(intlLocale(), "en-US");
    assert.equal(t("刚刚"), "just now");
    assert.equal(t("{minutes} 分钟前", { minutes: 5 }), "5 min ago");
    // Wording nobody has translated yet stays readable instead of blank.
    assert.equal(t("这句还没有英文"), "这句还没有英文");
    // A variable that was not given is left visible rather than guessed.
    assert.equal(t("{minutes} 分钟前"), "{minutes} min ago");

    const labels = localized({ calm: N_("平静"), nested: { low: N_("低") } });
    assert.equal(labels.calm, "Calm");
    assert.equal(labels.nested.low, "Low");
    setLocale("zh");
    assert.equal(labels.calm, "平静");
    assert.equal(labels.nested.low, "低");
  } finally {
    setLocale("zh");
  }
});

test("plural wording picks the singular only for one", () => {
  // tn() reads "one|other" from the English entry; Chinese has one form.
  const probe = "{n} 张便签（测试）";
  englishTable[probe] = "{n} note|{n} notes";
  try {
    setLocale("zh");
    assert.equal(tn(probe, 1), "1 张便签（测试）");
    setLocale("en");
    assert.equal(tn(probe, 1), "1 note");
    assert.equal(tn(probe, 0), "0 notes");
    assert.equal(tn(probe, 1200), "1,200 notes");
  } finally {
    delete englishTable[probe];
    setLocale("zh");
  }
});
