/* cspell:disable */
// ── Server screen ────────────────────────────────────────────────────────────
//
// Searching and uploading leave the viewer for their own screen (design
// screens 02-04) rather than being gated inline. That is the whole point of
// the redesign: local viewing is free and uninterrupted, and everything that
// touches the server is one deliberate, clearly-labelled step away.
//
// A guest who opens this screen lands on the auth card, which states the rule
// in plain language, instead of getting a modal thrown over their image.

import { isAuthenticated, isAdmin, isStaff, onAuthChange } from "../auth/auth.js";
import { mountLoginForm } from "../auth/login-form.js";
import { mountUsersPanel } from "../admin/users-panel.js";
import { mountSystemPanel } from "../admin/system-panel.js";
import {
  loadStudyExplorer,
  getSelectedStudyId,
  onSelectionChange,
  onSelectionActivate,
  openStudy,
  clearSelection,
} from "../explorer/explorer.js";
import {
  cancelUpload,
  isUploading,
  onUploadComplete,
} from "../upload/upload.js";
import { $ } from "../shared/dom.js";
import { showBanner } from "../shared/banner.js";
import { registerScreen, showScreen, currentScreen } from "../shared/screen.js";
import { initRovingTabindex, nextRovingIndex } from "../shared/roving.js";
import { t } from "../i18n/i18n.js";

export type ServerTab = "buscar" | "cargar" | "usuarios" | "sistema";

let activeTab: ServerTab = "buscar";
let loginForm: ReturnType<typeof mountLoginForm> | null = null;
let usersPanel: ReturnType<typeof mountUsersPanel> | null = null;
let systemPanel: ReturnType<typeof mountSystemPanel> | null = null;
/** Resolves the pending ensureAuthenticated() gate, if one sent us here. */
let pendingGate: ((ok: boolean) => void) | null = null;

const TABS: ServerTab[] = ["buscar", "cargar", "usuarios", "sistema"];

/** Can the current session use a tab? "usuarios" and "sistema" are admin-only;
 *  "cargar" (upload) is a write, so clinical staff only. */
function canUseTab(tab: ServerTab): boolean {
  if (tab === "usuarios" || tab === "sistema") return isAdmin();
  if (tab === "cargar") return isStaff();
  return true;
}

/** Tabs visible for the current session (drops the ones the role can't use). */
function visibleTabs(): ServerTab[] {
  return TABS.filter(canUseTab);
}

function tabButton(tab: ServerTab): HTMLElement {
  return $(`tab-${tab}`);
}

function tabPanel(tab: ServerTab): HTMLElement {
  return $(`panel-${tab}`);
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function showTab(tab: ServerTab): void {
  activeTab = tab;
  TABS.forEach((name) => {
    const selected = name === tab;
    const btn = tabButton(name);
    btn.setAttribute("aria-selected", String(selected));
    btn.classList.toggle("server-tab--active", selected);
    btn.tabIndex = selected ? 0 : -1;
    tabPanel(name).classList.toggle("hidden", !selected);
  });

  if (tab === "buscar") void loadStudyExplorer();
  if (tab === "usuarios") void usersPanel?.reload();
  if (tab === "sistema") void systemPanel?.reload();
}

/**
 * Repaints the screen for the current session state: a guest sees only the
 * auth card, a signed-in user sees the tabs. Called on entry and again after
 * a successful login, so one code path covers both.
 */
function renderForSession(): void {
  const authed = isAuthenticated();
  $("server-auth").classList.toggle("hidden", authed);
  $("server-tabs").classList.toggle("hidden", !authed);

  if (!authed) {
    TABS.forEach((name) => tabPanel(name).classList.add("hidden"));
    loginForm?.reset();
    return;
  }

  // Reveal each role-gated tab only where the role permits it; if the active
  // tab is now off-limits (e.g. a role change surfaced on refresh), fall back
  // to Buscar, which every signed-in role can use.
  TABS.forEach((tab) => tabButton(tab).classList.toggle("hidden", !canUseTab(tab)));
  if (!canUseTab(activeTab)) activeTab = "buscar";
  showTab(activeTab);
}

// ── Entering and leaving ─────────────────────────────────────────────────────

/**
 * Opens the server screen on `tab`. Deliberately does NOT call
 * ensureAuthenticated() — a guest is meant to land on the auth card here, not
 * be met by the escalation modal.
 */
export function openServerScreen(
  tab: ServerTab = "buscar",
  opener?: HTMLElement | null,
): void {
  activeTab = tab;
  // Passing `undefined` leaves the stored focus-restore target alone, which
  // matters when the auth gate reopens this screen with no opener of its own.
  showScreen("server", opener);
  renderForSession();

  // Focus the first thing that actually matters on arrival.
  if (!isAuthenticated()) loginForm?.focusFirstField();
}

export function closeServerScreen(): void {
  // A gate that sent us here and is still waiting gets its answer: the user
  // backed out, so the caller sees a plain "not authenticated".
  settleGate(isAuthenticated());
  clearSelection();
  showScreen("viewer");
}

function settleGate(ok: boolean): void {
  const gate = pendingGate;
  pendingGate = null;
  gate?.(ok);
}

/**
 * The `LoginPrompt` handed to auth.ts. When a token dies mid-operation this
 * brings the user to the server screen's login card rather than a modal, so
 * the app has exactly one login surface. The contract is unchanged: resolves
 * true once a session exists, false if the user backs out.
 */
export function promptLoginOnServerScreen(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    pendingGate = resolve;
    openServerScreen(activeTab);
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initServerScreen(): void {
  registerScreen("viewer", $("viewer-screen"));
  registerScreen("server", $("server-screen"));

  loginForm = mountLoginForm($("server-login-form") as HTMLFormElement, {
    onSuccess: () => {
      settleGate(true);
      renderForSession();
    },
  });
  usersPanel = mountUsersPanel($("panel-usuarios"));
  systemPanel = mountSystemPanel($("system-panel-body"));

  // A role change (e.g. surfaced on the next token refresh) must re-evaluate the
  // admin tab's visibility while the screen is already open.
  onAuthChange(() => {
    if (isAuthenticated()) renderForSession();
  });

  $("btn-server-back").addEventListener("click", () => closeServerScreen());

  // One tab stop for the tablist, arrow keys within it (WCAG tabs pattern). The
  // :not(.hidden) selector keeps the admin-only tab out of the roving cycle for
  // non-admins (it queries live, so it follows the tab's visibility).
  const tabs = $("server-tabs");
  initRovingTabindex(tabs, '[role="tab"]:not(.hidden)', "horizontal");
  tabs.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (!btn) return;
    const tab = btn.id.replace(/^tab-/, "") as ServerTab;
    if (visibleTabs().includes(tab)) showTab(tab);
  });
  // Arrow keys move focus (roving); they should select the focused tab too,
  // which is the "automatic activation" half of the tabs pattern.
  tabs.addEventListener("keydown", (e: KeyboardEvent) => {
    const nav = visibleTabs();
    const current = nav.indexOf(activeTab);
    if (nextRovingIndex(e.key, current, nav.length, "horizontal") === null)
      return;
    // The roving handler has already moved focus by the time this runs.
    queueMicrotask(() => {
      const focused = document.activeElement;
      const tab = nav.find((name) => tabButton(name) === focused);
      if (tab && tab !== activeTab) showTab(tab);
    });
  });

  // Buscar: select-then-confirm, per the comp.
  const openSelected = $("btn-open-selected") as HTMLButtonElement;
  onSelectionChange((id) => {
    openSelected.disabled = id === null;
  });

  const openSelectedStudy = async (studyId: string): Promise<void> => {
    openSelected.disabled = true;
    await openStudy(studyId);
    closeServerScreen();
    showBanner(t("server.studyLoadedBanner"));
  };

  openSelected.addEventListener("click", () => {
    const studyId = getSelectedStudyId();
    if (studyId) void openSelectedStudy(studyId);
  });
  // Enter on an option is a shortcut for the primary button, not a separate
  // code path — otherwise it would open the study but leave you on this screen.
  onSelectionActivate((studyId) => void openSelectedStudy(studyId));
  $("btn-buscar-cancel").addEventListener("click", () => closeServerScreen());

  // Cargar footer. Cancelar stops anything in flight before leaving, so a
  // half-finished queue can't keep running against a screen you have left.
  $("btn-upload-cancel").addEventListener("click", () => {
    cancelUpload();
    closeServerScreen();
  });
  $("btn-upload-finish").addEventListener("click", () => closeServerScreen());

  // Screen 05: a clean upload opens the study and returns on its own — no
  // manual navigation back. Anything that went wrong keeps the user here with
  // the per-file rows and the error still on screen.
  onUploadComplete(async (summary) => {
    // Duplicates count as "stay put" too: they are not failures, but returning
    // automatically would hide the fact that some files were skipped.
    const clean =
      !summary.cancelled &&
      summary.errors === 0 &&
      summary.duplicates === 0 &&
      summary.ok > 0;
    if (!clean) return;
    if (summary.studyId) await openStudy(summary.studyId);
    closeServerScreen();
    showBanner(
      summary.ok === 1
        ? t("server.studyLoadedBanner")
        : t("server.studiesLoadedBanner", { count: summary.ok }),
    );
  });

  // Escape leaves the screen, matching the back link.
  $("server-screen").addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Escape" || currentScreen() !== "server") return;
    // Leaving mid-upload would orphan the queue; make the user decide.
    if (isUploading()) return;
    e.preventDefault();
    closeServerScreen();
  });
}
