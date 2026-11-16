// ── Segmentación con IA — cableado de la UI (mock SAM3) ──────────────────────
//
// GENERAR la segmentación se hace desde Servidor → Validaciones. El resultado se
// muestra COMO UN POLÍGONO turquesa sobre la IMAGEN REAL del visor (no un DICOM
// derivado en una comparación 1×2): así el render global no lo pisa, persiste al
// corregir y sobrevive a los cambios de herramienta. La edición la maneja
// segmentation-correction-ui.ts.

import { $ } from "../../shared/dom.js";
import { t } from "../../i18n/i18n.js";
import { showBanner } from "../../shared/banner.js";
import { showLoading } from "../../shared/dom.js";
import { state } from "../state.js";
import {
  segmentarConIA,
  SegmentationError,
  type SegmentationResult,
} from "./segmentation-service.js";

/** Evita disparar dos inferencias a la vez desde el mismo botón. */
let inFlight = false;

/** Último resultado, en memoria. */
let lastResult: SegmentationResult | null = null;

/**
 * Loader "cargando segmentación IA…" reusando el spinner del visor, para que el
 * usuario entienda que hay una inferencia en curso (el mock tarda 1,5-2,5 s).
 */
function setSegLoading(on: boolean): void {
  const el = $("loading-indicator");
  if (!el) return; // sin indicador en el DOM (p. ej. tests): no-op
  const span = el.querySelector("span");
  if (span) {
    span.textContent = on
      ? t("viewer.segmentation.loading") || "Cargando segmentación IA…"
      : t("viewer.loading") || "Cargando DICOM…";
  }
  showLoading(on);
}

// ── Acción principal ─────────────────────────────────────────────────────────

/**
 * Ejecuta la segmentación sobre la imagen abierta y la dibuja como polígono
 * editable sobre esa misma imagen. Cada llamada pide una forma nueva.
 */
export async function runSegmentation(): Promise<void> {
  if (inFlight) return;

  const dicom = state.parsed;
  if (!dicom?.pixelData) {
    showBanner(t("viewer.segmentation.noImage"), "warning");
    return;
  }

  // La segmentación con IA corre sobre el DICOM almacenado en el servidor (se
  // busca por SOPInstanceUID). Una imagen abierta desde el disco local no tiene
  // forma de ubicarse en el servidor, así que el backend responde 422: avisamos
  // acá en vez de disparar un pedido condenado al error.
  if (!dicom.metadata.sopInstanceUid) {
    showBanner(t("viewer.segmentation.noServerImage"), "warning");
    return;
  }

  inFlight = true;
  setSegLoading(true);
  try {
    const result = await segmentarConIA(dicom);
    lastResult = result;
    await import("./segmentation-correction-ui.js").then((m) =>
      m.showAiSegmentation(result),
    );
  } catch (err) {
    const message =
      err instanceof SegmentationError
        ? err.message
        : t("viewer.segmentation.failed");
    showBanner(message, "error");
  } finally {
    inFlight = false;
    setSegLoading(false);
  }
}

/** Quita la segmentación (polígono + controles). */
export function clearSegmentation(): void {
  lastResult = null;
  void import("./segmentation-correction-ui.js").then((m) =>
    m.onSegmentationCleared(),
  );
}

export function initSegmentation(): void {
  // Nada que cablear: la segmentación se genera desde Validaciones y se muestra
  // como polígono sobre la imagen real.
}

/** Sólo para tests / correction-ui: el último resultado calculado. */
export function getLastSegmentation(): SegmentationResult | null {
  return lastResult;
}
