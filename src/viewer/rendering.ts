import { renderDicom, applyCanvasTransform } from "../dicom/dicom-renderer.js";
import { $, escapeHtml } from "../shared/dom.js";
import { state, itemCount } from "./state.js";
import { view3DViewer, mpr3DViewer } from "./view-3d.js";
import { t, onLocaleChange } from "../i18n/i18n.js";
import { getViewportManager } from "./viewport-registry.js";
import { renderMeasurementOverlay } from "./measurements/measurement-overlay.js";
import { getActiveSopInstanceUid } from "./measurements/annotation-state.js";

// ── Rendering ────────────────────────────────────────────────────────────────

export function render(): void {
  const canvas = (document.getElementById("view-3d-canvas") ||
    $("dicom-canvas")) as HTMLCanvasElement;

  if (state.is3DMode && view3DViewer.isActive) {
    // 3D Unified Viewport rendering
    view3DViewer.render(canvas);

    // Show and update depth slider and orientation widget
    update3DControls();
    updateOrientationLabels();
    return;
  }

  // Standard 2D Slice rendering
  hide3DControls();
  if (!state.parsed?.pixelData) {
    updateOrientationLabels();
    return;
  }

  const manager = getViewportManager();
  if (manager) {
    if (state.isMprMode) {
      manager.getAllViewports().forEach((vp) => vp.render());
      updateOrientationLabels();
      return;
    }
    // Multi-viewport Grid architecture (1x1, 1x2, 2x2)
    const activeVp = manager.activeViewport;
    if (activeVp) {
      activeVp.data.parsed = state.parsed;
      activeVp.data.source = state.source;
      activeVp.data.files = state.files;
      activeVp.data.serverStudyId = state.serverStudyId;
      activeVp.data.serverInstances = state.serverInstances;
      activeVp.data.currentIndex = state.currentIndex;
      activeVp.data.viewport = state.viewport;
      activeVp.render();
    }
    updateOrientationLabels();
    return;
  }

  // Single viewport fallback (legacy)
  const dicomCanvas = $("dicom-canvas") as HTMLCanvasElement;
  renderDicom({
    canvas: dicomCanvas,
    pixelData: state.parsed.pixelData,
    metadata: state.parsed.metadata,
    viewport: state.viewport,
  });

  applyCanvasTransform(
    $("viewport-container") as HTMLCanvasElement,
    dicomCanvas,
    state.viewport,
  );

  const overlayCanvas = $("annotation-overlay") as HTMLCanvasElement | null;
  if (overlayCanvas && state.parsed?.metadata) {
    const container = $("viewport-container");
    const w = container?.clientWidth || dicomCanvas.width;
    const h = container?.clientHeight || dicomCanvas.height;
    if (overlayCanvas.width !== w) overlayCanvas.width = w;
    if (overlayCanvas.height !== h) overlayCanvas.height = h;
    renderMeasurementOverlay({
      canvas: overlayCanvas,
      viewport: state.viewport,
      metadata: state.parsed.metadata,
      pixelData: state.parsed.pixelData,
      sopInstanceUid: getActiveSopInstanceUid(),
      sliceIndex: state.currentIndex,
    });
  }

  updateInfoOverlay();
  updateOrientationLabels();
}

// ── 2D Orientation Labels (A, P, L, R) ───────────────────────────────────────

export function updateOrientationLabels(): void {
  const top = $("mpr-orient-top");
  const bottom = $("mpr-orient-bottom");
  const left = $("mpr-orient-left");
  const right = $("mpr-orient-right");

  if (!state.parsed?.pixelData || state.is3DMode) {
    if (top) top.textContent = "";
    if (bottom) bottom.textContent = "";
    if (left) left.textContent = "";
    if (right) right.textContent = "";
    return;
  }

  if (top) top.textContent = "A";
  if (bottom) bottom.textContent = "P";
  if (left) left.textContent = "R";
  if (right) right.textContent = "L";
}

// ── 3D Controls Update ───────────────────────────────────────────────────────

export function update3DControls(): void {
  [
    "view-3d-container",
    "view-3d-depth-slider-wrap",
    "mpr-depth-slider-wrap",
    "view-3d-orientation-widget",
    "mpr-orientation-widget",
    "view-3d-reference-cube",
    "mpr-reference-cube",
  ].forEach((id) => {
    $(id)?.classList.remove("hidden");
  });

  const depthInfo = view3DViewer.getDepthInfo();
  ["view-3d-depth-slider", "mpr-depth-slider"].forEach((id) => {
    const depthSlider = $(id) as HTMLInputElement | null;
    if (depthSlider) {
      depthSlider.min = "0";
      depthSlider.max = String(Math.max(0, depthInfo.total - 1));
      depthSlider.value = String(depthInfo.current);
    }
  });

  const counterText =
    t("viewer.view3d.sliceCounter", {
      current: depthInfo.current + 1,
      total: depthInfo.total,
    }) ||
    t("viewer.mpr.sliceCounter", {
      current: depthInfo.current + 1,
      total: depthInfo.total,
    });

  ["view-3d-depth-counter", "mpr-depth-counter"].forEach((id) => {
    const depthCounter = $(id);
    if (depthCounter) {
      depthCounter.textContent = counterText;
    }
  });

  updateView3DButtonState();

  // Update Tri-Planar sliders
  if (view3DViewer.volume) {
    ["view-3d-scroll-axial", "mpr-scroll-axial"].forEach((id) => {
      const scrollAxial = $(id) as HTMLInputElement | null;
      if (scrollAxial && document.activeElement !== scrollAxial) {
        scrollAxial.min = "0";
        scrollAxial.max = String(Math.max(0, view3DViewer.volume!.depth - 1));
        scrollAxial.value = String(view3DViewer.crosshair.z);
      }
    });

    ["view-3d-scroll-coronal", "mpr-scroll-coronal"].forEach((id) => {
      const scrollCoronal = $(id) as HTMLInputElement | null;
      if (scrollCoronal && document.activeElement !== scrollCoronal) {
        scrollCoronal.min = "0";
        scrollCoronal.max = String(Math.max(0, view3DViewer.volume!.rows - 1));
        scrollCoronal.value = String(view3DViewer.crosshair.y);
      }
    });

    ["view-3d-scroll-sagittal", "mpr-scroll-sagittal"].forEach((id) => {
      const scrollSagittal = $(id) as HTMLInputElement | null;
      if (scrollSagittal && document.activeElement !== scrollSagittal) {
        scrollSagittal.min = "0";
        scrollSagittal.max = String(Math.max(0, view3DViewer.volume!.cols - 1));
        scrollSagittal.value = String(view3DViewer.crosshair.x);
      }
    });
  }
}

export function hide3DControls(): void {
  [
    "view-3d-container",
    "view-3d-depth-slider-wrap",
    "mpr-depth-slider-wrap",
    "view-3d-orientation-widget",
    "mpr-orientation-widget",
    "view-3d-reference-cube",
    "mpr-reference-cube",
  ].forEach((id) => {
    $(id)?.classList.add("hidden");
  });
}

// ── Series Navigation ────────────────────────────────────────────────────────

export function updateSeriesNav(): void {
  const nav = $("series-nav");
  const count = itemCount();

  if (count <= 1 || state.is3DMode) {
    nav.classList.add("hidden");
    updateMprButtonState();
    return;
  }
  nav.classList.remove("hidden");

  ($("nav-prev") as HTMLButtonElement).disabled = state.currentIndex === 0;
  ($("nav-next") as HTMLButtonElement).disabled =
    state.currentIndex === count - 1;

  const slider = $("nav-slider") as HTMLInputElement | null;
  if (slider) {
    slider.min = "0";
    slider.max = String(count - 1);
    slider.value = String(state.currentIndex);
  }

  $("nav-counter").textContent = t("viewer.nav.sliceCounter", {
    current: state.currentIndex + 1,
    count,
  });

  updateView3DButtonState();
}

// ── 3D View Button Tooltip / Validation State ─────────────────────────────────

export function updateView3DButtonState(): void {
  const buttons = [$("tool-view-3d"), $("tool-mpr")].filter(
    Boolean,
  ) as HTMLButtonElement[];
  if (buttons.length === 0) return;

  const count = itemCount();
  if (count <= 1) {
    const title =
      t("viewer.view3d.notCompatibleSlices") ||
      t("viewer.mpr.notCompatibleSlices");
    buttons.forEach((btn) => {
      btn.disabled = true;
      btn.title = title;
      btn.classList.add("disabled");
      btn.classList.remove("active");
    });
    return;
  }

  if (!state.parsed || !state.parsed.metadata) {
    const title =
      t("viewer.view3d.loadingMetadata") || t("viewer.mpr.loadingMetadata");
    buttons.forEach((btn) => {
      btn.disabled = true;
      btn.title = title;
      btn.classList.add("disabled");
      btn.classList.remove("active");
    });
    return;
  }

  const meta = state.parsed.metadata;
  if (
    !meta.pixelSpacing ||
    meta.pixelSpacing.length < 2 ||
    meta.pixelSpacing[0] <= 0 ||
    meta.pixelSpacing[1] <= 0
  ) {
    const title =
      t("viewer.view3d.notCompatiblePixelSpacing") ||
      t("viewer.mpr.notCompatiblePixelSpacing");
    buttons.forEach((btn) => {
      btn.disabled = true;
      btn.title = title;
      btn.classList.add("disabled");
      btn.classList.remove("active");
    });
    return;
  }

  if (!meta.imagePositionPatient || meta.imagePositionPatient.length < 3) {
    const title =
      t("viewer.view3d.notCompatibleImagePosition") ||
      t("viewer.mpr.notCompatibleImagePosition");
    buttons.forEach((btn) => {
      btn.disabled = true;
      btn.title = title;
      btn.classList.add("disabled");
      btn.classList.remove("active");
    });
    return;
  }

  const btn3D = $("tool-view-3d") as HTMLButtonElement | null;
  if (btn3D) {
    btn3D.disabled = false;
    btn3D.classList.remove("disabled");
    btn3D.classList.toggle("active", Boolean(state.is3DMode));
    btn3D.title = state.is3DMode
      ? t("viewer.view3d.backTo2D") || t("viewer.mpr.backTo2D")
      : t("viewer.view3d.enabledTitle") || t("viewer.mpr.enabledTitle");
    btn3D.setAttribute("aria-pressed", String(Boolean(state.is3DMode)));
  }

  const btnMpr = $("tool-mpr") as HTMLButtonElement | null;
  if (btnMpr) {
    btnMpr.disabled = false;
    btnMpr.classList.remove("disabled");
    btnMpr.classList.toggle("active", Boolean(state.isMprMode));
    btnMpr.title = state.isMprMode
      ? t("viewer.mpr.backTo2D") || t("viewer.view3d.backTo2D")
      : t("viewer.tool.mprStaticTitle") || t("viewer.mpr.enabledTitle");
    btnMpr.setAttribute("aria-pressed", String(Boolean(state.isMprMode)));
  }
}

// Backwards-compatible alias for existing tests and callers
export const updateMprButtonState = updateView3DButtonState;

// ── Metadata Panel ───────────────────────────────────────────────────────────

export function updateMetadataPanel(): void {
  if (!state.parsed) return;
  const m = state.parsed.metadata;

  const rows = [
    [t("viewer.metadata.patientName"), m.patientName],
    [t("viewer.metadata.patientId"), m.patientId],
    [t("viewer.metadata.birthDate"), m.patientBirthDate],
    [t("viewer.metadata.sex"), m.patientSex],
    ["", ""],
    [t("viewer.metadata.studyDate"), m.studyDate],
    [t("viewer.metadata.studyDescription"), m.studyDescription],
    [t("viewer.metadata.accessionNumber"), m.accessionNumber],
    [t("viewer.metadata.referringPhysician"), m.referringPhysician],
    ["", ""],
    [t("viewer.metadata.modality"), m.modality],
    [t("viewer.metadata.series"), m.seriesDescription],
    [t("viewer.metadata.seriesNumber"), m.seriesNumber],
    [t("viewer.metadata.instanceNumber"), m.instanceNumber],
    ["", ""],
    [t("viewer.metadata.dimensions"), `${m.columns} × ${m.rows}`],
    [
      t("viewer.metadata.pixelSpacing"),
      m.pixelSpacing ? `${m.pixelSpacing[0]} × ${m.pixelSpacing[1]} mm` : "—",
    ],
    [
      t("viewer.metadata.imagePosition"),
      m.imagePositionPatient ? m.imagePositionPatient.join(", ") : "—",
    ],
    [t("viewer.metadata.bitsAllocated"), String(m.bitsAllocated)],
    [t("viewer.metadata.bitsStored"), String(m.bitsStored)],
    [t("viewer.metadata.photometric"), m.photometricInterpretation],
    [
      t("viewer.metadata.pixelRepr"),
      m.pixelRepresentation === 0
        ? t("viewer.metadata.valueUnsigned")
        : t("viewer.metadata.valueSigned"),
    ],
    [t("viewer.metadata.rescaleSlope"), String(m.rescaleSlope)],
    [t("viewer.metadata.rescaleIntercept"), String(m.rescaleIntercept)],
    [t("viewer.metadata.transferSyntax"), m.transferSyntaxUid],
  ];

  const tbody = $("metadata-tbody");
  tbody.innerHTML = "";

  rows.forEach(([label, value]) => {
    if (label === "" && value === "") {
      const tr = document.createElement("tr");
      tr.className = "metadata-separator";
      tr.innerHTML = '<td colspan="2"><hr /></td>';
      tbody.appendChild(tr);
      return;
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="meta-key">${escapeHtml(label)}</td><td class="meta-val">${escapeHtml(value || "—")}</td>`;
    tbody.appendChild(tr);
  });
}

// ── Info Overlay ─────────────────────────────────────────────────────────────

export function updateInfoOverlay(): void {
  if (!state.parsed) return;
  const m = state.parsed.metadata;

  // Every value here comes out of the DICOM file, i.e. untrusted input, and
  // goes into innerHTML. It was interpolated raw before, so a crafted study
  // could inject markup — and the CSP allows 'unsafe-inline' scripts.
  const lines = (parts: (string | number)[]): string =>
    parts
      .filter((part) => part !== "" && part !== null && part !== undefined)
      .map((part) => escapeHtml(String(part)))
      .join("<br>");

  const overlayTl = document.getElementById("overlay-tl");
  const overlayTr = document.getElementById("overlay-tr");
  const overlayBl = document.getElementById("overlay-bl");
  const overlayBr = document.getElementById("overlay-br");

  if (overlayTl) overlayTl.innerHTML = lines([m.patientName, m.patientId]);
  if (overlayTr) {
    overlayTr.innerHTML = lines([m.studyDate, m.modality, m.studyDescription]);
  }
  if (overlayBl) {
    overlayBl.innerHTML = lines([
      `W: ${Math.round(state.viewport.windowWidth)} L: ${Math.round(state.viewport.windowCenter)}`,
      `Zoom: ${(state.viewport.zoom * 100).toFixed(0)}%`,
    ]);
  }
  if (overlayBr) {
    overlayBr.innerHTML = lines([
      `${m.columns} × ${m.rows}`,
      `${m.bitsStored}bit`,
    ]);
  }

  updateCanvasLabel();
  updateWlControlsUI();
}

export function updateWlControlsUI(): void {
  const valWW = $("val-ww");
  const valWL = $("val-wl");
  const sliderWW = $("slider-ww") as HTMLInputElement | null;
  const sliderWL = $("slider-wl") as HTMLInputElement | null;

  const ww = Math.round(state.viewport.windowWidth);
  const wl = Math.round(state.viewport.windowCenter);

  if (valWW) valWW.textContent = String(ww);
  if (valWL) valWL.textContent = String(wl);

  if (sliderWW) {
    if (ww > parseInt(sliderWW.max, 10)) {
      sliderWW.max = String(Math.ceil(ww * 1.5));
    }
    if (document.activeElement !== sliderWW) {
      sliderWW.value = String(ww);
    }
  }

  if (sliderWL) {
    if (wl < parseInt(sliderWL.min, 10)) {
      sliderWL.min = String(Math.floor(wl - 1000));
    }
    if (wl > parseInt(sliderWL.max, 10)) {
      sliderWL.max = String(Math.ceil(wl + 1000));
    }
    if (document.activeElement !== sliderWL) {
      sliderWL.value = String(wl);
    }
  }
}

/**
 * The canvas is the whole point of the app and was an unlabelled black box to
 * assistive tech. Describe what is on it, refreshed whenever the overlay is.
 */
function updateCanvasLabel(): void {
  if (!state.parsed) return;
  const m = state.parsed.metadata;
  const count = itemCount();

  const parts = [
    t("viewer.canvasLabel.imageDicom"),
    m.patientName && t("viewer.canvasLabel.patient", { name: m.patientName }),
    m.modality,
    m.studyDate,
    m.studyDescription,
    count > 1 &&
      t("viewer.canvasLabel.imageOf", {
        current: state.currentIndex + 1,
        total: count,
      }),
    t("viewer.canvasLabel.pixels", { cols: m.columns, rows: m.rows }),
  ].filter(Boolean);

  $("dicom-canvas").setAttribute("aria-label", parts.join(", "));
}

// Re-run every computed-text render on a locale switch: these build their own
// markup/attributes rather than going through data-i18n, so main.ts's global
// applyTranslations() pass doesn't reach them.
onLocaleChange(() => {
  updateMetadataPanel();
  updateSeriesNav();
  updateInfoOverlay();
});
