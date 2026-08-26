// ── Tour content catalog ───────────────────────────────────────────────────────
//
// The declarative, role-tagged step list the engine walks (see
// docs/walkthrough-guide-plan.md, TK-27). Kept separate from walkthrough.ts so
// the engine stays content-free and unit-testable on its own.
//
// Ordering is the order the user is walked through. The common viewer core is
// shown to every role — and therefore to a guest too, since local viewing needs
// no session. The role-specific branches (investigador / medico / admin) append
// after this core in later steps.

import type { Role } from "../auth/auth.js";
import type { TourStep } from "./walkthrough.js";

/** Shown to every signed-in role, and to a guest (see `isCommonStep`). */
const ALL: Role[] = ["admin", "medico", "investigador"];

// ── A. Common core — viewer basics ─────────────────────────────────────────────

const coreSteps: TourStep[] = [
  {
    id: "core.welcome",
    roles: ALL,
    target: "center",
    titleKey: "tour.core.welcome.title",
    bodyKey: "tour.core.welcome.body",
    placement: "center",
    advance: { on: "next" },
  },
  {
    id: "core.open",
    roles: ALL,
    target: "#btn-open",
    screen: "viewer",
    titleKey: "tour.core.open.title",
    bodyKey: "tour.core.open.body",
    placement: "right",
    // Follow-along: advance when the user actually opens a file. The Next button
    // is still shown, so a user with nothing to open is never stuck.
    advance: { on: "event", event: "click" },
  },
  {
    id: "core.wl",
    roles: ALL,
    target: "#tool-wl",
    screen: "viewer",
    titleKey: "tour.core.wl.title",
    bodyKey: "tour.core.wl.body",
    placement: "right",
    advance: { on: "event", event: "click" },
  },
  {
    id: "core.zoompan",
    roles: ALL,
    target: "#tool-zoom",
    screen: "viewer",
    titleKey: "tour.core.zoompan.title",
    bodyKey: "tour.core.zoompan.body",
    placement: "right",
    advance: { on: "event", event: "click" },
  },
  {
    id: "core.mpr",
    roles: ALL,
    target: "#tool-mpr",
    screen: "viewer",
    titleKey: "tour.core.mpr.title",
    bodyKey: "tour.core.mpr.body",
    placement: "right",
    advance: { on: "next" },
  },
  {
    id: "core.metadata",
    roles: ALL,
    target: "#tool-metadata",
    screen: "viewer",
    titleKey: "tour.core.metadata.title",
    bodyKey: "tour.core.metadata.body",
    placement: "right",
    advance: { on: "next" },
  },
  {
    id: "core.reset",
    roles: ALL,
    target: "#tool-reset",
    screen: "viewer",
    titleKey: "tour.core.reset.title",
    bodyKey: "tour.core.reset.body",
    placement: "right",
    advance: { on: "next" },
  },
  {
    id: "core.explorer",
    roles: ALL,
    target: "#btn-toggle-explorer",
    screen: "viewer",
    titleKey: "tour.core.explorer.title",
    bodyKey: "tour.core.explorer.body",
    placement: "left",
    advance: { on: "next" },
  },
  {
    id: "core.language",
    roles: ALL,
    target: "#locale-select",
    titleKey: "tour.core.language.title",
    bodyKey: "tour.core.language.body",
    placement: "bottom",
    advance: { on: "next" },
  },
  {
    id: "core.signin",
    roles: ALL,
    target: "#btn-server",
    screen: "viewer",
    titleKey: "tour.core.signin.title",
    bodyKey: "tour.core.signin.body",
    placement: "right",
    // Follow-along: advancing here takes the user to the server screen.
    advance: { on: "event", event: "click" },
  },
];

export const tourSteps: TourStep[] = [...coreSteps];
