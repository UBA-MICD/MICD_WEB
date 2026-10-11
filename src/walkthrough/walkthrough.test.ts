/**
 * Tests for walkthrough.ts — the tour engine. jsdom for the overlay DOM; a
 * fresh module per test (cache-busted import) because the engine holds
 * module-level run state. Locale is pinned to English for deterministic copy.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, uninstallDom } from "../../test/dom-setup.ts";
import { setLocale } from "../i18n/i18n.ts";
import type { TourStep } from "./walkthrough.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

let counter = 0;
async function freshEngine() {
  return import(`./walkthrough.ts?fresh=${counter++}`);
}

function step(over: Partial<TourStep> = {}): TourStep {
  return {
    id: "s",
    roles: ["admin", "medico", "investigador", "informatico"],
    target: "#t",
    titleKey: "title.key",
    bodyKey: "body.key",
    advance: { on: "next" },
    ...over,
  };
}

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await raf();
    await Promise.resolve();
  }
}

const click = (sel: string): void =>
  (document.querySelector(sel) as HTMLButtonElement).click();
const progressText = (): string | null =>
  document.querySelector(".walkthrough__progress")?.textContent ?? null;

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = `
    <button id="opener"></button>
    <div id="t">target</div>
    <div id="u">other</div>`;
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

// ── Pure selection ────────────────────────────────────────────────────────────

test("applicableSteps keeps a role's steps; a guest gets the common core only", async () => {
  const { applicableSteps, isCommonStep } = await freshEngine();
  const steps = [
    step({ id: "core", roles: ["admin", "medico", "investigador", "informatico"] }),
    step({ id: "adminOnly", roles: ["admin"] }),
    step({ id: "staff", roles: ["admin", "medico"] }),
  ];
  assert.deepEqual(
    applicableSteps(steps, "admin").map((s: TourStep) => s.id),
    ["core", "adminOnly", "staff"],
  );
  assert.deepEqual(
    applicableSteps(steps, "medico").map((s: TourStep) => s.id),
    ["core", "staff"],
  );
  assert.deepEqual(
    applicableSteps(steps, "investigador").map((s: TourStep) => s.id),
    ["core"],
  );
  assert.deepEqual(
    applicableSteps(steps, null).map((s: TourStep) => s.id),
    ["core"],
  );
  assert.equal(isCommonStep(steps[0]), true);
  assert.equal(isCommonStep(steps[1]), false);
});

// ── Rendering & flow ──────────────────────────────────────────────────────────

test("startTour mounts the overlay and shows the first step", async () => {
  const { startTour } = await freshEngine();
  startTour([step(), step({ id: "s2" })], { role: "admin" });
  await flush();

  const pop = document.querySelector(".walkthrough__popover");
  assert.ok(pop, "popover mounted");
  assert.equal(pop!.getAttribute("role"), "dialog");
  assert.equal(pop!.getAttribute("aria-modal"), "true");
  assert.equal(progressText(), "Step 1 of 2");
  assert.ok(document.querySelector(".walkthrough__ring"));
});

test("Next advances; Finish ends, removes the overlay, and marks the role seen", async () => {
  const { startTour, isTourActive } = await freshEngine();
  let ended: string | null = null;
  startTour([step(), step({ id: "s2" })], {
    role: "admin",
    onEnd: (r: string) => {
      ended = r;
    },
  });
  await flush();

  click("[data-tour-next]");
  await flush();
  assert.equal(progressText(), "Step 2 of 2");
  assert.equal(
    (document.querySelector("[data-tour-next]") as HTMLElement).textContent,
    "Finish",
  );

  click("[data-tour-next]");
  await flush();
  assert.equal(ended, "completed");
  assert.equal(isTourActive(), false);
  assert.equal(document.querySelector(".walkthrough"), null);
  assert.equal(localStorage.getItem("micd.tour.seen.admin"), "1");
});

test("Escape skips the tour and marks it seen", async () => {
  const { startTour } = await freshEngine();
  let ended: string | null = null;
  startTour([step()], {
    role: "medico",
    onEnd: (r: string) => {
      ended = r;
    },
  });
  await flush();

  const pop = document.querySelector(".walkthrough__popover") as HTMLElement;
  pop.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await flush();

  assert.equal(ended, "skipped");
  assert.equal(document.querySelector(".walkthrough"), null);
  assert.equal(localStorage.getItem("micd.tour.seen.medico"), "1");
});

test("the Skip button ends the tour", async () => {
  const { startTour, isTourActive } = await freshEngine();
  startTour([step(), step({ id: "s2" })], { role: "admin" });
  await flush();
  click("[data-tour-skip]");
  await flush();
  assert.equal(isTourActive(), false);
});

test("a follow-along step advances when the target fires its event", async () => {
  const { startTour } = await freshEngine();
  startTour(
    [
      step({
        id: "s1",
        target: "#t",
        advance: { on: "event", event: "click" },
      }),
      step({ id: "s2", target: "#u" }),
    ],
    { role: "admin" },
  );
  await flush();
  assert.equal(progressText(), "Step 1 of 2");

  document.getElementById("t")!.click();
  await flush();
  assert.equal(progressText(), "Step 2 of 2");
});

test("an optional step whose target is missing is skipped", async () => {
  const { startTour } = await freshEngine();
  startTour(
    [
      step({ id: "s1", target: "#t" }),
      step({ id: "gone", target: "#nope", optional: true }),
      step({ id: "s3", target: "#u" }),
    ],
    { role: "admin" },
  );
  await flush();

  click("[data-tour-next]"); // leave s1 → s2 missing → auto-skip to s3
  await flush();
  assert.equal(progressText(), "Step 3 of 3");
});

test("navigate is invoked for each step before spotlighting", async () => {
  const { startTour } = await freshEngine();
  const seen: string[] = [];
  startTour([step({ id: "a" }), step({ id: "b" })], {
    role: "admin",
    navigate: (s: TourStep) => {
      seen.push(s.id);
    },
  });
  await flush();
  click("[data-tour-next]");
  await flush();
  assert.deepEqual(seen, ["a", "b"]);
});

test("Back is hidden on the first step and returns on later steps", async () => {
  const { startTour } = await freshEngine();
  startTour([step({ id: "a" }), step({ id: "b" })], { role: "admin" });
  await flush();

  const back = () => document.querySelector("[data-tour-back]") as HTMLElement;
  assert.equal(back().classList.contains("hidden"), true);

  click("[data-tour-next]");
  await flush();
  assert.equal(back().classList.contains("hidden"), false);

  back().click();
  await flush();
  assert.equal(progressText(), "Step 1 of 2");
  click("[data-tour-skip]");
  await flush();
});

test("a guest tour writes no seen-flag", async () => {
  const { startTour } = await freshEngine();
  startTour([step()], { role: null });
  await flush();
  click("[data-tour-skip]");
  await flush();

  let found = false;
  for (let i = 0; i < localStorage.length; i++) {
    if (localStorage.key(i)?.startsWith("micd.tour.seen.")) found = true;
  }
  assert.equal(found, false);
});
