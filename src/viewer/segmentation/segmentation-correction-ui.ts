// ── Segmentación IA: sembrado + corrección (US-45) ───────────────────────────
//
// La segmentación de la IA se muestra COMO UN POLÍGONO turquesa (tag "IA"),
// sembrado apenas llega el resultado. El validador la corrige EN SU LUGAR
// reusando la herramienta de polígono (arrastrar/insertar/eliminar vértices).
// La barra inferior mantiene "Corregir" siempre visible; en edición aparecen
// "Enviar" (guarda) y "Cancelar" (revierte al contorno original de la IA). La
// validación del estudio (Aprobar/Rechazar/Marcar) queda intacta al lado.

import { $ } from "../../shared/dom.js";
import { formatDate } from "../../shared/dom.js";
import { t } from "../../i18n/i18n.js";
import { showBanner } from "../../shared/banner.js";
import { state } from "../state.js";
import { getViewportManager } from "../viewport-registry.js";
import {
  extractCalibration,
  calculatePolygonArea,
  calculatePolygonPerimeter,
} from "../measurements/measurement-math.js";
import { setSelectedAnnotationId } from "../measurements/measurement-overlay.js";
import {
  addAnnotation,
  getAnnotationsForSlice,
  updateAnnotation,
  deleteAnnotation,
} from "../measurements/annotation-state.js";
import type { PolygonAnnotation, Point2D } from "../measurements/types.js";
import {
  contourToPolygonAnnotation,
  savePolygonCorrection,
} from "./segmentation-correction.js";
import { maskToPolygon } from "./mask-to-polygon.js";
import {
  getSegmentationHistory,
  getSegmentationForInstance,
  decodeMaskRle,
} from "./segmentation-api.js";
import { getLastSegmentation } from "./segmentation-ui.js";
import type { SegmentationResult } from "./segmentation-service.js";

// El candidato IA actualmente en pantalla.
let current: {
  annotationId: string;
  sopInstanceUid: string;
  segmentationId: number | null;
  width: number;
  height: number;
  /** Contorno original de la IA, para "Cancelar" (revertir). */
  originalPoints: Point2D[];
} | null = null;
let isEditing = false;

function show(id: string, visible: boolean): void {
  $(id)?.classList.toggle("hidden", !visible);
}

/** Re-renderiza TODOS los viewports (el 1x2 de la predicción muestra la misma
 *  imagen en ambos paneles; el polígono debe verse consistente en los dos).
 *  Usa vp.render() (no el render() global, que sólo pinta el viewport activo). */
function renderSegViewport(): void {
  for (const vp of getViewportManager()?.getAllViewports() ?? []) vp.render();
}

function findActiveAnnotation(): PolygonAnnotation | null {
  if (!current) return null;
  const found = getAnnotationsForSlice(current.sopInstanceUid).find(
    (a) => a.id === current!.annotationId && a.type === "polygon",
  );
  return (found as PolygonAnnotation) ?? null;
}

/** Estado de los botones de segmentación en la barra. */
function refreshButtons(): void {
  const has = current !== null;
  show("seg-ia-chip", has);
  show("seg-correction-attribution", has);
  show("btn-seg-correct", has); // "Corregir" nunca desaparece mientras haya seg
  show("btn-seg-submit", has && isEditing);
  show("btn-seg-cancel", has && isEditing);
  $("btn-seg-correct")?.setAttribute("aria-pressed", String(isEditing));
}

/**
 * Muestra la segmentación de la IA como polígono turquesa/"IA" editable SOBRE LA
 * IMAGEN REAL del visor (no un DICOM derivado). Traza el polígono desde la
 * máscara y lo cuelga del SOP UID real del corte actual, así el render global
 * (que escribe `state.parsed` en el viewport activo) ya no lo pisa.
 */
export function showAiSegmentation(result: SegmentationResult): void {
  const metadata = state.parsed?.metadata;
  if (!metadata) return;
  const sopUid = metadata.sopInstanceUid ?? `slice_${state.currentIndex}`;

  // Sacar una seg previa (otra corrida) para no acumular polígonos.
  if (current) deleteAnnotation(current.annotationId);

  const calibration = extractCalibration(metadata);
  const ann = contourToPolygonAnnotation(
    result,
    sopUid,
    calibration,
    state.currentIndex,
  );
  addAnnotation(ann);
  current = {
    annotationId: ann.id,
    sopInstanceUid: sopUid,
    segmentationId: result.segmentationId,
    width: result.mascara.width,
    height: result.mascara.height,
    originalPoints: ann.points.map((p) => ({ ...p })),
  };

  isEditing = false;
  refreshButtons();
  renderSegViewport();
  const attr = $("seg-correction-attribution");
  if (attr) attr.textContent = t("viewer.segmentation.bySystem");
}

/**
 * Recarga la segmentación persistida de la imagen actual (bug 3). Se llama al
 * abrir un estudio y al cambiar de corte: trae del backend la seg de (estudio,
 * instancia) y redibuja el polígono — la corrección más nueva si existe, si no
 * la original — atado al SOP UID REAL de la instancia (no al derivado efímero),
 * así sobrevive a los cambios de corte/layout y a recargar la página.
 *
 * Idempotente y defensivo: usa un id estable por segmentación, no re-agrega si
 * ya está, y limpia una seg vieja cuando la instancia cambió.
 */
export async function reloadSegmentationForInstance(): Promise<void> {
  const md = state.parsed?.metadata;
  if (state.source !== "server" || !md?.sopInstanceUid) return;
  const sopUid = md.sopInstanceUid;

  const res = await getSegmentationForInstance(
    md.studyInstanceUid ?? "",
    sopUid,
  );
  if (!res.ok) return;

  // Sin seg para este corte: si había una de otra instancia, sacala.
  if (!res.data) {
    if (current && current.sopInstanceUid !== sopUid) onSegmentationCleared();
    return;
  }

  const data = res.data;
  const rle = data.correctedRle ?? data.maskRle;
  const shape = data.correctedMaskShape ?? data.maskShape; // [h, w]
  if (!rle || !shape) return;
  const [h, w] = shape;

  const annId = `seg_ai_${data.segmentationId}`;
  // Ya sembrada para esta instancia: nada que hacer.
  const existing = getAnnotationsForSlice(sopUid).find((a) => a.id === annId);
  if (existing) {
    current = {
      annotationId: annId,
      sopInstanceUid: sopUid,
      segmentationId: data.segmentationId,
      width: w,
      height: h,
      originalPoints: (existing as PolygonAnnotation).points.map((p) => ({
        ...p,
      })),
    };
    isEditing = false;
    refreshButtons();
    return;
  }

  const points = maskToPolygon(decodeMaskRle(rle, w, h), w, h);
  if (points.length < 3) return;

  // Sacar cualquier seg previa de otra instancia/segmentación.
  if (current && current.annotationId !== annId) {
    deleteAnnotation(current.annotationId);
  }

  const calibration = extractCalibration(md);
  const ann: PolygonAnnotation = {
    id: annId,
    type: "polygon",
    sopInstanceUid: sopUid,
    sliceIndex: state.currentIndex,
    isClosed: true,
    isCalibrated: calibration.isCalibrated,
    unit: calibration.isCalibrated ? "mm²" : "px²",
    points,
    area: calculatePolygonArea(points, calibration.pixelSpacing),
    perimeter: calculatePolygonPerimeter(
      points,
      calibration.pixelSpacing,
      true,
    ),
    origin: "ai",
    createdAt: Date.now(),
  };
  addAnnotation(ann);
  current = {
    annotationId: annId,
    sopInstanceUid: sopUid,
    segmentationId: data.segmentationId,
    width: w,
    height: h,
    originalPoints: points.map((p) => ({ ...p })),
  };
  isEditing = false;
  refreshButtons();
  renderSegViewport();
  const attr = $("seg-correction-attribution");
  if (attr) {
    attr.textContent = data.correctedBy
      ? t("viewer.segmentation.byPerson", {
          who: data.correctedBy,
          when: data.correctedAt ? formatDate(data.correctedAt) : "",
        })
      : t("viewer.segmentation.bySystem");
  }
}

/** Se llama al limpiar la segmentación: quita el polígono y los controles. */
export function onSegmentationCleared(): void {
  if (current) deleteAnnotation(current.annotationId);
  current = null;
  isEditing = false;
  refreshButtons();
}

/** Atribución: "Segmentado por IA" o "Corregido por {{who}} · {{when}}". */
async function renderAttribution(segmentationId: number | null): Promise<void> {
  const el = $("seg-correction-attribution");
  if (!el) return;
  let text = t("viewer.segmentation.bySystem");
  if (segmentationId != null) {
    const res = await getSegmentationHistory(segmentationId);
    if (res.ok && res.data.corrections?.length) {
      const last = res.data.corrections[0];
      text = t("viewer.segmentation.byPerson", {
        who: last.correctedBy,
        when: formatDate(last.correctedAt),
      });
    }
  }
  el.textContent = text;
}

/**
 * Corregir: entra (o sigue) en modo edición. Selecciona el polígono IA y activa
 * la herramienta de polígono. Es idempotente y re-muestra el polígono si se
 * hubiera perdido, así el botón se puede volver a apretar sin que desaparezca.
 */
function enterEdit(): void {
  const result = getLastSegmentation();
  if (!current && result) showAiSegmentation(result);
  if (!current) return;

  // Defensiva: si el polígono ya no está en el estado, re-mostrarlo.
  if (!findActiveAnnotation() && result) {
    showAiSegmentation(result);
  }
  if (!findActiveAnnotation()) return;

  setSelectedAnnotationId(current.annotationId);
  state.activeTool = "polygon";
  isEditing = true;
  refreshButtons();
  renderSegViewport();
  showBanner(t("viewer.segmentation.correctHint"), "warning");
}

/** Enviar: guarda el polígono editado como corrección del candidato. */
async function submitCorrection(): Promise<void> {
  const ann = findActiveAnnotation();
  if (!ann || !current) return;
  const res = await savePolygonCorrection(
    ann,
    current.segmentationId,
    current.width,
    current.height,
    { editedVertices: ann.points.length },
  );
  if (!res.ok) {
    showBanner(res.error, "error");
    return;
  }
  // La corrección guardada pasa a ser el nuevo "original" para futuros cancelar.
  current.originalPoints = ann.points.map((p) => ({ ...p }));
  isEditing = false;
  refreshButtons();
  showBanner(t("viewer.segmentation.correctionSaved"), "success");
  void renderAttribution(current.segmentationId);
}

/** Cancelar: descarta los cambios y vuelve al contorno original de la IA. */
function cancelEdit(): void {
  const ann = findActiveAnnotation();
  if (ann && current) {
    ann.points = current.originalPoints.map((p) => ({ ...p }));
    updateAnnotation(ann);
  }
  setSelectedAnnotationId(null);
  isEditing = false;
  refreshButtons();
  renderSegViewport();
}

export function initSegmentationCorrection(): void {
  $("btn-seg-correct")?.addEventListener("click", () => enterEdit());
  $("btn-seg-submit")?.addEventListener("click", () => void submitCorrection());
  $("btn-seg-cancel")?.addEventListener("click", () => cancelEdit());
  refreshButtons();
}
