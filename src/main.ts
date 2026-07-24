import {
  logout,
  refreshAccessToken,
  setLoginPrompt,
  onAuthChange,
} from "./auth/auth.js";
import { updateAuthUI, initActivityHistory } from "./auth/session-ui.js";
import {
  initServerScreen,
  openServerScreen,
  promptLoginOnServerScreen,
} from "./server-screen/server-screen.js";
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
  // One login surface in the app: the server screen's auth card. A session
  // that dies mid-operation brings the user here rather than throwing a modal
  // over the image they are reading.
  setLoginPrompt(promptLoginOnServerScreen);
  onAuthChange(() => updateAuthUI());
  $("btn-logout").addEventListener("click", () => void onLogout());
  $("btn-login").addEventListener("click", (e) =>
    openServerScreen("buscar", e.currentTarget as HTMLElement),
  );
  // Single entry point for everything server-bound.
  $("btn-server").addEventListener("click", (e) =>
    openServerScreen("buscar", e.currentTarget as HTMLElement),
  );

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
  initServerScreen();
  initActivityHistory();
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
