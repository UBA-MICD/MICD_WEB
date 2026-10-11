// ── Tour content catalog ───────────────────────────────────────────────────────
//
// The declarative, role-tagged step list the engine walks (see
// docs/walkthrough-guide-plan.md, TK-27). Kept separate from walkthrough.ts so
// the engine stays content-free and unit-testable on its own.
//
// Ordering is the order the user is walked through. The common viewer core is
// shown to every role — and therefore to a guest too, since local viewing needs
// no session. The role-specific branches (investigador / informatico / medico /
// admin) append
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

// ── B. investigador — read-only, PHI-free researcher ────────────────────────────
//
// Everything in the core, then the server's Buscar tab framed for a researcher:
// results are anonymized and exports are PHI-free. Upload, user admin and Zenodo
// publishing/config are not part of the role, so they are simply never listed.

const investigadorSteps: TourStep[] = [
  {
    id: "inv.search",
    roles: ["investigador"],
    target: "#server-search-studies",
    screen: "server",
    tab: "buscar",
    titleKey: "tour.investigador.search.title",
    bodyKey: "tour.investigador.search.body",
    placement: "bottom",
    advance: { on: "event", event: "input" },
  },
  {
    id: "inv.dates",
    roles: ["investigador"],
    target: "#server-date-from",
    screen: "server",
    tab: "buscar",
    titleKey: "tour.investigador.dates.title",
    bodyKey: "tour.investigador.dates.body",
    placement: "bottom",
    advance: { on: "next" },
  },
  {
    id: "inv.results",
    roles: ["investigador"],
    target: "#study-list",
    screen: "server",
    tab: "buscar",
    titleKey: "tour.investigador.results.title",
    bodyKey: "tour.investigador.results.body",
    placement: "top",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "inv.open",
    roles: ["investigador"],
    target: "#btn-open-selected",
    screen: "server",
    tab: "buscar",
    titleKey: "tour.investigador.open.title",
    bodyKey: "tour.investigador.open.body",
    placement: "top",
    optional: true,
    advance: { on: "event", event: "click" },
  },
  {
    id: "inv.export",
    roles: ["investigador"],
    target: "#btn-export-explorer",
    screen: "server",
    tab: "buscar",
    titleKey: "tour.investigador.export.title",
    bodyKey: "tour.investigador.export.body",
    placement: "bottom",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "inv.zenodo",
    roles: ["investigador"],
    target: "#btn-open-zenodo",
    screen: "viewer",
    titleKey: "tour.investigador.zenodo.title",
    bodyKey: "tour.investigador.zenodo.body",
    placement: "bottom",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "inv.done",
    roles: ["investigador"],
    target: "center",
    titleKey: "tour.investigador.done.title",
    bodyKey: "tour.investigador.done.body",
    placement: "center",
    advance: { on: "next" },
  },
];

// ── B2. informatico — clinic IT: upload and download only ──────────────────────
//
// No viewer core: the role can't use the viewer, so its whole tour is
// uploading, then downloading.

const informaticoSteps: TourStep[] = [
  {
    id: "inf.upload",
    roles: ["informatico"],
    target: "#upload-drop",
    screen: "server",
    tab: "cargar",
    titleKey: "tour.informatico.upload.title",
    bodyKey: "tour.informatico.upload.body",
    placement: "bottom",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "inf.download",
    roles: ["informatico"],
    target: "#btn-open-selected",
    screen: "server",
    tab: "buscar",
    titleKey: "tour.informatico.download.title",
    bodyKey: "tour.informatico.download.body",
    placement: "top",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "inf.done",
    roles: ["informatico"],
    target: "center",
    titleKey: "tour.informatico.done.title",
    bodyKey: "tour.informatico.done.body",
    placement: "center",
    advance: { on: "next" },
  },
];

// ── C. Staff — medico & admin (write access, full PHI) ──────────────────────────
//
// Clinical staff see the same search/view/export as a researcher but with full
// patient details (no anonymization), and additionally can upload studies and
// import public datasets. `admin` is a superset of `medico`, so these steps are
// tagged for both; the closing note is medico-only (admin has its own).

const staffSteps: TourStep[] = [
  {
    id: "staff.search",
    roles: ["medico", "admin"],
    target: "#server-search-studies",
    screen: "server",
    tab: "buscar",
    titleKey: "tour.staff.search.title",
    bodyKey: "tour.staff.search.body",
    placement: "bottom",
    advance: { on: "event", event: "input" },
  },
  {
    id: "staff.results",
    roles: ["medico", "admin"],
    target: "#study-list",
    screen: "server",
    tab: "buscar",
    titleKey: "tour.staff.results.title",
    bodyKey: "tour.staff.results.body",
    placement: "top",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "staff.open",
    roles: ["medico", "admin"],
    target: "#btn-open-selected",
    screen: "server",
    tab: "buscar",
    titleKey: "tour.staff.open.title",
    bodyKey: "tour.staff.open.body",
    placement: "top",
    optional: true,
    advance: { on: "event", event: "click" },
  },
  {
    id: "staff.export",
    roles: ["medico", "admin"],
    target: "#btn-export-explorer",
    screen: "server",
    tab: "buscar",
    titleKey: "tour.staff.export.title",
    bodyKey: "tour.staff.export.body",
    placement: "bottom",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "staff.uploadTab",
    roles: ["medico", "admin"],
    target: "#tab-cargar",
    screen: "server",
    tab: "buscar",
    titleKey: "tour.staff.uploadTab.title",
    bodyKey: "tour.staff.uploadTab.body",
    placement: "bottom",
    // Follow-along: switch to the upload tab. If the user clicks Next instead,
    // the next step's tab:"cargar" opens it anyway.
    advance: { on: "event", event: "click" },
  },
  {
    id: "staff.uploadDrop",
    roles: ["medico", "admin"],
    target: "#upload-drop",
    screen: "server",
    tab: "cargar",
    titleKey: "tour.staff.uploadDrop.title",
    bodyKey: "tour.staff.uploadDrop.body",
    placement: "top",
    advance: { on: "next" },
  },
  {
    id: "staff.uploadFolder",
    roles: ["medico", "admin"],
    target: "#btn-upload-folder",
    screen: "server",
    tab: "cargar",
    titleKey: "tour.staff.uploadFolder.title",
    bodyKey: "tour.staff.uploadFolder.body",
    placement: "bottom",
    advance: { on: "next" },
    // Desktop only — the button is hidden in the browser build.
    optional: true,
  },
  {
    id: "staff.uploadStatus",
    roles: ["medico", "admin"],
    target: "#upload-progress",
    screen: "server",
    tab: "cargar",
    titleKey: "tour.staff.uploadStatus.title",
    bodyKey: "tour.staff.uploadStatus.body",
    placement: "top",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "staff.zenodoImport",
    roles: ["medico", "admin"],
    target: "#btn-open-zenodo",
    screen: "viewer",
    titleKey: "tour.staff.zenodoImport.title",
    bodyKey: "tour.staff.zenodoImport.body",
    placement: "bottom",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "medico.done",
    roles: ["medico"],
    target: "center",
    titleKey: "tour.medico.done.title",
    bodyKey: "tour.medico.done.body",
    placement: "center",
    advance: { on: "next" },
  },
];

// ── D. admin — full lifecycle ───────────────────────────────────────────────────
//
// Core + all of staff's, plus the admin-only surfaces: the user-management panel
// (Usuarios tab), the activity/audit log and Zenodo config/publish/logs. The
// per-user-row targets are rendered from live data, so they are optional and
// skip cleanly when the list is empty.

const adminSteps: TourStep[] = [
  {
    id: "admin.usersTab",
    roles: ["admin"],
    target: "#tab-usuarios",
    screen: "server",
    tab: "buscar",
    titleKey: "tour.admin.usersTab.title",
    bodyKey: "tour.admin.usersTab.body",
    placement: "bottom",
    advance: { on: "event", event: "click" },
  },
  {
    id: "admin.create",
    roles: ["admin"],
    target: "[data-user-create]",
    screen: "server",
    tab: "usuarios",
    titleKey: "tour.admin.create.title",
    bodyKey: "tour.admin.create.body",
    placement: "bottom",
    advance: { on: "next" },
  },
  {
    id: "admin.role",
    roles: ["admin"],
    target: "[data-user-role]",
    screen: "server",
    tab: "usuarios",
    titleKey: "tour.admin.role.title",
    bodyKey: "tour.admin.role.body",
    placement: "left",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "admin.block",
    roles: ["admin"],
    target: "[data-user-toggle]",
    screen: "server",
    tab: "usuarios",
    titleKey: "tour.admin.block.title",
    bodyKey: "tour.admin.block.body",
    placement: "left",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "admin.delete",
    roles: ["admin"],
    target: "[data-user-delete]",
    screen: "server",
    tab: "usuarios",
    titleKey: "tour.admin.delete.title",
    bodyKey: "tour.admin.delete.body",
    placement: "left",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "admin.lastAccess",
    roles: ["admin"],
    target: "[data-user-last-access]",
    screen: "server",
    tab: "usuarios",
    titleKey: "tour.admin.lastAccess.title",
    bodyKey: "tour.admin.lastAccess.body",
    placement: "left",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "admin.activity",
    roles: ["admin"],
    target: "#btn-activity",
    screen: "viewer",
    titleKey: "tour.admin.activity.title",
    bodyKey: "tour.admin.activity.body",
    placement: "left",
    optional: true,
    advance: { on: "next" },
  },
  {
    id: "admin.zenodo",
    roles: ["admin"],
    target: "#btn-open-zenodo",
    screen: "viewer",
    titleKey: "tour.admin.zenodo.title",
    bodyKey: "tour.admin.zenodo.body",
    placement: "right",
    advance: { on: "next" },
  },
  {
    id: "admin.help",
    roles: ["admin"],
    target: "#btn-help",
    titleKey: "tour.admin.help.title",
    bodyKey: "tour.admin.help.body",
    placement: "bottom",
    advance: { on: "next" },
  },
];

export const tourSteps: TourStep[] = [
  ...coreSteps,
  ...investigadorSteps,
  ...informaticoSteps,
  ...staffSteps,
  ...adminSteps,
];
