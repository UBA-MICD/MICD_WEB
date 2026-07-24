import {
  logout,
  refreshAccessToken,
  setLoginPrompt,
  onAuthChange,
} from "./auth/auth.js";
import {
  promptLogin,
  initLoginDialog,
  updateAuthUI,
} from "./auth/login-dialog.js";
import { state } from "./viewer/state.js";
import {
  initFileInputs,
  initDropZone,
  resetViewerToDropZone,
} from "./viewer/loading.js";
import {
  initToolbar,
  initViewportInteraction,
  initSeriesNav,
  initMenuListeners,
  initKeyboardShortcuts,
  initResizeObserver,
} from "./viewer/interaction.js";
import { initUploadPanel } from "./upload/upload.js";
import {
  initStudyExplorer,
  loadStudyExplorer,
  renderLoggedOutExplorer,
} from "./explorer/explorer.js";
import { $ } from "./shared/dom.js";
import { initRovingTabindex } from "./shared/roving.js";

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  void initApp();
});

async function initApp(): Promise<void> {
  setLoginPrompt(promptLogin);
  initLoginDialog();
  onAuthChange(() => updateAuthUI());
  $("btn-logout").addEventListener("click", () => void onLogout());
  $("btn-login").addEventListener("click", () => void loadStudyExplorer());
  // Single entry point for everything server-bound.
  $("btn-server").addEventListener("click", () => void loadStudyExplorer());

  // Local viewing works without a session — always start the app.
  startApp();

  // Silent session restore from the stored refresh token; never a popup here.
  const restored = await refreshAccessToken();
  updateAuthUI();
  if (restored) {
    void loadStudyExplorer();
  } else {
    renderLoggedOutExplorer();
  }
}

function startApp(): void {
  initFileInputs();
  initToolbar();
  initViewportInteraction();
  initDropZone();
  initMenuListeners();
  initKeyboardShortcuts();
  initSeriesNav();
  initResizeObserver();
  initUploadPanel();
  initStudyExplorer();
  // The rail is one tab stop, with the arrow keys moving between tools, so
  // reaching the viewport does not mean tabbing through every tool.
  initRovingTabindex($("viewer-toolbar"), ".toolbar__tool", "vertical");
}

async function onLogout(): Promise<void> {
  await logout(); // onAuthChange → updateAuthUI()
  renderLoggedOutExplorer();
  // Don't leave server-fetched pixels on screen without a session.
  if (state.source === "server") resetViewerToDropZone();
}
