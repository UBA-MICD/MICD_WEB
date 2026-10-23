/**
 * Tests for the FAQ screen's pure pieces (US-44): the accent-insensitive search
 * filter and the catalog's i18n coverage. No DOM — filterFaqTopics takes an
 * injected translator, so it runs under Node's bare test runner.
 *
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { filterFaqTopics, normalize } from "./faq.ts";
import { faqTopics } from "./faq-content.ts";
import { es } from "../i18n/locales/es.ts";
import { en } from "../i18n/locales/en.ts";

const tr = (key: string): string => es[key] ?? key;

test("normalize lowercases and strips diacritics", () => {
  assert.equal(normalize("Médico ÁÉÍÓÚ"), "medico aeiou");
});

test("empty / whitespace query returns every theme in full", () => {
  const res = filterFaqTopics(faqTopics, "   ", tr);
  assert.equal(res.length, faqTopics.length);
  res.forEach((m, i) =>
    assert.equal(m.entries.length, faqTopics[i].entries.length),
  );
});

test("a query with no match returns an empty list", () => {
  assert.deepEqual(filterFaqTopics(faqTopics, "zzzqxywv", tr), []);
});

test("searching a question's own text surfaces that question", () => {
  for (const topic of faqTopics) {
    for (const e of topic.entries) {
      const res = filterFaqTopics(faqTopics, es[e.questionKey], tr);
      const found = res.some((m) => m.entries.some((x) => x.id === e.id));
      assert.ok(found, `expected to find ${e.id}`);
    }
  }
});

test("search ignores accents (unaccented query matches accented copy)", () => {
  // Most questions start with "¿Cómo…"; the de-accented "como" must still hit.
  const res = filterFaqTopics(faqTopics, "como", tr);
  assert.ok(res.some((m) => m.entries.length > 0));
});

test("a theme-title match keeps all of that theme's questions", () => {
  const zenodo = faqTopics.find((t) => t.id === "zenodo")!;
  const res = filterFaqTopics(faqTopics, es[zenodo.titleKey], tr);
  const match = res.find((m) => m.topic.id === "zenodo")!;
  assert.equal(match.entries.length, zenodo.entries.length);
});

test("every FAQ topic/question/answer key exists in both locales", () => {
  for (const topic of faqTopics) {
    assert.ok(topic.titleKey in es, `es missing ${topic.titleKey}`);
    assert.ok(topic.titleKey in en, `en missing ${topic.titleKey}`);
    for (const e of topic.entries) {
      assert.ok(e.questionKey in es, `es missing ${e.questionKey}`);
      assert.ok(e.questionKey in en, `en missing ${e.questionKey}`);
      assert.ok(e.answerKey in es, `es missing ${e.answerKey}`);
      assert.ok(e.answerKey in en, `en missing ${e.answerKey}`);
    }
  }
});
