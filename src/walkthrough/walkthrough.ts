// ── Walkthrough engine ────────────────────────────────────────────────────────
//
// The in-house, dependency-free guided tour (see docs/walkthrough-guide-plan.md,
// TK-27). It walks a declarative list of steps: for each it navigates to the
// right screen/tab, spotlights an element, and advances either when the user
// performs the real interaction (follow-along) or clicks Next (the always-
// present fallback). Content lives in tour-steps.ts (added later); this module
// is the runner and knows nothing about which features exist.

import type { Role } from "../auth/auth.js";
import type { ScreenName } from "../shared/screen.js";
import { showScreen } from "../shared/screen.js";
import { t, onLocaleChange } from "../i18n/i18n.js";
import { markTourSeen } from "./tour-state.js";
import { createOverlay, type Overlay, type Placement } from "./overlay.js";

export type { Placement };

// The roles that share the viewer core. informatico is left out on purpose:
// its tour is only upload + download, so it never gets the common steps.
const ALL_ROLES: readonly Role[] = ["admin", "medico", "investigador"];

export interface TourStep {
  id: string;
  /** Which roles see this step. A step listing every role is "common core". */
  roles: Role[];
  /** CSS selector for the element to spotlight; "" or "center" → no spotlight. */
  target: string;
  titleKey: string;
  bodyKey: string;
  /** Ensure this screen is active before spotlighting. */
  screen?: ScreenName;
  /** Ensure this server tab is active first. Kept loose to avoid importing the
   *  server-screen module graph into the engine. */
  tab?: string;
  placement?: Placement;
  advance: { on: "next" } | { on: "event"; event: string; selector?: string };
  /** If the target is missing/hidden, skip silently instead of stalling. */
  optional?: boolean;
  onEnter?: () => void | Promise<void>;
  onExit?: () => void;
}

export type TourEndReason = "completed" | "skipped";

export interface StartTourOptions {
  role: Role | null;
  opener?: HTMLElement | null;
  /** Ensure the right screen/tab is visible before spotlighting. Defaults to a
   *  screen-only navigator built on showScreen(); main.ts passes a richer one
   *  that also switches server tabs. */
  navigate?: (step: TourStep) => void | Promise<void>;
  onEnd?: (reason: TourEndReason) => void;
}

// ── Pure step selection (unit-tested) ─────────────────────────────────────────

/** A step shown to every signed-in role — and therefore to a guest too. */
export function isCommonStep(step: TourStep): boolean {
  return ALL_ROLES.every((r) => step.roles.includes(r));
}

/** The steps that apply to `role`; a guest (null) gets the common core only. */
export function applicableSteps(
  steps: TourStep[],
  role: Role | null,
): TourStep[] {
  if (role === null) return steps.filter(isCommonStep);
  return steps.filter((s) => s.roles.includes(role));
}

// ── Engine state ──────────────────────────────────────────────────────────────

let active = false;
let steps: TourStep[] = [];
let index = 0;
let overlay: Overlay | null = null;
let role: Role | null = null;
let opener: HTMLElement | null = null;
let navigate: (step: TourStep) => void | Promise<void> = defaultNavigate;
let onEnd: ((reason: TourEndReason) => void) | undefined;
let detachAdvance: (() => void) | null = null;
let onViewportChange: (() => void) | null = null;
let unsubscribeLocale: (() => void) | null = null;
// Bumped on every step change and on finish, so an in-flight async enterStep()
// that has been superseded (user skipped, another step started) bails out.
let runToken = 0;

function defaultNavigate(step: TourStep): void {
  if (step.screen) showScreen(step.screen);
}

function isCenter(step: TourStep): boolean {
  return !step.target || step.target === "center";
}

function resolveTarget(step: TourStep): HTMLElement | null {
  if (isCenter(step)) return null;
  try {
    return document.querySelector<HTMLElement>(step.target);
  } catch {
    return null; // malformed selector — treat as a missing target
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      resolve();
    }
  });
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

function clearAdvance(): void {
  detachAdvance?.();
  detachAdvance = null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isTourActive(): boolean {
  return active;
}

/** Current 0-based step index — exposed for tests. */
export function currentStepIndex(): number {
  return index;
}

export function startTour(all: TourStep[], opts: StartTourOptions): void {
  if (active) stopTour(); // never stack two tours

  role = opts.role;
  steps = applicableSteps(all, role);
  opener =
    opts.opener ??
    (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);
  navigate = opts.navigate ?? defaultNavigate;
  onEnd = opts.onEnd;

  if (steps.length === 0) {
    finish("completed");
    return;
  }

  active = true;
  index = 0;
  overlay = createOverlay({
    onNext: goNext,
    onBack: goBack,
    onSkip: () => finish("skipped"),
  });

  onViewportChange = () => {
    if (active && overlay) renderCurrent();
  };
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);
  unsubscribeLocale = onLocaleChange(() => {
    if (active && overlay) renderCurrent();
  });

  void enterStep(0);
}

export function stopTour(): void {
  if (active || overlay) finish("skipped");
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function enterStep(i: number): Promise<void> {
  const token = ++runToken;
  clearAdvance();

  const leaving = steps[index];
  if (leaving && leaving !== steps[i]) leaving.onExit?.();

  index = i;
  const step = steps[i];

  await navigate(step);
  if (token !== runToken || !active) return;

  await step.onEnter?.();
  if (token !== runToken || !active) return;

  // Give the just-navigated screen a frame to lay out before measuring.
  await nextFrame();
  if (token !== runToken || !active) return;

  const target = resolveTarget(step);
  if (!target && !isCenter(step) && step.optional) {
    // Target hidden for this role/state — skip cleanly rather than stall.
    if (i >= steps.length - 1) {
      finish("completed");
    } else {
      void enterStep(i + 1);
    }
    return;
  }

  renderCurrent(target);
  setupAdvance(step, target);
}

function renderCurrent(target?: HTMLElement | null): void {
  if (!overlay) return;
  const step = steps[index];
  const tgt = target !== undefined ? target : resolveTarget(step);
  const last = index >= steps.length - 1;
  overlay.render({
    target: tgt,
    title: t(step.titleKey),
    body: t(step.bodyKey),
    placement: step.placement ?? "bottom",
    progress: t("tour.progress", { n: index + 1, total: steps.length }),
    showBack: index > 0,
    nextLabel: last ? t("tour.controls.finish") : t("tour.controls.next"),
    labels: {
      back: t("tour.controls.back"),
      skip: t("tour.controls.skip"),
      close: t("tour.controls.close"),
    },
    reducedMotion: prefersReducedMotion(),
  });
}

function setupAdvance(step: TourStep, target: HTMLElement | null): void {
  const adv = step.advance;
  if (adv.on !== "event") return; // "next" → primary button only
  const el = adv.selector
    ? document.querySelector<HTMLElement>(adv.selector)
    : target;
  if (!el) return; // no element to listen on — the Next fallback still works
  const handler = (): void => goNext();
  el.addEventListener(adv.event, handler, { once: true });
  detachAdvance = () => el.removeEventListener(adv.event, handler);
}

function goNext(): void {
  if (!active) return;
  if (index >= steps.length - 1) {
    finish("completed");
    return;
  }
  void enterStep(index + 1);
}

function goBack(): void {
  if (!active || index === 0) return;
  void enterStep(index - 1);
}

function finish(reason: TourEndReason): void {
  runToken++; // cancel any in-flight enterStep()
  clearAdvance();
  steps[index]?.onExit?.();

  overlay?.destroy();
  overlay = null;

  if (onViewportChange) {
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
    onViewportChange = null;
  }
  unsubscribeLocale?.();
  unsubscribeLocale = null;

  active = false;

  // Skipping and finishing both count as "seen"; a guest has no role flag.
  if (role) markTourSeen(role);

  if (opener?.isConnected) opener.focus();

  const cb = onEnd;
  onEnd = undefined;
  cb?.(reason);
}
