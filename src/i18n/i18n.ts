import { es } from "./locales/es.js";
import { en } from "./locales/en.js";

// ── i18n ─────────────────────────────────────────────────────────────────────
//
// A flat key -> string lookup with {{param}} interpolation, no framework. `es`
// is the app's original language and stays the default, so existing behaviour
// (and every test that asserts on Spanish copy) is unaffected by this module
// existing. All browser-global access is guarded: this file is unit-tested
// under Node's bare test runner (no DOM, no localStorage/navigator) and will
// later be vendored into an Electron renderer.

export type Locale = "es" | "en";

const SUPPORTED_LOCALES: readonly Locale[] = ["es", "en"];
const STORAGE_KEY = "micd_lang";

const TABLES: Record<Locale, Record<string, string>> = { es, en };

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as string[]).includes(value);
}

function readStoredLocale(): Locale | null {
  try {
    const raw =
      typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

let locale: Locale = readStoredLocale() ?? "es";

type LocaleListener = (locale: Locale) => void;
const listeners: LocaleListener[] = [];

/** The active locale. */
export function currentLocale(): Locale {
  return locale;
}

/** Switches the active locale, persists the choice, and notifies subscribers. */
export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // best-effort persistence only — a locale that resets on reload is fine
  }
  listeners.forEach((cb) => cb(locale));
}

/** Registers a listener fired on every setLocale(). Returns an unsubscribe fn. */
export function onLocaleChange(cb: LocaleListener): () => void {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i !== -1) listeners.splice(i, 1);
  };
}

/**
 * One-time, browser-only auto-detect: if the visitor has never chosen a
 * locale (no `micd_lang` in storage), match `navigator.language` against a
 * supported locale and adopt it. A no-op once a preference has been stored.
 * Deliberately NOT run at module load — Node's test runner also has a
 * `navigator` global, and a CI container's locale must never affect which
 * language `es`-asserting unit tests see. Call this once from the app's
 * browser-only bootstrap (`main.ts`).
 */
export function initLocaleFromBrowser(): void {
  if (readStoredLocale() !== null) return;
  try {
    const lang = typeof navigator !== "undefined" ? navigator.language?.slice(0, 2) : null;
    if (isLocale(lang)) setLocale(lang);
  } catch {
    // best-effort only — stay on the "es" default
  }
}

/**
 * Looks up `key` in the active locale, interpolating `{{name}}` placeholders
 * from `params`. Falls back to the key itself when missing — this must never
 * throw, since a stale/missing key should degrade visibly, not crash the app.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const value = TABLES[locale][key] ?? key;
  if (!params) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * Applies translations to every `[data-i18n]` (textContent), `[data-i18n-html]`
 * (innerHTML — only for the handful of static app-authored strings that carry
 * trusted markup, e.g. <kbd> shortcut hints; never for DICOM/user-supplied
 * data) and `[data-i18n-attr]` element under `root`. The last one's value is
 * `"attrName:key; attrName2:key2"` — one or more `attr:key` pairs.
 */
export function applyTranslations(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (key) el.textContent = t(key);
  });

  root.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    const key = el.dataset.i18nHtml;
    if (key) el.innerHTML = t(key);
  });

  root.querySelectorAll<HTMLElement>("[data-i18n-attr]").forEach((el) => {
    const spec = el.dataset.i18nAttr;
    if (!spec) return;
    spec.split(";").forEach((pair) => {
      const [attr, key] = pair.split(":").map((part) => part.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
}
