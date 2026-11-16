// ── Help resources ────────────────────────────────────────────────────────────
//
// The single source of truth for the external help links surfaced across the
// app: the walkthrough's welcome/closing steps as a "help hub" (TK-45) and the
// FAQ answers (US-44). Kept DOM-free and dependency-free so both features — and
// the desktop vendored copy — share one place to update when the real URLs land.
//
// TODO(TK-45): replace the "#" placeholders with the real published URLs
// (user guide, video playlist, documentation) once they exist. The rest of the
// app references these constants, so no other file needs to change.

/** A pointer to an external help resource. */
export interface HelpLink {
  href: string;
  kind: "video" | "guide" | "docs";
}

/** Top-level entry points shown as the walkthrough's "help hub" links. */
export const HELP_RESOURCES = {
  userGuide: "#", // guía de usuario
  videos: "#", // playlist de videos explicativos
  documentation: "#", // documentación del proyecto
} as const;

/**
 * Per-topic resource each FAQ answer links to, keyed by FAQ topic id (see
 * faq-content.ts). An entry may override this with its own `resource`. Until
 * the real deep links exist these point at the top-level resources, so the UI
 * is wired end-to-end and only the placeholders above need updating.
 */
export const TOPIC_RESOURCES: Record<string, HelpLink> = {
  viewer: { href: HELP_RESOURCES.videos, kind: "video" },
  server: { href: HELP_RESOURCES.userGuide, kind: "guide" },
  upload: { href: HELP_RESOURCES.videos, kind: "video" },
  zenodo: { href: HELP_RESOURCES.userGuide, kind: "guide" },
  account: { href: HELP_RESOURCES.userGuide, kind: "guide" },
  admin: { href: HELP_RESOURCES.documentation, kind: "docs" },
};
