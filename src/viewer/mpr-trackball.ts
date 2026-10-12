/**
 * mpr-trackball.ts — MPR Trackball UI component (spec 007, TK-30 Phase 3).
 *
 * Programmatic DOM construction and event wiring for the trackball control group on the MPR toolbar:
 *  - PointerEvents on virtual sphere for 2-axis Pitch/Yaw rotation with pointer capture.
 *  - Dragging maps horizontal delta to Yaw and vertical delta to Pitch (1px = 1deg, 0.1deg with Shift).
 *  - Native <input type="range"> sliders provide accessible 1-pointer / keyboard controls (WCAG 2.5.7).
 *  - Reset button restores canonical orthogonal planes and announces once via polite live region.
 */

import { mprCoordinator } from "./mpr-coordinator.js";
import { getViewportManager } from "./viewport-registry.js";
import { t, onLocaleChange } from "../i18n/i18n.js";
import type { MPRPlane } from "./mpr-engine.js";

export interface MprTrackballHandle {
  el: HTMLElement;
  sphere: HTMLElement;
  pitchInput: HTMLInputElement;
  yawInput: HTMLInputElement;
  readout: HTMLOutputElement;
  resetButton: HTMLButtonElement;
  toggleButton: HTMLButtonElement;
  popover: HTMLElement;
  openPopover: () => void;
  closePopover: () => void;
  destroy: () => void;
}

/**
 * Creates and wires the DOM and event listeners for the MPR trackball control group.
 */
export function createMprTrackball(): MprTrackballHandle {
  const root = document.createElement("div");
  root.className = "mpr-trackball";
  root.setAttribute("role", "group");
  root.setAttribute("aria-labelledby", "mpr-trackball-label");

  // Menu button with icon (matches .toolbar__tool style)
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "toolbar__tool mpr-trackball-toggle";
  toggleButton.id = "tool-trackball";
  toggleButton.title =
    t("viewer.mpr.trackball.toggleTitle") ||
    "Rotación de planos MPR (Trackball)";
  toggleButton.setAttribute(
    "data-i18n-attr",
    "title:viewer.mpr.trackball.toggleTitle; aria-label:viewer.mpr.trackball.toggleTitle",
  );
  toggleButton.setAttribute(
    "aria-label",
    t("viewer.mpr.trackball.toggleTitle") ||
      "Rotación de planos MPR (Trackball)",
  );
  toggleButton.setAttribute("aria-haspopup", "dialog");
  toggleButton.setAttribute("aria-expanded", "false");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const circle = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "circle",
  );
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "9");
  svg.appendChild(circle);

  const path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path1.setAttribute("d", "M3.6 9h16.8");
  svg.appendChild(path1);

  const path2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path2.setAttribute("d", "M3.6 15h16.8");
  svg.appendChild(path2);

  const path3 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path3.setAttribute("d", "M11.5 3a17 17 0 0 0 0 18");
  svg.appendChild(path3);

  const path4 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path4.setAttribute("d", "M12.5 3a17 17 0 0 1 0 18");
  svg.appendChild(path4);

  toggleButton.appendChild(svg);

  const btnSpan = document.createElement("span");
  btnSpan.setAttribute("data-i18n", "viewer.mpr.trackball.button");
  btnSpan.textContent = t("viewer.mpr.trackball.button") || "Rotación";
  toggleButton.appendChild(btnSpan);

  root.appendChild(toggleButton);

  // Dropdown Popover container
  const popover = document.createElement("div");
  popover.className = "toolbar-popover mpr-trackball-popover hidden";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-labelledby", "mpr-trackball-label");

  // Popover header
  const header = document.createElement("div");
  header.className = "popover-header mpr-trackball-header";

  const labelSpan = document.createElement("span");
  labelSpan.id = "mpr-trackball-label";
  labelSpan.setAttribute("data-i18n", "viewer.mpr.trackball.label");
  labelSpan.textContent = t("viewer.mpr.trackball.label") || "Trackball MPR";
  header.appendChild(labelSpan);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "popover-close-btn mpr-trackball-close";
  closeButton.setAttribute(
    "aria-label",
    t("viewer.mpr.trackball.close") || "Cerrar",
  );
  closeButton.textContent = "×";
  header.appendChild(closeButton);

  popover.appendChild(header);

  // Popover body
  const body = document.createElement("div");
  body.className = "popover-body mpr-trackball-body";

  // Virtual sphere
  const sphere = document.createElement("div");
  sphere.className = "mpr-trackball-sphere";
  sphere.setAttribute("aria-hidden", "true");
  sphere.title =
    t("viewer.mpr.trackball.hint") || "Arrastrá para rotar · Shift = fino";
  body.appendChild(sphere);

  // Pitch accessible slider (range [-90, 90])
  const pitchLabel = document.createElement("label");
  const pitchSpan = document.createElement("span");
  pitchSpan.setAttribute("data-i18n", "viewer.mpr.trackball.pitch");
  pitchSpan.textContent = t("viewer.mpr.trackball.pitch") || "Pitch";
  pitchLabel.appendChild(pitchSpan);

  const pitchInput = document.createElement("input");
  pitchInput.type = "range";
  pitchInput.className = "mpr-trackball-pitch";
  pitchInput.min = "-90";
  pitchInput.max = "90";
  pitchInput.step = "1";
  pitchInput.value = "0";
  pitchLabel.appendChild(pitchInput);
  body.appendChild(pitchLabel);

  // Yaw accessible slider (range [-180, 180])
  const yawLabel = document.createElement("label");
  const yawSpan = document.createElement("span");
  yawSpan.setAttribute("data-i18n", "viewer.mpr.trackball.yaw");
  yawSpan.textContent = t("viewer.mpr.trackball.yaw") || "Yaw";
  yawLabel.appendChild(yawSpan);

  const yawInput = document.createElement("input");
  yawInput.type = "range";
  yawInput.className = "mpr-trackball-yaw";
  yawInput.min = "-180";
  yawInput.max = "180";
  yawInput.step = "1";
  yawInput.value = "0";
  yawLabel.appendChild(yawInput);
  body.appendChild(yawLabel);

  // Angle readout output
  const readout = document.createElement("output");
  readout.className = "mpr-trackball-readout";
  readout.setAttribute("aria-live", "off");
  body.appendChild(readout);

  // Reset button to return to canonical orthogonal axes
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "mpr-trackball-reset";
  resetButton.textContent = t("viewer.mpr.trackball.reset") || "Reset";
  resetButton.title = t("viewer.mpr.trackball.reset") || "Restablecer";
  resetButton.setAttribute(
    "data-i18n-attr",
    "aria-label:viewer.mpr.trackball.reset; title:viewer.mpr.trackball.reset",
  );
  resetButton.setAttribute(
    "aria-label",
    t("viewer.mpr.trackball.reset") || "Restablecer",
  );
  body.appendChild(resetButton);

  popover.appendChild(body);
  root.appendChild(popover);

  // ── Popover Visibility & Toggle ──────────────────────────────────────────

  function openPopover(): void {
    const rect = toggleButton.getBoundingClientRect();
    const winH = typeof window !== "undefined" ? window.innerHeight : 600;
    const top = Math.max(12, Math.min(rect.top, winH - 280));
    const left = rect.right > 0 ? rect.right + 8 : 72;
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.classList.remove("hidden");
    toggleButton.classList.add("active");
    toggleButton.setAttribute("aria-expanded", "true");
  }

  function closePopover(): void {
    popover.classList.add("hidden");
    toggleButton.classList.remove("active");
    toggleButton.setAttribute("aria-expanded", "false");
  }

  function togglePopover(): void {
    if (popover.classList.contains("hidden")) {
      openPopover();
    } else {
      closePopover();
    }
  }

  toggleButton.addEventListener("click", togglePopover);
  closeButton.addEventListener("click", closePopover);

  const onDocClick = (e: MouseEvent): void => {
    const target = e.target as Node | null;
    if (target && !root.contains(target)) {
      closePopover();
    }
  };
  document.addEventListener("click", onDocClick);

  const onDocKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && !popover.classList.contains("hidden")) {
      closePopover();
      toggleButton.focus();
    }
  };
  document.addEventListener("keydown", onDocKeydown);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getActivePlane(): MPRPlane {
    try {
      const manager = getViewportManager();
      const activeVp = manager?.activeViewport;
      if (
        activeVp &&
        activeVp.plane &&
        manager &&
        typeof manager.isCombined3DViewport === "function" &&
        !manager.isCombined3DViewport(activeVp.id)
      ) {
        return activeVp.plane as MPRPlane;
      }
    } catch {
      // Safe fallback
    }
    return "axial";
  }

  function updateReadoutAndSliders(): void {
    const { pitch, yaw } = mprCoordinator.getPitchYawDegrees();
    pitchInput.value = String(pitch);
    yawInput.value = String(yaw);

    const pitchStr = pitch.toFixed(1);
    const yawStr = yaw.toFixed(1);

    pitchInput.setAttribute(
      "aria-valuetext",
      `${pitchStr} ${t("viewer.mpr.trackball.valueText") || "grados"}`,
    );
    yawInput.setAttribute(
      "aria-valuetext",
      `${yawStr} ${t("viewer.mpr.trackball.valueText") || "grados"}`,
    );

    readout.textContent =
      t("viewer.mpr.trackball.readout", {
        pitch: pitchStr,
        yaw: yawStr,
      }) || `Pitch ${pitchStr}° · Yaw ${yawStr}°`;
  }

  // ── Sphere PointerEvents ───────────────────────────────────────────────────

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let activePointerId: number | null = null;

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (e.isPrimary === false && e.pointerType === "touch") return;
    e.preventDefault();
    e.stopPropagation();

    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    activePointerId = e.pointerId;

    try {
      sphere.setPointerCapture(e.pointerId);
    } catch {
      // Safe fallback if not supported in test environment
    }

    root.setAttribute("data-dragging", "true");
    sphere.setAttribute("data-dragging", "true");
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!isDragging) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    e.preventDefault();
    e.stopPropagation();

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (dx === 0 && dy === 0) return;

    const sensitivity = e.shiftKey ? 0.1 : 1.0;
    const DEG_TO_RAD = Math.PI / 180;
    const MAX_RAD = 15 * DEG_TO_RAD;

    // Horizontal drag maps to Yaw, vertical drag maps to Pitch
    // Drag right (dx > 0) => positive Yaw; drag down (dy > 0) => positive Pitch
    const dYaw = Math.max(
      -MAX_RAD,
      Math.min(MAX_RAD, dx * sensitivity * DEG_TO_RAD),
    );
    const dPitch = Math.max(
      -MAX_RAD,
      Math.min(MAX_RAD, dy * sensitivity * DEG_TO_RAD),
    );

    const plane = getActivePlane();
    mprCoordinator.rotatePitchYaw(dPitch, dYaw, plane);

    const manager = getViewportManager();
    if (manager) {
      for (const vp of manager.getAllViewports()) {
        vp.render();
      }
    }
    updateReadoutAndSliders();
  };

  const stopDrag = (e: PointerEvent): void => {
    if (!isDragging) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    isDragging = false;
    root.removeAttribute("data-dragging");
    sphere.removeAttribute("data-dragging");

    if (activePointerId !== null) {
      try {
        if (sphere.hasPointerCapture(activePointerId)) {
          sphere.releasePointerCapture(activePointerId);
        }
      } catch {
        // Safe release
      }
      activePointerId = null;
    }
  };

  sphere.addEventListener("pointerdown", onPointerDown);
  sphere.addEventListener("pointermove", onPointerMove);
  sphere.addEventListener("pointerup", stopDrag);
  sphere.addEventListener("pointercancel", stopDrag);
  sphere.addEventListener("lostpointercapture", stopDrag);

  // ── Accessible Sliders & Keyboard Events ───────────────────────────────────

  const onPitchInput = (): void => {
    const targetPitch = Number(pitchInput.value);
    const current = mprCoordinator.getPitchYawDegrees().pitch;
    const deltaDeg = targetPitch - current;
    if (Math.abs(deltaDeg) > 1e-4) {
      const plane = getActivePlane();
      mprCoordinator.rotatePitchYaw(deltaDeg * (Math.PI / 180), 0, plane);
      const manager = getViewportManager();
      if (manager) {
        for (const vp of manager.getAllViewports()) vp.render();
      }
      updateReadoutAndSliders();
    }
  };

  const onYawInput = (): void => {
    const targetYaw = Number(yawInput.value);
    const current = mprCoordinator.getPitchYawDegrees().yaw;
    let deltaDeg = targetYaw - current;
    if (deltaDeg > 180) deltaDeg -= 360;
    if (deltaDeg < -180) deltaDeg += 360;
    if (Math.abs(deltaDeg) > 1e-4) {
      const plane = getActivePlane();
      mprCoordinator.rotatePitchYaw(0, deltaDeg * (Math.PI / 180), plane);
      const manager = getViewportManager();
      if (manager) {
        for (const vp of manager.getAllViewports()) vp.render();
      }
      updateReadoutAndSliders();
    }
  };

  const handleSliderKeydown = (
    e: KeyboardEvent,
    axis: "pitch" | "yaw",
  ): void => {
    let delta = 0;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      delta = e.shiftKey ? 10 : 1;
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      delta = e.shiftKey ? -10 : -1;
    } else if (e.key === "PageUp") {
      delta = 15;
    } else if (e.key === "PageDown") {
      delta = -15;
    }

    if (delta !== 0) {
      e.preventDefault();
      const plane = getActivePlane();
      const dPitchRad = axis === "pitch" ? delta * (Math.PI / 180) : 0;
      const dYawRad = axis === "yaw" ? delta * (Math.PI / 180) : 0;
      mprCoordinator.rotatePitchYaw(dPitchRad, dYawRad, plane);
      const manager = getViewportManager();
      if (manager) {
        for (const vp of manager.getAllViewports()) vp.render();
      }
      updateReadoutAndSliders();
    }
  };

  pitchInput.addEventListener("input", onPitchInput);
  yawInput.addEventListener("input", onYawInput);
  pitchInput.addEventListener("keydown", (e) =>
    handleSliderKeydown(e, "pitch"),
  );
  yawInput.addEventListener("keydown", (e) => handleSliderKeydown(e, "yaw"));

  // ── Reset Button ───────────────────────────────────────────────────────────

  const onResetClick = (e: MouseEvent): void => {
    e.preventDefault();
    mprCoordinator.resetToOrthogonal();

    const manager = getViewportManager();
    if (manager) {
      for (const vp of manager.getAllViewports()) {
        vp.render();
      }
    }
    updateReadoutAndSliders();

    const announceEl =
      document.getElementById("measure-announce") ||
      document.getElementById("session-announce");
    if (announceEl) {
      announceEl.textContent =
        t("viewer.mpr.trackball.resetAnnounce") ||
        "Planos restablecidos a ortogonales";
    }
  };
  resetButton.addEventListener("click", onResetClick);

  // ── Initial State & Subscriptions ──────────────────────────────────────────

  updateReadoutAndSliders();
  const unsubRotation = mprCoordinator.onRotationChange(
    updateReadoutAndSliders,
  );
  const unsubLocale = onLocaleChange(updateReadoutAndSliders);

  const destroy = (): void => {
    unsubRotation();
    unsubLocale();
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onDocKeydown);
    toggleButton.removeEventListener("click", togglePopover);
    closeButton.removeEventListener("click", closePopover);
    sphere.removeEventListener("pointerdown", onPointerDown);
    sphere.removeEventListener("pointermove", onPointerMove);
    sphere.removeEventListener("pointerup", stopDrag);
    sphere.removeEventListener("pointercancel", stopDrag);
    sphere.removeEventListener("lostpointercapture", stopDrag);
    pitchInput.removeEventListener("input", onPitchInput);
    yawInput.removeEventListener("input", onYawInput);
    resetButton.removeEventListener("click", onResetClick);
  };

  return {
    el: root,
    sphere,
    pitchInput,
    yawInput,
    readout,
    resetButton,
    toggleButton,
    popover,
    openPopover,
    closePopover,
    destroy,
  };
}
