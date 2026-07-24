/**
 * Tests for roving.ts — the index maths behind the single-tab-stop toolbar and
 * tablist, then the wiring that applies it to a group of controls.
 *
 * Run: npm test   (uses Node's built-in test runner + TS type stripping)
 *
 * nextRovingIndex is pure and needs nothing. initRovingTabindex touches the
 * four DOM surfaces listed on FakeGroup below, so the second half of this file
 * hand-rolls those rather than pulling jsdom into a repo whose only production
 * dependency is dicom-parser.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { nextRovingIndex, initRovingTabindex } from "./roving.ts";

test("horizontal: arrows step forward and back", () => {
  assert.equal(nextRovingIndex("ArrowRight", 0, 5), 1);
  assert.equal(nextRovingIndex("ArrowLeft", 3, 5), 2);
});

test("horizontal: movement wraps at both ends", () => {
  assert.equal(nextRovingIndex("ArrowRight", 4, 5), 0);
  assert.equal(nextRovingIndex("ArrowLeft", 0, 5), 4);
});

test("vertical: up/down drive the group, left/right are ignored", () => {
  assert.equal(nextRovingIndex("ArrowDown", 0, 3, "vertical"), 1);
  assert.equal(nextRovingIndex("ArrowUp", 0, 3, "vertical"), 2);
  assert.equal(nextRovingIndex("ArrowRight", 0, 3, "vertical"), null);
  assert.equal(nextRovingIndex("ArrowLeft", 0, 3, "vertical"), null);
});

test("horizontal ignores the vertical arrows", () => {
  assert.equal(nextRovingIndex("ArrowDown", 0, 3), null);
  assert.equal(nextRovingIndex("ArrowUp", 0, 3), null);
});

test("Home and End jump to the ends in both orientations", () => {
  assert.equal(nextRovingIndex("Home", 3, 5), 0);
  assert.equal(nextRovingIndex("End", 1, 5), 4);
  assert.equal(nextRovingIndex("Home", 3, 5, "vertical"), 0);
  assert.equal(nextRovingIndex("End", 1, 5, "vertical"), 4);
});

test("keys the group does not handle return null so the caller can pass them on", () => {
  for (const key of ["Tab", "Enter", " ", "Escape", "a", "PageDown"]) {
    assert.equal(nextRovingIndex(key, 1, 5), null, `expected null for ${key}`);
  }
});

test("an empty group never moves focus", () => {
  assert.equal(nextRovingIndex("ArrowRight", 0, 0), null);
  assert.equal(nextRovingIndex("Home", 0, 0), null);
});

test("a single item wraps onto itself", () => {
  assert.equal(nextRovingIndex("ArrowRight", 0, 1), 0);
  assert.equal(nextRovingIndex("ArrowLeft", 0, 1), 0);
});

test("an out-of-range current index is clamped, not wrapped negatively", () => {
  // A stale index must never produce a negative result: `(-3 - 1 + 5) % 5`
  // would be 1, silently focusing the wrong control.
  assert.equal(nextRovingIndex("ArrowLeft", -3, 5), 4);
  assert.equal(nextRovingIndex("ArrowRight", 99, 5), 0);
});

// ── initRovingTabindex ────────────────────────────────────────────────────────
//
// The minimum DOM the function actually uses: querySelectorAll + addEventListener
// on the container, and tabIndex + focus() on each item. Events are dispatched
// straight at the container with an explicit `target`, which is what a real
// bubbled keydown/focusin from a child looks like to a delegated listener.

// Plain field assignments rather than TS parameter properties: node --test runs
// these under type stripping, which only erases, and parameter properties emit.
class FakeItem {
  tabIndex = 0;
  readonly name: string;
  readonly log: string[];

  constructor(name: string, log: string[]) {
    this.name = name;
    this.log = log;
  }

  focus(): void {
    this.log.push(this.name);
  }
}

class FakeGroup {
  readonly items: FakeItem[];
  readonly focusLog: string[] = [];
  private readonly listeners = new Map<string, ((e: unknown) => void)[]>();

  constructor(names: string[]) {
    this.items = names.map((n) => new FakeItem(n, this.focusLog));
  }

  querySelectorAll(): FakeItem[] {
    return this.items;
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(fn);
    this.listeners.set(type, existing);
  }

  /** Returns whether the handler called preventDefault. */
  keydown(key: string, target: unknown): boolean {
    let defaultPrevented = false;
    const event = {
      key,
      target,
      preventDefault: () => {
        defaultPrevented = true;
      },
    };
    for (const fn of this.listeners.get("keydown") ?? []) fn(event);
    return defaultPrevented;
  }

  focusin(target: unknown): void {
    for (const fn of this.listeners.get("focusin") ?? []) fn({ target });
  }

  /** The group's tab stops, e.g. [0, -1, -1]. */
  get tabIndexes(): number[] {
    return this.items.map((el) => el.tabIndex);
  }
}

/** initRovingTabindex against a fake group, with the DOM types cast away. */
function wire(
  group: FakeGroup,
  orientation: "horizontal" | "vertical" = "horizontal",
): (index: number) => void {
  return initRovingTabindex(
    group as unknown as HTMLElement,
    ".item",
    orientation,
  );
}

test("only the first item starts reachable by Tab", () => {
  const group = new FakeGroup(["a", "b", "c"]);
  group.items.forEach((el) => {
    el.tabIndex = 0; // the markup's own tabindex, which init must overwrite
  });

  wire(group);

  assert.deepEqual(group.tabIndexes, [0, -1, -1]);
  assert.deepEqual(group.focusLog, [], "init must not steal focus");
});

test("an arrow key moves the tab stop and focus onto the next item", () => {
  const group = new FakeGroup(["a", "b", "c"]);
  wire(group);

  const prevented = group.keydown("ArrowRight", group.items[0]);

  assert.equal(prevented, true, "the group owns the arrows; the page must not");
  assert.deepEqual(group.tabIndexes, [-1, 0, -1]);
  assert.deepEqual(group.focusLog, ["b"]);
});

test("arrow movement wraps around the ends of the group", () => {
  const group = new FakeGroup(["a", "b", "c"]);
  wire(group);

  group.keydown("ArrowLeft", group.items[0]);
  assert.deepEqual(group.tabIndexes, [-1, -1, 0]);

  group.keydown("ArrowRight", group.items[2]);
  assert.deepEqual(group.tabIndexes, [0, -1, -1]);
  assert.deepEqual(group.focusLog, ["c", "a"]);
});

test("vertical groups are driven by the vertical arrows only", () => {
  const group = new FakeGroup(["a", "b"]);
  wire(group, "vertical");

  assert.equal(group.keydown("ArrowRight", group.items[0]), false);
  assert.deepEqual(group.tabIndexes, [0, -1], "horizontal arrow left it alone");

  assert.equal(group.keydown("ArrowDown", group.items[0]), true);
  assert.deepEqual(group.tabIndexes, [-1, 0]);
});

test("Home and End jump to the ends of the group", () => {
  const group = new FakeGroup(["a", "b", "c", "d"]);
  wire(group);

  group.keydown("End", group.items[0]);
  assert.deepEqual(group.tabIndexes, [-1, -1, -1, 0]);

  group.keydown("Home", group.items[3]);
  assert.deepEqual(group.tabIndexes, [0, -1, -1, -1]);
});

test("a key the group does not handle passes through untouched", () => {
  const group = new FakeGroup(["a", "b"]);
  wire(group);

  // Tab must reach the browser, or the group could never be left.
  assert.equal(group.keydown("Tab", group.items[0]), false);
  assert.equal(group.keydown("Enter", group.items[0]), false);
  assert.deepEqual(group.tabIndexes, [0, -1]);
  assert.deepEqual(group.focusLog, []);
});

test("a keydown from outside the group is ignored", () => {
  const group = new FakeGroup(["a", "b"]);
  wire(group);

  // A control nested inside the container but not matching itemSelector.
  const prevented = group.keydown("ArrowRight", new FakeItem("stray", []));

  assert.equal(prevented, false);
  assert.deepEqual(group.tabIndexes, [0, -1]);
  assert.deepEqual(group.focusLog, []);
});

test("focusing an item makes it the tab stop, so Tab-out/Tab-in returns to it", () => {
  const group = new FakeGroup(["a", "b", "c"]);
  wire(group);

  group.focusin(group.items[2]);

  assert.deepEqual(group.tabIndexes, [-1, -1, 0]);
  assert.deepEqual(
    group.focusLog,
    [],
    "the item already has focus; re-focusing it would be a loop",
  );
});

test("a focusin from outside the group leaves the tab stop where it was", () => {
  const group = new FakeGroup(["a", "b"]);
  wire(group);

  group.focusin(new FakeItem("stray", []));

  assert.deepEqual(group.tabIndexes, [0, -1]);
});

test("the returned callback moves the roving point programmatically", () => {
  const group = new FakeGroup(["a", "b", "c"]);
  const focusIndex = wire(group);

  focusIndex(1);

  assert.deepEqual(group.tabIndexes, [-1, 0, -1]);
  assert.deepEqual(group.focusLog, ["b"]);
});

test("the returned callback survives an index the group does not have", () => {
  // Callers pass an index derived from their own state (a selected tab id);
  // a stale one must not throw and leave the group with no tab stop at all.
  const group = new FakeGroup(["a", "b"]);
  const focusIndex = wire(group);

  assert.doesNotThrow(() => focusIndex(7));
  assert.deepEqual(group.focusLog, []);
});
