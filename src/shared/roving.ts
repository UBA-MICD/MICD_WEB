// ── Roving tabindex ──────────────────────────────────────────────────────────
//
// A group of related controls (the tool rail, the Search/Upload tablist) should
// be ONE tab stop, with the arrow keys moving between the items inside it —
// the WCAG toolbar/tabs authoring pattern. Tabbing through fifteen separate
// controls to reach the viewport is what we are avoiding.
//
// The index maths lives in `nextRovingIndex` on its own, with no DOM, so it can
// be unit-tested in a repo that has no DOM test harness.

export type RovingOrientation = "horizontal" | "vertical";

const PREV_KEYS: Record<RovingOrientation, string> = {
  horizontal: "ArrowLeft",
  vertical: "ArrowUp",
};
const NEXT_KEYS: Record<RovingOrientation, string> = {
  horizontal: "ArrowRight",
  vertical: "ArrowDown",
};

/**
 * The index a navigation key should move focus to, or `null` when the key is
 * not one this group handles (so the caller leaves the event alone).
 *
 * Movement wraps at both ends, which is what the tabs and toolbar patterns
 * specify for a group of this size.
 */
export function nextRovingIndex(
  key: string,
  current: number,
  count: number,
  orientation: RovingOrientation = "horizontal",
): number | null {
  if (count <= 0) return null;

  // Clamp rather than trust the caller: a stale index would otherwise produce
  // a negative modulo result below.
  const from = Math.min(Math.max(current, 0), count - 1);

  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === PREV_KEYS[orientation]) return (from - 1 + count) % count;
  if (key === NEXT_KEYS[orientation]) return (from + 1) % count;
  return null;
}

/**
 * Wires a container so its `itemSelector` children form a single tab stop.
 * Returns a `focus(index)` callback for callers that need to move the roving
 * point themselves (e.g. selecting a tab programmatically).
 */
export function initRovingTabindex(
  container: HTMLElement,
  itemSelector: string,
  orientation: RovingOrientation = "horizontal",
): (index: number) => void {
  const items = (): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>(itemSelector));

  const setRovingPoint = (index: number): void => {
    const all = items();
    all.forEach((el, i) => {
      el.tabIndex = i === index ? 0 : -1;
    });
    all[index]?.focus();
  };

  // Only the active item starts reachable by Tab.
  items().forEach((el, i) => {
    el.tabIndex = i === 0 ? 0 : -1;
  });

  container.addEventListener("keydown", (e: KeyboardEvent) => {
    const all = items();
    const current = all.indexOf(e.target as HTMLElement);
    if (current === -1) return;

    const next = nextRovingIndex(e.key, current, all.length, orientation);
    if (next === null) return;

    e.preventDefault();
    setRovingPoint(next);
  });

  // Clicking an item makes it the roving point, so a later Tab-out/Tab-in
  // returns to where the user actually was.
  container.addEventListener("focusin", (e) => {
    const index = items().indexOf(e.target as HTMLElement);
    if (index === -1) return;
    items().forEach((el, i) => {
      el.tabIndex = i === index ? 0 : -1;
    });
  });

  return setRovingPoint;
}
