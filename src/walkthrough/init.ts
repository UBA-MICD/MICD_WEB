// ── Walkthrough wiring ──────────────────────────────────────────────────────────
//
// The app-facing glue between the (content-free, DOM-only) engine and MICD's
// screens, roles and Help button. Kept out of walkthrough.ts so the engine's
// unit tests never pull the server-screen / auth module graph.

import { getCurrentRole } from "../auth/auth.js";
import { showScreen } from "../shared/screen.js";
import {
  openServerScreen,
  type ServerTab,
} from "../server-screen/server-screen.js";
import { startTour, type TourStep } from "./walkthrough.js";
import { tourSteps } from "./tour-steps.js";

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

/** Wire the persistent Help (?) button so anyone can relaunch the tour. */
export function initWalkthrough(): void {
  const help = document.getElementById("btn-help");
  help?.addEventListener("click", (e) => {
    launchTour(e.currentTarget as HTMLElement);
  });
}
