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
import { showScreen } from "./shared/screen.js";
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
import { initZenodoPanel, checkQuotaAlerts } from "./zenodo/zenodo-panel.js";
import { initStudyDetailPanel } from "./server-screen/study-detail-panel.js";
import { initExplorerPanel } from "./explorer/explorer-panel.js";
import { initValidation } from "./viewer/validation-ui.js";
import { $ } from "./shared/dom.js";
import { initRovingTabindex } from "./shared/roving.js";
import {
  initDesktopOnlyUI,
  initDesktopApiOriginSetting,
} from "./shared/desktop.js";
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
  void initDesktopApiOriginSetting();

  // One login surface in the app: the server screen's auth card. A session
  // that dies mid-operation brings the user here rather than throwing a modal
  // over the image they are reading.
  setLoginPrompt(promptLoginOnServerScreen);
  onAuthChange(() => updateAuthUI());
  $("btn-logout").addEventListener("click", () => void onLogout());
  // cspell:disable
  $("btn-login").addEventListener("click", (e) =>
    openServerScreen("buscar", e.currentTarget as HTMLElement),
  );
  // Single entry point for everything server-bound.
  $("btn-server").addEventListener("click", (e) =>
    openServerScreen("buscar", e.currentTarget as HTMLElement),
  );
  // cspell:enable

  // Local viewing works without a session — always start the app.
  startApp();

  // An invite link takes over the landing: it strips the code from the URL,
  // shows the accept-invite screen, and skips the normal signed-out flow.
  if (await enterInviteFlowIfPresent()) return;

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
  initActivityHistory();
  initZenodoPanel();
  initStudyDetailPanel();
  initExplorerPanel();
  initValidation();
  // Last: the rail is one tab stop, with the arrow keys moving between tools,
  // so reaching the viewport does not mean tabbing through every tool. It
  // reads the tool buttons at init, so it runs after they are all wired.
  initRovingTabindex($("viewer-toolbar"), ".toolbar__tool", "vertical");
}

async function onLogout(): Promise<void> {
  await logout(); // onAuthChange → updateAuthUI()
  renderLoggedOutExplorer();
  // Don't leave server-fetched pixels on screen without a session.
  if (state.source === "server") resetViewerToDropZone();
}
