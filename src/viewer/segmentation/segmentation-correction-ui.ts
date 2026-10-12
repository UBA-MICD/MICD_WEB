// ── Segmentación IA: comparación + corrección + transferencia (US-45) ────────
//
// La segmentación de la IA NO se pinta sobre la imagen original (podría estar
// mal y "contaminarla"). Se muestra en una VISTA COMPARATIVA 1×2: el panel
// izquierdo es el DICOM original limpio, el derecho es el mismo corte con el
// polígono turquesa "IA" (candidato). El validador lo corrige EN EL PANEL
// DERECHO reusando la herramienta de polígono (arrastrar/insertar/eliminar
// vértices) — sólo tras apretar "Corregir" aparecen los puntos y se puede mover.
// Si lo considera correcto, "Transferir" lo lleva al original (queda como marca
// real, aún con tag "IA") y vuelve a la vista común 1×1. "Enviar" guarda la
// corrección; "Cancelar" revierte al contorno original de la IA. La validación
// del estudio (Aprobar/Rechazar/Marcar) queda intacta al lado.

import { $ } from "../../shared/dom.js";
import { formatDate } from "../../shared/dom.js";
import { t, onLocaleChange } from "../../i18n/i18n.js";
import { showBanner } from "../../shared/banner.js";
import { state } from "../state.js";
import { getViewportManager } from "../viewport-registry.js";
import type { Viewport } from "../viewport-manager.js";
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
  saveToLocalStorage,
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
  acceptSegmentation,
  discardSegmentation,
  getPathologies,
  decodeMaskRle,
} from "./segmentation-api.js";
import { getLastSegmentation } from "./segmentation-ui.js";
import type { SegmentationResult } from "./segmentation-service.js";

/**
 * Estado del candidato IA en pantalla. `status` es reversible: transferir/
 * descartar NO borran nada, sólo cambian de estado, así el validador puede
 * revertir (Revertir transferencia / Restaurar).
 */
type SegStatus = "candidate" | "accepted" | "discarded";

let current: {
  annotationId: string;
  sopInstanceUid: string;
  segmentationId: number | null;
  width: number;
  height: number;
  /** Baseline para "Cancelar": la última versión guardada. */
  originalPoints: Point2D[];
  /** Contorno PRISTINE de la IA para "Descartar corrección" (nunca cambia). */
  aiOriginalPoints: Point2D[];
  status: SegStatus;
} | null = null;
let isEditing = false;

function show(id: string, visible: boolean): void {
  $(id)?.classList.toggle("hidden", !visible);
}

/**
 * Fija el texto de un botón por su clave i18n, dejándolo en el `data-i18n` para
 * que sobreviva a un cambio de idioma (un toggle Transferir⇄Revertir cambia la
 * clave, no sólo el texto). También refleja el estado en `aria-pressed`.
 */
function setButtonLabel(id: string, key: string, pressed?: boolean): void {
  const btn = $(id);
  if (!btn) return;
  btn.dataset.i18n = key;
  btn.textContent = t(key);
  if (pressed !== undefined) btn.setAttribute("aria-pressed", String(pressed));
}

// ── Selector de patología (mismo catálogo que la carga de estudios) ──────────

let pathologyOptionsLoaded = false;

function pathologySelect(): HTMLSelectElement | null {
  return $("seg-pathology") as HTMLSelectElement | null;
}

/** Trae el catálogo una vez y arma las <option>. No-op para invitado o error:
 *  queda sólo "Sin clasificar", así el flujo sigue funcionando (es opcional). */
async function ensurePathologyOptions(): Promise<void> {
  if (pathologyOptionsLoaded) return;
  const sel = pathologySelect();
  if (!sel) return;
  const cats = await getPathologies();
  if (cats.length === 0) return;
  sel.querySelectorAll("option[data-id]").forEach((o) => o.remove());
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = String(c.id);
    opt.dataset.id = String(c.id);
    opt.dataset.key = c.key;
    opt.textContent = t(`classification.${c.key}`);
    sel.appendChild(opt);
  }
  pathologyOptionsLoaded = true;
  if (current) syncPathologySelect();
}

/** Re-traduce las opciones al cambiar de idioma (sin re-fetch). */
function relabelPathologyOptions(): void {
  pathologySelect()
    ?.querySelectorAll<HTMLOptionElement>("option[data-key]")
    .forEach((o) => {
      if (o.dataset.key) o.textContent = t(`classification.${o.dataset.key}`);
    });
}

/** Refleja en el <select> la patología de la anotación IA en pantalla. */
function syncPathologySelect(): void {
  const sel = pathologySelect();
  if (!sel) return;
  const ann = findActiveAnnotation();
  sel.value = ann?.pathologyId != null ? String(ann.pathologyId) : "";
}

/** Al elegir una patología: la guarda en la anotación IA y la muestra en el tag. */
function onPathologyChange(): void {
  const sel = pathologySelect();
  const ann = findActiveAnnotation();
  if (!sel || !ann || !current) return;
  const opt = sel.selectedOptions[0];
  if (sel.value === "") {
    delete ann.pathologyId;
    delete ann.pathologyKey;
  } else {
    ann.pathologyId = Number(sel.value);
    ann.pathologyKey = opt?.dataset.key;
  }
  updateAnnotation(ann);
  saveToLocalStorage(current.sopInstanceUid);
  renderSegViewport();
}

/** Re-renderiza TODOS los viewports (el 1x2 de la predicción muestra la misma
 *  imagen en ambos paneles; el polígono debe verse consistente en los dos).
 *  Usa vp.render() (no el render() global, que sólo pinta el viewport activo). */
function renderSegViewport(): void {
  for (const vp of getViewportManager()?.getAllViewports() ?? []) vp.render();
}

/** Copia el estado del visor (mismo corte) dentro de un viewport de la grilla. */
function fillViewportWithCurrent(vp: Viewport | null): void {
  if (!vp || !state.parsed) return;
  vp.data.source = state.source;
  vp.data.files = state.files;
  vp.data.serverStudyId = state.serverStudyId;
  vp.data.serverInstances = state.serverInstances;
  vp.data.currentIndex = state.currentIndex;
  vp.data.parsed = state.parsed;
  vp.data.viewport = { ...state.viewport };
}

/**
 * Entra en la vista comparativa 1×2: panel izquierdo = original LIMPIO
 * (`suppressAiCandidate`), panel derecho = mismo corte con el candidato IA, y
 * queda ACTIVO el derecho (ahí se corrige). Así la IA no "contamina" el original
 * hasta transferirla. Idempotente: si ya está en 1×2, sólo reafirma los flags.
 */
function enterComparisonView(): void {
  const mgr = getViewportManager();
  if (!mgr || !state.parsed) return;
  mgr.setLayout("1x2");
  const [left, right] = mgr.getAllViewports();
  if (!left || !right) return;
  for (const vp of [left, right]) {
    fillViewportWithCurrent(vp);
    vp.data.suppressAiCandidate = false;
  }
  left.data.suppressAiCandidate = true; // original limpio
  mgr.setActiveViewport(right.id); // se corrige en el panel derecho
  left.fitImage();
  right.fitImage();
  left.render();
  right.render();
}

/**
 * Vuelve a la vista común 1×1 mostrando SÓLO el original. Se usa tras transferir
 * (la marca aceptada ya se ve ahí) o al limpiar/descartar la segmentación.
 */
function restoreSingleView(): void {
  const mgr = getViewportManager();
  if (!mgr) return;
  mgr.setLayout("1x1");
  const vp = mgr.activeViewport;
  if (!vp) return;
  vp.data.suppressAiCandidate = false;
  fillViewportWithCurrent(vp);
  vp.fitImage();
  vp.render();
}

function findActiveAnnotation(): PolygonAnnotation | null {
  if (!current) return null;
  const found = getAnnotationsForSlice(current.sopInstanceUid).find(
    (a) => a.id === current!.annotationId && a.type === "polygon",
  );
  return (found as PolygonAnnotation) ?? null;
}

/**
 * Estado de los botones de segmentación en la barra. Ni "Transferir" ni
 * "Descartar" desaparecen tras usarlos: cambian de etiqueta a su reverso
 * (Revertir transferencia / Restaurar) para que la acción sea reversible.
 */
function refreshButtons(): void {
  const has = current !== null;
  const status = current?.status ?? "candidate";
  const discarded = status === "discarded";
  const accepted = status === "accepted";

  show("seg-ia-chip", has);
  show("seg-correction-attribution", has);
  // Selector de patología: mientras haya candidato y no esté descartado.
  show("seg-pathology", has && !discarded);

  // Corregir / edición: sólo si no está descartada.
  show("btn-seg-correct", has && !discarded);
  show("btn-seg-submit", has && !discarded && isEditing);
  show("btn-seg-cancel", has && !discarded && isEditing);
  show("btn-seg-reset", has && !discarded && isEditing);
  $("btn-seg-correct")?.setAttribute("aria-pressed", String(isEditing));

  // Transferir ⇄ Revertir transferencia (oculto si está descartada).
  show("btn-seg-transfer", has && !discarded);
  setButtonLabel(
    "btn-seg-transfer",
    accepted
      ? "viewer.segmentation.transferRevert"
      : "viewer.segmentation.transfer",
    accepted,
  );

  // Descartar ⇄ Restaurar (siempre visible con candidato: es la salida y su undo).
  show("btn-seg-discard", has);
  setButtonLabel(
    "btn-seg-discard",
    discarded
      ? "viewer.segmentation.discardRestore"
      : "viewer.segmentation.discard",
    discarded,
  );
}

/**
 * Muestra la segmentación de la IA como CANDIDATO en la vista comparativa 1×2:
 * lo cuelga del SOP UID real del corte y entra en la comparación (original
 * limpio a la izquierda, candidato IA a la derecha). No pinta la IA sobre el
 * original hasta que se transfiera.
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
  // Seed the AI candidate read-only: it shows its turquoise contour but no
  // vertex handles and can't be moved until the validator presses "Corregir".
  ann.locked = true;
  addAnnotation(ann);
  const seededPoints = ann.points.map((p) => ({ ...p }));
  current = {
    annotationId: ann.id,
    sopInstanceUid: sopUid,
    segmentationId: result.segmentationId,
    width: result.mascara.width,
    height: result.mascara.height,
    originalPoints: seededPoints,
    aiOriginalPoints: seededPoints.map((p) => ({ ...p })),
    status: "candidate",
  };

  isEditing = false;
  // Vista comparativa: original limpio a la izquierda, candidato IA a la derecha.
  enterComparisonView();
  refreshButtons();
  void ensurePathologyOptions().then(syncPathologySelect);
  syncPathologySelect();
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
    const existingPoints = (existing as PolygonAnnotation).points.map((p) => ({
      ...p,
    }));
    current = {
      annotationId: annId,
      sopInstanceUid: sopUid,
      segmentationId: data.segmentationId,
      width: w,
      height: h,
      originalPoints: existingPoints,
      aiOriginalPoints: existingPoints.map((p) => ({ ...p })),
      status: "candidate",
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
    locked: true,
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
    aiOriginalPoints: points.map((p) => ({ ...p })),
    status: "candidate",
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
  // Una marca ya transferida es una anotación real del estudio y se conserva;
  // un candidato (o descartado) se elimina y se vuelve a la vista común.
  const preserve = current?.status === "accepted";
  if (current && !preserve) deleteAnnotation(current.annotationId);
  current = null;
  isEditing = false;
  refreshButtons();
  if (!preserve) restoreSingleView();
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
  if (!current || current.status === "discarded") return;

  // Defensiva: si el polígono ya no está en el estado, re-mostrarlo.
  if (!findActiveAnnotation() && result) {
    showAiSegmentation(result);
  }
  const editable = findActiveAnnotation();
  if (!editable) return;

  // Unlock so vertices show and can be dragged/moved; only "Corregir" does this.
  editable.locked = false;
  updateAnnotation(editable);
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
    { editedVertices: ann.points.length, pathologyId: ann.pathologyId },
  );
  if (!res.ok) {
    showBanner(res.error, "error");
    return;
  }
  // La corrección guardada pasa a ser el nuevo "original" para futuros cancelar.
  current.originalPoints = ann.points.map((p) => ({ ...p }));
  // Re-lock: back to read-only (contour only) until "Corregir" is pressed again.
  ann.locked = true;
  updateAnnotation(ann);
  setSelectedAnnotationId(null);
  isEditing = false;
  refreshButtons();
  showBanner(t("viewer.segmentation.correctionSaved"), "success");
  void renderAttribution(current.segmentationId);
}

/** Cancelar: descarta los cambios de la sesión y sale de edición. */
function cancelEdit(): void {
  const ann = findActiveAnnotation();
  if (ann && current) {
    ann.points = current.originalPoints.map((p) => ({ ...p }));
    // Re-lock: back to read-only (contour only) until "Corregir" again.
    ann.locked = true;
    updateAnnotation(ann);
  }
  setSelectedAnnotationId(null);
  isEditing = false;
  refreshButtons();
  renderSegViewport();
}

/**
 * Descartar corrección: el validador no está conforme con lo que corrigió y
 * vuelve al contorno PRISTINE que propuso la IA (descartando TODAS las
 * ediciones). Sigue en modo edición para poder volver a ajustar desde cero.
 */
function resetCorrection(): void {
  const ann = findActiveAnnotation();
  const metadata = state.parsed?.metadata;
  if (!ann || !current || !metadata) return;
  const pristine = current.aiOriginalPoints.map((p) => ({ ...p }));
  ann.points = pristine;
  const cal = extractCalibration(metadata);
  ann.area = calculatePolygonArea(ann.points, cal.pixelSpacing);
  ann.perimeter = calculatePolygonPerimeter(ann.points, cal.pixelSpacing, true);
  ann.locked = false;
  current.originalPoints = pristine.map((p) => ({ ...p }));
  updateAnnotation(ann);
  renderSegViewport();
  showBanner(t("viewer.segmentation.resetDone"), "warning");
}

/**
 * Transferir ⇄ Revertir. Como candidato: lleva la segmentación al DICOM original
 * (`accepted`), se ve en la vista común como anotación real (editable, aún tag
 * "IA") y persiste la aceptación (con la corrección vigente si la hubo). Como ya
 * transferida: revierte — vuelve a ser candidato en la comparación 1×2. El botón
 * NO desaparece: alterna a "Revertir transferencia".
 */
async function transferToOriginal(): Promise<void> {
  if (!current) return;
  if (current.status === "accepted") {
    revertTransfer();
    return;
  }
  const ann = findActiveAnnotation();
  if (!ann) return;

  // Persistir contra el backend (si hay candidato persistido y sesión servidor).
  if (current.segmentationId != null && state.source === "server") {
    // Si el contorno se editó respecto al original de la IA, guardar la
    // corrección antes de aceptar, para no perder los cambios sin "Enviar".
    const edited =
      ann.points.length !== current.originalPoints.length ||
      ann.points.some(
        (p, i) =>
          p.x !== current!.originalPoints[i]?.x ||
          p.y !== current!.originalPoints[i]?.y,
      );
    if (edited) {
      await savePolygonCorrection(
        ann,
        current.segmentationId,
        current.width,
        current.height,
        {
          editedVertices: ann.points.length,
          transferred: true,
          pathologyId: ann.pathologyId,
        },
      );
    }
    const res = await acceptSegmentation(current.segmentationId);
    if (!res.ok) {
      showBanner(res.error, "error");
      // No cortamos: seguimos con la transferencia visual local.
    }
  }

  // Promover el candidato a marca real: se ve en el original, editable como el
  // resto, conservando el tag "IA" para trazabilidad.
  ann.accepted = true;
  ann.locked = false;
  ann.hidden = false;
  ann.origin = "ai";
  current.originalPoints = ann.points.map((p) => ({ ...p }));
  current.status = "accepted";
  updateAnnotation(ann);
  saveToLocalStorage(current.sopInstanceUid);

  isEditing = false;
  setSelectedAnnotationId(null);
  refreshButtons();
  // Volver a la vista común 1×1: la marca ya vive sobre el original.
  restoreSingleView();
  showBanner(t("viewer.segmentation.transferred"), "success");
}

/** Revertir transferencia: vuelve a candidato y a la comparación 1×2. */
function revertTransfer(): void {
  const ann = findActiveAnnotation();
  if (!ann || !current) return;
  ann.accepted = false;
  ann.locked = true;
  updateAnnotation(ann);
  current.status = "candidate";
  isEditing = false;
  setSelectedAnnotationId(null);
  refreshButtons();
  enterComparisonView();
}

/**
 * Descartar ⇄ Restaurar. Como candidato: la IA está mal; se OCULTA (no se borra)
 * y se vuelve a la vista común sin tocar el original. Como descartada: la
 * restaura y vuelve a la comparación 1×2. Best-effort contra el backend.
 */
async function discardCandidate(): Promise<void> {
  if (!current) return;
  if (current.status === "discarded") {
    restoreCandidate();
    return;
  }
  const ann = findActiveAnnotation();
  if (current.segmentationId != null && state.source === "server") {
    await discardSegmentation(current.segmentationId); // best-effort
  }
  if (ann) {
    ann.hidden = true;
    ann.locked = true;
    updateAnnotation(ann);
  }
  current.status = "discarded";
  isEditing = false;
  setSelectedAnnotationId(null);
  refreshButtons();
  restoreSingleView(); // vista común limpia (la marca queda oculta, recuperable)
  showBanner(t("viewer.segmentation.discarded"), "warning");
}

/** Restaurar: revierte el descarte y vuelve a la comparación 1×2. */
function restoreCandidate(): void {
  const ann = findActiveAnnotation();
  if (!ann || !current) return;
  ann.hidden = false;
  ann.accepted = false;
  ann.locked = true;
  updateAnnotation(ann);
  current.status = "candidate";
  refreshButtons();
  enterComparisonView();
  showBanner(t("viewer.segmentation.restored"), "success");
}

export function initSegmentationCorrection(): void {
  $("btn-seg-correct")?.addEventListener("click", () => enterEdit());
  $("btn-seg-submit")?.addEventListener("click", () => void submitCorrection());
  $("btn-seg-cancel")?.addEventListener("click", () => cancelEdit());
  $("btn-seg-reset")?.addEventListener("click", () => resetCorrection());
  $("btn-seg-transfer")?.addEventListener(
    "click",
    () => void transferToOriginal(),
  );
  $("btn-seg-discard")?.addEventListener(
    "click",
    () => void discardCandidate(),
  );
  pathologySelect()?.addEventListener("change", () => onPathologyChange());
  onLocaleChange(relabelPathologyOptions);
  refreshButtons();
}
