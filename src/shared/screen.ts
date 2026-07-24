// ── Top-level screens ────────────────────────────────────────────────────────
//
// The app has two full-window screens: the viewer and the server screen
// (Buscar/Cargar). Only one is visible at a time — server actions leave the
// viewer rather than covering it.
//
// The hidden screen is left in the DOM, not torn down, so viewport state
// (loaded pixels, window/level, zoom) survives a round trip to the server and
// back. It is marked `inert` as well as hidden, so nothing in it stays
// reachable by Tab or a screen reader.

export type ScreenName = "viewer" | "server";

const screens = new Map<ScreenName, HTMLElement>();
let active: ScreenName = "viewer";
let opener: HTMLElement | null = null;

export function registerScreen(name: ScreenName, el: HTMLElement): void {
  screens.set(name, el);
}

export function currentScreen(): ScreenName {
  return active;
}

/**
 * Switches screens and moves focus to the new screen's heading, so a keyboard
 * or screen-reader user is told where they landed instead of being left on a
 * control that is now hidden.
 *
 * `from` is remembered as the element to restore focus to when this screen is
 * left again — pass the button that triggered the switch.
 */
export function showScreen(name: ScreenName, from?: HTMLElement | null): void {
  const target = screens.get(name);
  if (!target) return;

  if (from !== undefined) opener = from;
  const returningTo = active !== name ? opener : null;

  screens.forEach((el, key) => {
    const isActive = key === name;
    el.classList.toggle("hidden", !isActive);
    el.inert = !isActive;
  });

  active = name;

  // Going back restores focus to whatever opened the screen we just left;
  // going forward focuses the new screen's heading.
  if (name === "viewer" && returningTo?.isConnected) {
    returningTo.focus();
    opener = null;
    return;
  }

  const heading =
    target.querySelector<HTMLElement>("[data-screen-heading]") ?? target;
  heading.focus();
}
