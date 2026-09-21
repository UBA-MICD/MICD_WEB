// ── Segmentación con IA — orquestación (mock SAM3) ───────────────────────────
//
// Un único punto de entrada, `segmentarConIA`, que la UI llama sin saber si el
// resultado viene de un modelo o del generador simulado del backend. El día
// que SAM3 esté disponible sólo cambia el endpoint en segmentation-api.ts.

import type {
  ParsedDicom,
  DicomMetadata,
} from "../../dicom/dicom-parser-util.js";
import {
  requestSegmentation,
  decodeMaskRle,
  type Point2D,
  type SegmentationMask,
} from "./segmentation-api.js";

export type { Point2D, SegmentationMask } from "./segmentation-api.js";

/**
 * DICOM derivado: mismos píxeles y metadatos que el original, con UIDs nuevos
 * y la referencia a la imagen de origen.
 *
 * Es un objeto en memoria compatible con ParsedDicom, no un archivo Part-10:
 * `dicom-parser` sólo lee, el proyecto no tiene codificador DICOM, y el visor
 * trabaja siempre sobre ParsedDicom. Persistirlo en el PACS exigiría escribir
 * el archivo en el backend — fuera del alcance del mock.
 */
export interface DerivedDicom extends ParsedDicom {
  /** SOPInstanceUID de la imagen de origen. */
  referencedSopInstanceUid: string | null;
}

export interface SegmentationResult {
  mascara: SegmentationMask;
  contorno: Point2D[];
  dicomDerivado: DerivedDicom;
  /** Semilla usada; permite reproducir exactamente la misma forma. */
  seed: number;
  /** Identificador del modelo. `mock-sam3` ⇒ la UI muestra el badge Simulado. */
  model: string;
  simulado: boolean;
  /** Milisegundos que tardó la inferencia (simulada). */
  inferenceMs: number;
}

export interface SegmentarOptions {
  /** Semilla explícita. Sin ella, cada llamada devuelve una forma distinta. */
  seed?: number;
}

export class SegmentationError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SegmentationError";
  }
}

/**
 * Construye el DICOM derivado a partir del original.
 * El original no se toca: se clonan los metadatos y se comparte (sin copiar)
 * el buffer de píxeles, que es de sólo lectura para el renderer.
 */
export function buildDerivedDicom(
  original: ParsedDicom,
  derived: {
    sopInstanceUid: string;
    seriesInstanceUid: string;
    seriesDescription: string;
    referencedSopInstanceUid: string | null;
    referencedSopClassUid: string | null;
    derivationDescription: string;
  },
): DerivedDicom {
  const metadata: DicomMetadata = {
    ...original.metadata,
    sopInstanceUid: derived.sopInstanceUid,
    seriesInstanceUid: derived.seriesInstanceUid,
    seriesDescription: derived.seriesDescription,
    derivationDescription: derived.derivationDescription,
    referencedImageSequence: derived.referencedSopInstanceUid
      ? [
          {
            referencedSopClassUid:
              derived.referencedSopClassUid || original.metadata.sopClassUid,
            referencedSopInstanceUid: derived.referencedSopInstanceUid,
          },
        ]
      : undefined,
  };

  return {
    metadata,
    pixelData: original.pixelData,
    rawDataSet: original.rawDataSet,
    referencedSopInstanceUid: derived.referencedSopInstanceUid,
  };
}

/**
 * Segmenta una imagen DICOM.
 *
 * El estado de carga (1,5-2,5 s) lo produce el backend, que simula la latencia
 * de una inferencia real; la UI sólo tiene que mostrar el spinner mientras la
 * promesa esté pendiente.
 *
 * @throws SegmentationError si el backend responde con error o no es alcanzable.
 */
export async function segmentarConIA(
  dicom: ParsedDicom,
  options: SegmentarOptions = {},
): Promise<SegmentationResult> {
  const { rows, columns } = dicom.metadata;
  if (!rows || !columns) {
    throw new SegmentationError("La imagen no tiene dimensiones válidas.", 0);
  }

  // MOCK: reemplazar por llamada a SAM3 ──────────────────────────────────────
  // Hoy `/api/v1/ml/segmentation` devuelve una forma generada con ruido de
  // baja frecuencia (ver backend/src/modules/segmentation/). Cuando exista el
  // modelo, ese endpoint pasa a invocar SAM3 y este archivo no cambia: mismo
  // contrato de request y de response.
  const result = await requestSegmentation({
    rows,
    columns,
    seed: options.seed,
    sopInstanceUid: dicom.metadata.sopInstanceUid,
    sopClassUid: dicom.metadata.sopClassUid,
    studyInstanceUid: dicom.metadata.studyInstanceUid,
  });
  // ───────────────────────────────────────────────────────────────────────────

  if (!result.ok) {
    throw new SegmentationError(result.error, result.status);
  }

  const { data } = result;
  const mascara: SegmentationMask = {
    width: data.mask.width,
    height: data.mask.height,
    data: decodeMaskRle(data.mask.rle, data.mask.width, data.mask.height),
    pixelCount: data.mask.pixelCount,
  };

  return {
    mascara,
    contorno: data.contour,
    dicomDerivado: buildDerivedDicom(dicom, data.derived),
    seed: data.seed,
    model: data.model,
    simulado: data.simulated !== false,
    inferenceMs: data.inferenceMs,
  };
}
