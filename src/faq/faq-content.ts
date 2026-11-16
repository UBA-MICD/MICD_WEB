// ── FAQ content catalog ─────────────────────────────────────────────────────
//
// The declarative question list the FAQ screen (US-44) renders, grouped by
// theme. Kept separate from faq.ts so the screen stays content-free and the
// catalog can be unit-tested against the locale files. Every `questionKey` /
// `answerKey` must exist in both locales (faq.test.ts enforces it, on top of
// the global i18n parity check).
//
// Ordering is the order themes and questions appear on screen. Each answer
// links to a resource: an entry's own `resource`, or — when omitted — the
// theme's default from TOPIC_RESOURCES (help-resources.ts).

import type { HelpLink } from "../shared/help-resources.js";

export interface FaqEntry {
  id: string;
  questionKey: string;
  answerKey: string;
  /** Overrides the topic's default resource for this answer. */
  resource?: HelpLink;
}

export interface FaqTopic {
  /** Also the key into TOPIC_RESOURCES for the default per-answer link. */
  id: string;
  titleKey: string;
  entries: FaqEntry[];
}

function entry(id: string): FaqEntry {
  return {
    id,
    questionKey: `faq.q.${id}.question`,
    answerKey: `faq.q.${id}.answer`,
  };
}

export const faqTopics: FaqTopic[] = [
  {
    id: "viewer",
    titleKey: "faq.topic.viewer.title",
    entries: [
      entry("viewer-open"),
      entry("viewer-wl"),
      entry("viewer-zoompan"),
      entry("viewer-mpr"),
      entry("viewer-metadata"),
      entry("viewer-measure"),
      entry("viewer-marking"),
    ],
  },
  {
    id: "server",
    titleKey: "faq.topic.server.title",
    entries: [
      entry("server-search"),
      entry("server-open"),
      entry("server-export"),
    ],
  },
  {
    id: "upload",
    titleKey: "faq.topic.upload.title",
    entries: [entry("upload-how"), entry("upload-formats")],
  },
  {
    id: "zenodo",
    titleKey: "faq.topic.zenodo.title",
    entries: [entry("zenodo-search"), entry("zenodo-publish")],
  },
  {
    id: "account",
    titleKey: "faq.topic.account.title",
    entries: [
      entry("account-signin"),
      entry("account-language"),
      entry("account-session"),
    ],
  },
  {
    id: "admin",
    titleKey: "faq.topic.admin.title",
    entries: [entry("admin-users"), entry("admin-activity")],
  },
];
