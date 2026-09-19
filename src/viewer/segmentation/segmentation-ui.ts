// ── Segmentación con IA — cableado de la UI (mock SAM3) ──────────────────────
//
// Botón "Segmentación con IA" → estado de carga → vista comparativa 1x2 con el
// DICOM original a la izquierda y el derivado (con el contorno turquesa) a la
// derecha. El interruptor de visibilidad vive en la herramienta de capas, junto
// al resto de los overlays.

import { $ } from "../../shared/dom.js";
import { t } from "../../i18n/i18n.js";
import { showBanner } from "../../shared/banner.js";
import { state } from "../state.js";
import { getViewportManager } from "../viewport-registry.js";
import type { Viewport } from "../viewport-manager.js";
import {
  segmentarConIA,
  SegmentationError,
  type SegmentationResult,
} from "./segmentation-service.js";
import {
  segmentationAreaMm2,
  type SegmentationLayer,
} from "./segmentation-overlay.js";

/** Evita disparar dos inferencias a la vez desde el mismo botón. */
let inFlight = false;

/** Último resultado, para el interruptor de la herramienta de capas. */
let lastResult: SegmentationResult | null = null;

// ── Estado visual ────────────────────────────────────────────────────────────

function setLoading(loading: boolean): void {
  const status = $("segmentation-status");
  if (status) {
    status.classList.toggle("hidden", !loading);
    status.textContent = loading ? t("viewer.segmentation.running") : "";
  }
}

function setBadgeVisible(visible: boolean): void {
  $("segmentation-badge")?.classList.toggle("hidden", !visible);
}

function syncToggle(enabled: boolean, checked: boolean): void {
  const toggle = $("chk-segmentation-visible") as HTMLInputElement | null;
  if (!toggle) return;
  toggle.disabled = !enabled;
  toggle.checked = checked;
}

// ── Vista comparativa ────────────────────────────────────────────────────────

/**
 * Abre la vista comparativa: izquierda el original intacto, derecha el DICOM
 * derivado con la segmentación dibujada.
 */
export function openSegmentationComparison(result: SegmentationResult): void {
  const manager = getViewportManager();
  if (!manager) return;

  manager.setLayout("1x2");

  const [vp0, vp1] = manager.getAllViewports();
  if (!vp0 || !vp1) return;

  // Panel izquierdo: el original, sin tocar. `state.parsed` sigue apuntando al
  // DICOM de origen — la segmentación nunca lo modifica.
  vp0.data.parsed = state.parsed;
  vp0.data.source = state.source;
  vp0.data.files = state.files;
  vp0.data.serverStudyId = state.serverStudyId;
  vp0.data.serverInstances = state.serverInstances;
  vp0.data.currentIndex = state.currentIndex;
  vp0.data.viewport = state.viewport;
  vp0.data.segmentation = null;

  // Panel derecho: el DICOM derivado, con el mismo encuadre que el original.
  vp1.data.source = vp0.data.source;
  vp1.data.files = vp0.data.files;
  vp1.data.serverStudyId = vp0.data.serverStudyId;
  vp1.data.serverInstances = vp0.data.serverInstances;
  vp1.data.currentIndex = vp0.data.currentIndex;
  vp1.data.parsed = result.dicomDerivado;
  vp1.data.viewport = { ...vp0.data.viewport };
  vp1.data.segmentation = {
    contorno: result.contorno,
    mascara: result.mascara,
    visible: true,
    seed: result.seed,
    simulado: result.simulado,
  } satisfies SegmentationLayer;
  vp1.data.mlLabel = buildLabel(result, vp1);

  // Encuadre compartido: sin sincronizar, comparar píxel a píxel no sirve.
  manager.setSync(true);

  vp0.render();
  vp1.render();
  manager.setActiveViewport(vp1.id);
}

function buildLabel(result: SegmentationResult, vp: Viewport): string {
  const metadata = vp.data.parsed?.metadata;
  const areaMm2 = metadata
    ? segmentationAreaMm2(
        {
          contorno: result.contorno,
          mascara: result.mascara,
          visible: true,
          seed: result.seed,
          simulado: result.simulado,
        },
        metadata,
      )
    : null;
  const area =
    areaMm2 !== null
      ? ` · ${areaMm2 >= 100 ? (areaMm2 / 100).toFixed(2) + " cm²" : areaMm2.toFixed(1) + " mm²"}`
      : ` · ${result.mascara.pixelCount} px`;
  return `${t("viewer.segmentation.hudLabel")}${area}`;
}

/** Quita la segmentación de todos los viewports y apaga los indicadores. */
export function clearSegmentation(): void {
  lastResult = null;
  const manager = getViewportManager();
  for (const vp of manager?.getAllViewports() ?? []) {
    vp.data.segmentation = null;
    if (vp.data.mlLabel?.startsWith(t("viewer.segmentation.hudLabel"))) {
      vp.data.mlLabel = null;
    }
    vp.renderOverlay();
  }
  setBadgeVisible(false);
  syncToggle(false, false);
}

/** Muestra u oculta el overlay sin recalcular la segmentación. */
export function setSegmentationVisible(visible: boolean): void {
  const manager = getViewportManager();
  let touched = false;
  for (const vp of manager?.getAllViewports() ?? []) {
    if (vp.data.segmentation) {
      vp.data.segmentation.visible = visible;
      vp.renderOverlay();
      touched = true;
    }
  }
  if (touched) setBadgeVisible(visible);
}

// ── Acción principal ─────────────────────────────────────────────────────────

/**
 * Ejecuta la segmentación sobre la imagen abierta y abre la vista comparativa.
 * Cada llamada pide una forma nueva (sin semilla fija), así que volver a
 * presionar el botón produce una figura distinta.
 */
export async function runSegmentation(): Promise<void> {
  if (inFlight) return;

  const dicom = state.parsed;
  if (!dicom?.pixelData) {
    showBanner(t("viewer.segmentation.noImage"), "warning");
    return;
  }

  inFlight = true;
  setLoading(true);
  try {
    const result = await segmentarConIA(dicom);
    lastResult = result;
    openSegmentationComparison(result);
    setBadgeVisible(result.simulado);
    syncToggle(true, true);
  } catch (err) {
    const message =
      err instanceof SegmentationError
        ? err.message
        : t("viewer.segmentation.failed");
    showBanner(message, "error");
  } finally {
    inFlight = false;
    setLoading(false);
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initSegmentation(): void {
  // No hay botón en el visor: `runSegmentation` se invoca desde el panel de
  // Validaciones (server-screen.ts). Acá sólo queda el interruptor de la capa.
  const toggle = $("chk-segmentation-visible") as HTMLInputElement | null;
  toggle?.addEventListener("change", () => {
    setSegmentationVisible(toggle.checked);
  });

  syncToggle(false, false);
  setBadgeVisible(false);
}

/** Sólo para tests: el último resultado calculado. */
export function getLastSegmentation(): SegmentationResult | null {
  return lastResult;
}
