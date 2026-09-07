// ── Walkthrough overlay ───────────────────────────────────────────────────────
//
// The visual layer of the guided tour: a dimmer built from four scrim
// rectangles that leave a cut-out over the spotlit element (so the real control
// stays clickable for follow-along steps), an outline ring on that element, and
// a focus-trapped popover. The engine (walkthrough.ts) drives it; this module
// only draws and reports button clicks. Positioning is pure and unit-tested;
// the DOM plumbing reads layout at render time.

export type Placement = "top" | "bottom" | "left" | "right" | "center";

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

interface Viewport {
  width: number;
  height: number;
}

export interface OverlayCallbacks {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export interface OverlayLabels {
  back: string;
  skip: string;
  close: string;
}

export interface OverlayStepView {
  /** The element to spotlight, or null for a centered, spotlight-free step. */
  target: HTMLElement | null;
  title: string;
  body: string;
  placement: Placement;
  /** Already-interpolated "Step N of M". */
  progress: string;
  showBack: boolean;
  /** "Next" or "Finish" — the primary button is always present (Next fallback). */
  nextLabel: string;
  labels: OverlayLabels;
  reducedMotion: boolean;
}

export interface Overlay {
  render(view: OverlayStepView): void;
  destroy(): void;
  readonly root: HTMLElement;
  readonly popover: HTMLElement;
}

const RING_PAD = 4;
const GAP = 12;
const MARGIN = 8;

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

// ── Pure positioning math (unit-tested without a DOM) ─────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/** Four rectangles that dim everything except `hole`. */
export function computeScrimRects(
  hole: Rect,
  vp: Viewport,
): { top: Rect; bottom: Rect; left: Rect; right: Rect } {
  const holeBottom = hole.top + hole.height;
  const holeRight = hole.left + hole.width;
  return {
    top: { top: 0, left: 0, width: vp.width, height: Math.max(0, hole.top) },
    bottom: {
      top: holeBottom,
      left: 0,
      width: vp.width,
      height: Math.max(0, vp.height - holeBottom),
    },
    left: {
      top: hole.top,
      left: 0,
      width: Math.max(0, hole.left),
      height: hole.height,
    },
    right: {
      top: hole.top,
      left: holeRight,
      width: Math.max(0, vp.width - holeRight),
      height: hole.height,
    },
  };
}

/** Top-left for the popover, clamped inside the viewport. */
export function computePopoverPosition(
  hole: Rect | null,
  pop: Size,
  placement: Placement,
  vp: Viewport,
  gap = GAP,
  margin = MARGIN,
): { left: number; top: number } {
  let left: number;
  let top: number;

  if (!hole || placement === "center") {
    left = (vp.width - pop.width) / 2;
    top = (vp.height - pop.height) / 2;
  } else {
    const centerX = hole.left + hole.width / 2 - pop.width / 2;
    const centerY = hole.top + hole.height / 2 - pop.height / 2;
    switch (placement) {
      case "top":
        left = centerX;
        top = hole.top - gap - pop.height;
        break;
      case "left":
        left = hole.left - gap - pop.width;
        top = centerY;
        break;
      case "right":
        left = hole.left + hole.width + gap;
        top = centerY;
        break;
      case "bottom":
      default:
        left = centerX;
        top = hole.top + hole.height + gap;
        break;
    }
  }

  return {
    left: clamp(left, margin, Math.max(margin, vp.width - pop.width - margin)),
    top: clamp(top, margin, Math.max(margin, vp.height - pop.height - margin)),
  };
}

// ── DOM ───────────────────────────────────────────────────────────────────────

interface Scrims {
  top: HTMLElement;
  bottom: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
}

function scrim(): HTMLElement {
  const el = document.createElement("div");
  el.className = "walkthrough__scrim";
  return el;
}

function button(className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.addEventListener("click", onClick);
  return b;
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function sizeOf(el: HTMLElement): Size {
  const r = el.getBoundingClientRect();
  return {
    width: r.width || el.offsetWidth || 360,
    height: r.height || el.offsetHeight || 160,
  };
}

function applyRect(el: HTMLElement, r: Rect): void {
  el.style.top = `${r.top}px`;
  el.style.left = `${r.left}px`;
  el.style.width = `${Math.max(0, r.width)}px`;
  el.style.height = `${Math.max(0, r.height)}px`;
}

function viewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

function scrollIntoViewIfNeeded(el: HTMLElement): void {
  try {
    el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  } catch {
    // jsdom has no layout engine — a no-op there is fine
  }
}

/** Wraps Tab inside the popover so focus can never leave the dialog. */
function trapTab(e: KeyboardEvent, container: HTMLElement): void {
  const items = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE),
  ).filter((el) => el.offsetParent !== null);
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !container.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !container.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

export function createOverlay(cb: OverlayCallbacks): Overlay {
  const root = document.createElement("div");
  root.className = "walkthrough";

  const scrims: Scrims = {
    top: scrim(),
    bottom: scrim(),
    left: scrim(),
    right: scrim(),
  };
  const ring = document.createElement("div");
  ring.className = "walkthrough__ring hidden";

  const popover = document.createElement("div");
  popover.className = "walkthrough__popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-modal", "true");
  popover.setAttribute("aria-labelledby", "walkthrough-title");

  const progress = document.createElement("p");
  progress.className = "walkthrough__progress";
  progress.setAttribute("aria-live", "polite");

  const title = document.createElement("h2");
  title.className = "walkthrough__title";
  title.id = "walkthrough-title";

  const body = document.createElement("p");
  body.className = "walkthrough__body";

  const closeBtn = button("walkthrough__close", () => cb.onSkip());
  closeBtn.dataset.tourClose = "";
  closeBtn.innerHTML = "&times;";

  const controls = document.createElement("div");
  controls.className = "walkthrough__controls";
  const skipBtn = button("walkthrough__btn walkthrough__btn--skip", () =>
    cb.onSkip(),
  );
  skipBtn.dataset.tourSkip = "";
  const spacer = document.createElement("div");
  spacer.className = "walkthrough__spacer";
  const backBtn = button("walkthrough__btn", () => cb.onBack());
  backBtn.dataset.tourBack = "";
  const nextBtn = button("walkthrough__btn walkthrough__btn--primary", () =>
    cb.onNext(),
  );
  nextBtn.dataset.tourNext = "";
  controls.append(skipBtn, spacer, backBtn, nextBtn);

  popover.append(closeBtn, progress, title, body, controls);
  root.append(
    scrims.top,
    scrims.bottom,
    scrims.left,
    scrims.right,
    ring,
    popover,
  );

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      cb.onSkip();
      return;
    }
    if (e.key === "Tab") trapTab(e, popover);
  };
  popover.addEventListener("keydown", onKeydown);

  document.body.appendChild(root);

  function showSpotlight(hole: Rect): void {
    const padded: Rect = {
      top: hole.top - RING_PAD,
      left: hole.left - RING_PAD,
      width: hole.width + RING_PAD * 2,
      height: hole.height + RING_PAD * 2,
    };
    const rects = computeScrimRects(padded, viewport());
    applyRect(scrims.top, rects.top);
    applyRect(scrims.bottom, rects.bottom);
    applyRect(scrims.left, rects.left);
    applyRect(scrims.right, rects.right);
    applyRect(ring, padded);
    Object.values(scrims).forEach((s) => s.classList.remove("hidden"));
    ring.classList.remove("hidden");
  }

  function hideSpotlight(): void {
    // One full-screen scrim, no cut-out, for centered steps.
    ring.classList.add("hidden");
    const vp = viewport();
    applyRect(scrims.top, { top: 0, left: 0, width: vp.width, height: vp.height });
    scrims.top.classList.remove("hidden");
    [scrims.bottom, scrims.left, scrims.right].forEach((s) =>
      s.classList.add("hidden"),
    );
  }

  function render(view: OverlayStepView): void {
    root.classList.toggle("walkthrough--reduced", view.reducedMotion);
    progress.textContent = view.progress;
    title.textContent = view.title;
    body.textContent = view.body;
    closeBtn.setAttribute("aria-label", view.labels.close);
    skipBtn.textContent = view.labels.skip;
    backBtn.textContent = view.labels.back;
    backBtn.classList.toggle("hidden", !view.showBack);
    nextBtn.textContent = view.nextLabel;

    if (view.target) {
      if (!view.reducedMotion) scrollIntoViewIfNeeded(view.target);
      showSpotlight(rectOf(view.target));
      const pos = computePopoverPosition(
        rectOf(view.target),
        sizeOf(popover),
        view.placement,
        viewport(),
      );
      popover.style.left = `${Math.round(pos.left)}px`;
      popover.style.top = `${Math.round(pos.top)}px`;
    } else {
      hideSpotlight();
      const pos = computePopoverPosition(
        null,
        sizeOf(popover),
        "center",
        viewport(),
      );
      popover.style.left = `${Math.round(pos.left)}px`;
      popover.style.top = `${Math.round(pos.top)}px`;
    }

    // Land keyboard focus on the primary action so Enter advances immediately.
    nextBtn.focus();
  }

  function destroy(): void {
    popover.removeEventListener("keydown", onKeydown);
    root.remove();
  }

  return { render, destroy, root, popover };
}
