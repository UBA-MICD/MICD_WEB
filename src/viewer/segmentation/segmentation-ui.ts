// ── Segmentación con IA — cableado de la UI (mock SAM3) ──────────────────────
//
// Dos superficies, a propósito:
//   - GENERAR la segmentación se hace desde Servidor → Validaciones, porque es
//     una acción sobre un estudio a validar y cuesta una inferencia.
//   - MOSTRARLA se hace desde el visor (`tool-show-seg`), que sólo enciende o
//     apaga lo que ya está en memoria y no vuelve a llamar al backend.
//
// El resultado vive en memoria del módulo, sin persistencia: al recargar la
// página no hay nada que mostrar, y el botón lo dice en pantalla.

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
  if (toggle) {
    toggle.disabled = !enabled;
    toggle.checked = checked;
  }
  // El botón del visor y la casilla de capas son dos mandos para lo mismo:
  // se actualizan juntos para que no muestren estados contradictorios.
  const btn = $("tool-show-seg");
  btn?.classList.toggle("active", enabled && checked);
  btn?.setAttribute("aria-pressed", String(enabled && checked));
}

/** true si algún viewport tiene la segmentación encendida. */
function isSegmentationVisible(): boolean {
  const manager = getViewportManager();
  return (manager?.getAllViewports() ?? []).some(
    (vp) => vp.data.segmentation?.visible === true,
  );
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
    // render() y no renderOverlay(): el contorno se dibuja sobre el canvas de
    // la imagen, que se repinta entero en cada render.
    vp.render();
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
      vp.render();
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

/**
 * Muestra la segmentación que ya está en memoria, o avisa si no hay ninguna.
 *
 * Nunca dispara una inferencia: si no hay resultado, el único camino es
 * generarlo desde Validaciones. Con una ya cargada, funciona como interruptor.
 */
export function toggleLastSegmentation(): void {
  if (!lastResult) {
    showBanner(t("viewer.segmentation.none"), "warning");
    syncToggle(false, false);
    return;
  }

  const alreadyShown = getViewportManager()
    ?.getAllViewports()
    .some((vp) => vp.data.segmentation);

  if (!alreadyShown) {
    // Se perdió al cambiar de estudio o de grilla: se vuelve a armar la vista
    // comparativa con el mismo resultado, sin pedir otra inferencia.
    openSegmentationComparison(lastResult);
    setBadgeVisible(lastResult.simulado);
    syncToggle(true, true);
    return;
  }

  const next = !isSegmentationVisible();
  setSegmentationVisible(next);
  syncToggle(true, next);
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initSegmentation(): void {
  // `runSegmentation` (generar) se invoca desde Validaciones; acá sólo se
  // muestra u oculta lo que ya está en memoria.
  $("tool-show-seg")?.addEventListener("click", () => toggleLastSegmentation());

  const toggle = $("chk-segmentation-visible") as HTMLInputElement | null;
  toggle?.addEventListener("change", () => {
    setSegmentationVisible(toggle.checked);
    syncToggle(true, toggle.checked);
  });

  syncToggle(false, false);
  setBadgeVisible(false);
}

/** Sólo para tests: el último resultado calculado. */
export function getLastSegmentation(): SegmentationResult | null {
  return lastResult;
}
