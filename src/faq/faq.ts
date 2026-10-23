// ── FAQ screen ────────────────────────────────────────────────────────────────
//
// In-app frequently-asked-questions (US-44): a top-level screen reachable from
// the top bar, questions grouped by theme in native <details> accordions, a
// search box, and every answer linking to the matching video or guide section.
// Content lives in faq-content.ts; the external links in shared/help-resources.
//
// The screen is content-driven, so it re-renders on locale change (like the
// explorer) rather than relying on the static data-i18n pass. The search filter
// is pure and unit-tested.

import { $ } from "../shared/dom.js";
import { registerScreen, showScreen } from "../shared/screen.js";
import { t, onLocaleChange } from "../i18n/i18n.js";
import { faqTopics, type FaqEntry, type FaqTopic } from "./faq-content.js";
import { TOPIC_RESOURCES, type HelpLink } from "../shared/help-resources.js";

// ── Pure search (unit-tested) ─────────────────────────────────────────────────

/** Lower-cased and accent-stripped, so "médico" matches "medico". */
export function normalize(s: string): string {
  return s
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export interface FaqMatch {
  topic: FaqTopic;
  entries: FaqEntry[];
}

/**
 * The themes (and their surviving questions) that match `query`. An empty query
 * returns every theme in full. A theme whose *title* matches keeps all its
 * questions; otherwise only the questions whose text matches are kept. Pure —
 * the translator is injected — so it needs no DOM or i18n singleton under test.
 */
export function filterFaqTopics(
  topics: FaqTopic[],
  query: string,
  translate: (key: string) => string,
): FaqMatch[] {
  const q = normalize(query.trim());
  if (!q) return topics.map((topic) => ({ topic, entries: topic.entries }));

  const out: FaqMatch[] = [];
  for (const topic of topics) {
    const titleHit = normalize(translate(topic.titleKey)).includes(q);
    const entries = topic.entries.filter(
      (e) =>
        normalize(translate(e.questionKey)).includes(q) ||
        normalize(translate(e.answerKey)).includes(q),
    );
    if (titleHit) {
      out.push({ topic, entries: topic.entries });
    } else if (entries.length > 0) {
      out.push({ topic, entries });
    }
  }
  return out;
}

// ── Rendering ──────────────────────────────────────────────────────────────────

let resultsEl: HTMLElement | null = null;
let searchEl: HTMLInputElement | null = null;
let clearEl: HTMLElement | null = null;
let query = "";

function resourceLabel(kind: HelpLink["kind"]): string {
  if (kind === "video") return t("faq.resource.video");
  if (kind === "docs") return t("faq.resource.docs");
  return t("faq.resource.guide");
}

function renderEntry(topic: FaqTopic, e: FaqEntry): HTMLElement {
  const item = document.createElement("details");
  item.className = "faq__item";

  const summary = document.createElement("summary");
  summary.className = "faq__question";
  summary.textContent = t(e.questionKey);

  const answer = document.createElement("div");
  answer.className = "faq__answer";
  const p = document.createElement("p");
  p.textContent = t(e.answerKey);
  answer.append(p);

  const res = e.resource ?? TOPIC_RESOURCES[topic.id];
  if (res) {
    const link = document.createElement("a");
    link.className = "faq__resource";
    link.href = res.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = resourceLabel(res.kind);
    answer.append(link);
  }

  item.append(summary, answer);
  return item;
}

function render(): void {
  if (!resultsEl) return;
  const matches = filterFaqTopics(faqTopics, query, t);
  resultsEl.replaceChildren();

  if (matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "faq__empty";
    empty.textContent = t("faq.empty");
    resultsEl.append(empty);
    return;
  }

  for (const { topic, entries } of matches) {
    const section = document.createElement("section");
    section.className = "faq__topic";
    const heading = document.createElement("h3");
    heading.className = "faq__topic-title";
    heading.textContent = t(topic.titleKey);
    section.append(heading);
    for (const e of entries) section.append(renderEntry(topic, e));
    resultsEl.append(section);
  }
}

function setQuery(value: string): void {
  query = value;
  clearEl?.classList.toggle("hidden", value.trim() === "");
  render();
}

// ── Wiring ──────────────────────────────────────────────────────────────────

export function initFaq(): void {
  const screen = document.getElementById("faq-screen");
  if (!screen) return;
  registerScreen("faq", screen);

  resultsEl = $("faq-results");
  searchEl = $("faq-search") as HTMLInputElement;
  clearEl = document.getElementById("faq-search-clear");

  $("btn-faq").addEventListener("click", (e) =>
    showScreen("faq", e.currentTarget as HTMLElement),
  );
  $("faq-back").addEventListener("click", () => showScreen("viewer"));

  searchEl.addEventListener("input", () => setQuery(searchEl!.value));
  clearEl?.addEventListener("click", () => {
    searchEl!.value = "";
    setQuery("");
    searchEl!.focus();
  });

  onLocaleChange(() => render());
  render();
}
