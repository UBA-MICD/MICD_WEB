/**
 * viewport-registry.ts — ViewportManager singleton registry (US-13).
 *
 * Decouples the manager instance from its consumers (interaction.ts,
 * loading.ts) without creating circular dependencies through main.ts.
 * Every module that needs the ViewportManager imports from here.
 */

import { ViewportManager } from "./viewport-manager.js";

// ── Registry ─────────────────────────────────────────────────────────────────

let _viewportManager: ViewportManager | null = null;

/**
 * Returns the registered ViewportManager instance.
 * Returns null until initViewportManager() has been called by main.ts.
 */
export function getViewportManager(): ViewportManager | null {
  return _viewportManager;
}

/**
 * Creates and registers a ViewportManager bound to the given DOM container.
 * Must be called exactly once from startApp() in main.ts, before any other
 * module calls getViewportManager().
 */
export function initViewportManager(container: HTMLElement): ViewportManager {
  if (_viewportManager) {
    _viewportManager.destroy();
  }
  _viewportManager = new ViewportManager(container);
  return _viewportManager;
}
