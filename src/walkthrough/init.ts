// ── Walkthrough wiring ──────────────────────────────────────────────────────────
//
// The app-facing glue between the (content-free, DOM-only) engine and MICD's
// screens, roles and Help button. Kept out of walkthrough.ts so the engine's
// unit tests never pull the server-screen / auth module graph.

import { getCurrentRole, onAuthChange, type Role } from "../auth/auth.js";
import { showScreen } from "../shared/screen.js";
import {
  openServerScreen,
  type ServerTab,
} from "../server-screen/server-screen.js";
import { startTour, isTourActive, type TourStep } from "./walkthrough.js";
import { tourSteps } from "./tour-steps.js";
import { hasSeenTour } from "./tour-state.js";

/**
 * Bring the screen/tab a step needs into view before it is spotlighted. Uses the
 * existing exported navigators so the tour never reaches into internal state;
 * both are idempotent, so re-navigating to the current screen is a no-op.
 */
function navigateForStep(step: TourStep): void {
  if (step.screen === "server") {
    openServerScreen((step.tab as ServerTab) ?? "buscar");
  } else if (step.screen) {
    showScreen(step.screen);
  }
}

/**
 * Launch (or relaunch) the tour for the current role — a guest gets the common
 * core. `startTour` stops any run already in progress, so this is safe to call
 * repeatedly from the Help button.
 */
export function launchTour(opener?: HTMLElement | null): void {
  startTour(tourSteps, {
    role: getCurrentRole(),
    opener,
    navigate: navigateForStep,
  });
}

/**
 * Auto-start the tour the first time a given role reaches an authenticated
 * session on this browser — the "activate on first login" half of TK-27. It's
 * a no-op for a guest (nothing to key a per-role flag on), for a role that has
 * already completed or skipped it (the seen-flag, which the engine writes on
 * finish), and while a run is already on screen (a token refresh re-fires
 * onAuthChange mid-tour). The manual Help button stays available regardless.
 */
export function maybeAutoStartTour(role: Role | null): void {
  if (!role) return;
  if (hasSeenTour(role)) return;
  if (isTourActive()) return;
  launchTour(null);
}

/**
 * Wire the persistent Help (?) button so anyone can relaunch the tour, and
 * subscribe to auth changes so a role's first login auto-starts it.
 */
export function initWalkthrough(): void {
  const help = document.getElementById("btn-help");
  help?.addEventListener("click", (e) => {
    launchTour(e.currentTarget as HTMLElement);
  });
  onAuthChange((user) => maybeAutoStartTour(user?.role ?? null));
}
