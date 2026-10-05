import {
  logout,
  refreshAccessToken,
  setLoginPrompt,
  onAuthChange,
} from "./auth/auth.js";
import { updateAuthUI, initActivityHistory } from "./auth/session-ui.js";
import {
  initInviteScreen,
  initInviteDialog,
  enterInviteFlowIfPresent,
} from "./auth/accept-invite.js";
import {
  initResetScreen,
  initForgotPasswordDialog,
  enterResetFlowIfPresent,
} from "./auth/password-reset.js";
import { showScreen } from "./shared/screen.js";
import {
  initServerScreen,
  openServerScreen,
  promptLoginOnServerScreen,
} from "./server-screen/server-screen.js";
import {
  initServerConfigModal,
  openServerConfigModal,
} from "./server-screen/server-config-modal.js";
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
  initGridLayoutControls,
} from "./viewer/interaction.js";
import { initViewportManager } from "./viewer/viewport-registry.js";
import { initUploadPanel } from "./upload/upload.js";
import {
  initStudyExplorer,
  loadStudyExplorer,
  renderLoggedOutExplorer,
} from "./explorer/explorer.js";
import { initZenodoPanel, checkQuotaAlerts } from "./zenodo/zenodo-panel.js";
import { initStudyDetailPanel } from "./server-screen/study-detail-panel.js";
import { initExplorerPanel } from "./explorer/explorer-panel.js";
import { initWalkthrough } from "./walkthrough/init.js";
import { initValidation } from "./viewer/validation-ui.js";
import { initMLView } from "./viewer/ml-view.js";
import { initSegmentation } from "./viewer/segmentation/segmentation-ui.js";
import { initSegmentationCorrection } from "./viewer/segmentation/segmentation-correction-ui.js";
import { $ } from "./shared/dom.js";
import { initRovingTabindex } from "./shared/roving.js";
import { initDesktopOnlyUI, initApiOriginSetting } from "./shared/desktop.js";
import {
  currentLocale,
  setLocale,
  onLocaleChange,
  applyTranslations,
  initLocaleFromBrowser,
  type Locale,
} from "./i18n/i18n.js";

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  void initApp();
});

function initI18n(): void {
  initLocaleFromBrowser();
  document.documentElement.lang = currentLocale();
  applyTranslations(document);
  onLocaleChange(() => {
    document.documentElement.lang = currentLocale();
    applyTranslations(document);
  });

  const select = $("locale-select") as HTMLSelectElement;
  select.value = currentLocale();
  select.addEventListener("change", () => {
    setLocale(select.value as Locale);
  });
  onLocaleChange((locale) => {
    select.value = locale;
  });
}

async function initApp(): Promise<void> {
  initI18n();
  initDesktopOnlyUI();
  void initApiOriginSetting();
  initServerConfigModal();

  // One login surface in the app: the server screen's auth card. A session
  // that dies mid-operation brings the user here rather than throwing a modal
  // over the image they are reading.
  setLoginPrompt(promptLoginOnServerScreen);
  onAuthChange(() => updateAuthUI());
  $("btn-logout").addEventListener("click", () => void onLogout());
  $("btn-login").addEventListener("click", (e) =>
    openServerScreen("buscar", e.currentTarget as HTMLElement),
  );
  // The main-page Servidor button routes to the server interface (search/upload),
  // never to the config modal — re-pointing the server from the main page can put
  // the app in an inconsistent state (TK-29, spec 001). Server configuration is an
  // admin-only action reachable from the gear inside the server screen instead.
  $("btn-server").addEventListener("click", (e) =>
    openServerScreen("buscar", e.currentTarget as HTMLElement),
  );
  // Admin-only settings gear inside the server screen opens the config modal (TK-29).
  $("btn-server-settings").addEventListener("click", (e) =>
    openServerConfigModal(e.currentTarget as HTMLElement),
  );

  // Local viewing works without a session — always start the app.
  startApp();

  // An invite link takes over the landing: it strips the code from the URL,
  // shows the accept-invite screen, and skips the normal signed-out flow.
  if (await enterInviteFlowIfPresent()) return;
  // Same for a password reset link (?reset=<code>).
  if (await enterResetFlowIfPresent()) return;

  // Silent session restore from the stored refresh token; never a popup here.
  const restored = await refreshAccessToken();
  updateAuthUI();
  if (restored) {
    void loadStudyExplorer();
    void checkQuotaAlerts();
  } else {
    renderLoggedOutExplorer();
  }
}

function startApp(): void {
  // Multi-viewport grid: must be first — toolbar and loading modules read the registry.
  const vpContainer = document.getElementById("viewport-container");
  if (!vpContainer) throw new Error("#viewport-container not found in DOM");
  initViewportManager(vpContainer);

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
  const onInviteAccepted = (): void => {
    showScreen("viewer");
    updateAuthUI();
    void loadStudyExplorer();
  };
  initInviteScreen({ onAccepted: onInviteAccepted });
  initInviteDialog({ onAccepted: onInviteAccepted });
  initResetScreen({ onReset: onInviteAccepted });
  initForgotPasswordDialog({ onReset: onInviteAccepted });
  initActivityHistory();
  initZenodoPanel();
  initStudyDetailPanel();
  initExplorerPanel();
  initWalkthrough();
  initValidation();
  initMLView();
  initSegmentation();
  initSegmentationCorrection();
  // Last: the rail is one tab stop, with the arrow keys moving between tools,
  // so reaching the viewport does not mean tabbing through every tool. It
  // reads the tool buttons at init, so it runs after they are all wired.
  initGridLayoutControls();
  initRovingTabindex($("viewer-toolbar"), ".toolbar__tool", "vertical");
}

async function onLogout(): Promise<void> {
  await logout(); // onAuthChange → updateAuthUI()
  renderLoggedOutExplorer();
  // Don't leave server-fetched pixels on screen without a session.
  if (state.source === "server") resetViewerToDropZone();
}
