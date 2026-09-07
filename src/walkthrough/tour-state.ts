// ── Walkthrough "seen" flags ──────────────────────────────────────────────────
//
// One localStorage flag per role (micd.tour.seen.<role>) decides whether the
// guided tour auto-starts on that role's first login. Kept DOM-free and guarded
// exactly like i18n.ts / token-store.ts: this module is imported by the engine,
// which is unit-tested under Node's bare test runner with no `localStorage`
// global, and it is vendored into the Electron renderer.

import type { Role } from "../auth/auth.js";

const PREFIX = "micd.tour.seen.";

function key(role: Role): string {
  return `${PREFIX}${role}`;
}

/** Has the given role already completed or skipped the tour? */
export function hasSeenTour(role: Role): boolean {
  try {
    return (
      typeof localStorage !== "undefined" && localStorage.getItem(key(role)) === "1"
    );
  } catch {
    return false;
  }
}

/** Records that the role has seen the tour, so it won't auto-start again. */
export function markTourSeen(role: Role): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key(role), "1");
  } catch {
    // best-effort only — a flag that resets on reload just re-shows the tour
  }
}

/** Clears the seen-flag for one role, or every role when none is given. */
export function clearTourSeen(role?: Role): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (role) {
      localStorage.removeItem(key(role));
      return;
    }
    // Drop every micd.tour.seen.* key without hard-coding the role list.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // best-effort only
  }
}
