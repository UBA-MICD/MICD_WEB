/**
 * dicom-parser-util.ts — DICOM file parsing and metadata extraction.
 * Uses `dicom-parser` to parse binary DICOM data into structured objects.
 *
 * NOTE: dicom-parser is loaded via a script tag in index.html (UMD bundle)
 * and is available as `window.dicomParser` at runtime.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface DicomMetadata {
  // Patient
  patientName: string;
  patientId: string;
  patientBirthDate: string;
  patientSex: string;

  // Study
  studyDate: string;
  studyDescription: string;
  studyInstanceUid: string;
  accessionNumber: string;
  referringPhysician: string;

  // Series
  seriesDescription: string;
  seriesNumber: string;
  modality: string;

  // Instance
  instanceNumber: string;
  sopClassUid: string;
  sopInstanceUid?: string;

  // Image
  rows: number;
  columns: number;
  bitsAllocated: number;
  bitsStored: number;
  highBit: number;
  pixelRepresentation: number; // 0 = unsigned, 1 = signed
  samplesPerPixel: number;
  photometricInterpretation: string;
  rescaleIntercept: number;
  rescaleSlope: number;

  // Window
  windowCenter: number;
  windowWidth: number;

  // Transfer syntax
  transferSyntaxUid: string;

  // Volumetric / Geometry
  pixelSpacing?: [number, number]; // [rowSpacing, colSpacing] (0028,0030)
  imagePositionPatient?: [number, number, number]; // [x, y, z] (0020,0032)
  imageOrientationPatient?: number[]; // [Rx, Ry, Rz, Cx, Cy, Cz] (0020,0037)
  sliceThickness?: number; // (0028,0050)
  spacingBetweenSlices?: number; // (0018,0088)
}

export interface ParsedDicom {
  metadata: DicomMetadata;
  pixelData: Int16Array | Uint16Array | Uint8Array | null;
  rawDataSet: any;
}

// ── dicom-parser global reference ────────────────────────────────────────────

declare const dicomParser: any;

// ── Parser ───────────────────────────────────────────────────────────────────

export function parseDicomFile(arrayBuffer: ArrayBuffer): ParsedDicom {
  const byteArray = new Uint8Array(arrayBuffer);
  const dataSet = dicomParser.parseDicom(byteArray);

  const metadata = extractMetadata(dataSet);
  const pixelData = extractPixelData(dataSet, metadata);

  return { metadata, pixelData, rawDataSet: dataSet };
}

// ── Metadata Extraction ──────────────────────────────────────────────────────

function safeString(dataSet: any, tag: string): string {
  try {
    return dataSet.string(tag) ?? "";
  } catch {
    return "";
  }
}

function safeUint16(dataSet: any, tag: string, fallback: number = 0): number {
  try {
    const val = dataSet.uint16(tag);
    return val !== undefined ? val : fallback;
  } catch {
    return fallback;
  }
}

function safeFloat(dataSet: any, tag: string, fallback: number = 0): number {
  try {
    const val = dataSet.floatString(tag);
    return val !== undefined ? val : fallback;
  } catch {
    return fallback;
  }
}

function extractMetadata(dataSet: any): DicomMetadata {
  // Parse window center/width — they can be multi-valued (backslash-separated)
  let windowCenter = 0;
  let windowWidth = 0;
  const wcStr = safeString(dataSet, "x00281050");
  const wwStr = safeString(dataSet, "x00281051");
  if (wcStr) {
    const parts = wcStr.split("\\");
    windowCenter = parseFloat(parts[0]) || 0;
  }
  if (wwStr) {
    const parts = wwStr.split("\\");
    windowWidth = parseFloat(parts[0]) || 0;
  }

  // Parse PixelSpacing (0028,0030)
  const psStr = safeString(dataSet, "x00280030");
  let pixelSpacing: [number, number] | undefined = undefined;
  if (psStr) {
    const parts = psStr.split("\\").map((p) => parseFloat(p.trim()));
    if (parts.length >= 2 && !parts.some((n) => isNaN(n))) {
      pixelSpacing = [parts[0], parts[1]];
    }
  }

  // Parse ImagePositionPatient (0020,0032)
  const ippStr = safeString(dataSet, "x00200032");
  let imagePositionPatient: [number, number, number] | undefined = undefined;
  if (ippStr) {
    const parts = ippStr.split("\\").map((p) => parseFloat(p.trim()));
    if (parts.length >= 3 && !parts.some((n) => isNaN(n))) {
      imagePositionPatient = [parts[0], parts[1], parts[2]];
    }
  }

  // Parse ImageOrientationPatient (0020,0037)
  const iopStr = safeString(dataSet, "x00200037");
  let imageOrientationPatient: number[] | undefined = undefined;
  if (iopStr) {
    const parts = iopStr.split("\\").map((p) => parseFloat(p.trim()));
    if (parts.length >= 6 && !parts.some((n) => isNaN(n))) {
      imageOrientationPatient = parts;
    }
  }

  return {
    // Patient
    patientName: formatPatientName(safeString(dataSet, "x00100010")),
    patientId: safeString(dataSet, "x00100020"),
    patientBirthDate: formatDicomDate(safeString(dataSet, "x00100030")),
    patientSex: safeString(dataSet, "x00100040"),

    // Study
    studyDate: formatDicomDate(safeString(dataSet, "x00080020")),
    studyDescription: safeString(dataSet, "x00081030"),
    studyInstanceUid: safeString(dataSet, "x0020000d"),
    accessionNumber: safeString(dataSet, "x00080050"),
    referringPhysician: formatPatientName(safeString(dataSet, "x00080090")),

    // Series
    seriesDescription: safeString(dataSet, "x0008103e"),
    seriesNumber: safeString(dataSet, "x00200011"),
    modality: safeString(dataSet, "x00080060"),

    // Instance
    instanceNumber: safeString(dataSet, "x00200013"),
    sopClassUid: safeString(dataSet, "x00080016"),
    sopInstanceUid: safeString(dataSet, "x00080018") || undefined,

    // Image
    rows: safeUint16(dataSet, "x00280010"),
    columns: safeUint16(dataSet, "x00280011"),
    bitsAllocated: safeUint16(dataSet, "x00280100"),
    bitsStored: safeUint16(dataSet, "x00280101"),
    highBit: safeUint16(dataSet, "x00280102"),
    pixelRepresentation: safeUint16(dataSet, "x00280103"),
    samplesPerPixel: safeUint16(dataSet, "x00280002", 1),
    photometricInterpretation: safeString(dataSet, "x00280004"),
    rescaleIntercept: safeFloat(dataSet, "x00281052", 0),
    rescaleSlope: safeFloat(dataSet, "x00281053", 1),

    // Window
    windowCenter,
    windowWidth,

    // Transfer
    transferSyntaxUid: safeString(dataSet, "x00020010"),

    // Volumetric / Geometry
    pixelSpacing,
    imagePositionPatient,
    imageOrientationPatient,
    sliceThickness: safeFloat(dataSet, "x00280050", 0) || undefined,
    spacingBetweenSlices: safeFloat(dataSet, "x00180088", 0) || undefined,
  };
}

// ── Volumetric Tags Validation ───────────────────────────────────────────────

export interface VolumetricValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateVolumetricTags(
  metadataList: DicomMetadata[],
): VolumetricValidationResult {
  if (!metadataList || metadataList.length <= 1) {
    return {
      valid: false,
      reason:
        "Study is not compatible with MPR: requires a series with more than 1 slice.",
    };
  }

  for (let i = 0; i < metadataList.length; i++) {
    const meta = metadataList[i];
    if (
      !meta.pixelSpacing ||
      meta.pixelSpacing.length < 2 ||
      meta.pixelSpacing[0] <= 0 ||
      meta.pixelSpacing[1] <= 0
    ) {
      return {
        valid: false,
        reason: `Study is not compatible with MPR: missing PixelSpacing tag (0028,0030) or invalid in slice ${i + 1}.`,
      };
    }
    if (!meta.imagePositionPatient || meta.imagePositionPatient.length < 3) {
      return {
        valid: false,
        reason: `Study is not compatible with MPR: missing ImagePositionPatient tag (0020,0032) in slice ${i + 1}.`,
      };
    }
  }

  return { valid: true };
}

// ── Pixel Data Extraction ────────────────────────────────────────────────────

function extractPixelData(
  dataSet: any,
  metadata: DicomMetadata,
): Int16Array | Uint16Array | Uint8Array | null {
  const pixelDataElement = dataSet.elements.x7fe00010;
  if (!pixelDataElement) return null;

  const offset = pixelDataElement.dataOffset;
  const length = pixelDataElement.length;

  if (length <= 0 || length === 0xffffffff) {
    // Encapsulated / compressed pixel data — not supported in this simple viewer
    return null;
  }

  const { bitsAllocated, pixelRepresentation } = metadata;

  if (bitsAllocated === 8) {
    return new Uint8Array(dataSet.byteArray.buffer, offset, length);
  } else if (bitsAllocated === 16) {
    const numPixels = length / 2;
    if (pixelRepresentation === 1) {
      // Signed
      return new Int16Array(dataSet.byteArray.buffer, offset, numPixels);
    } else {
      // Unsigned
      return new Uint16Array(dataSet.byteArray.buffer, offset, numPixels);
    }
  }

  // Fallback
  return new Uint8Array(dataSet.byteArray.buffer, offset, length);
}

// ── Formatting Helpers ───────────────────────────────────────────────────────

function formatPatientName(name: string): string {
  if (!name) return "";
  // DICOM patient names use ^ as separator: Last^First^Middle^Prefix^Suffix
  return name.replace(/\^/g, ", ").replace(/,\s*$/, "");
}

function formatDicomDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return dateStr;
  // DICOM date format: YYYYMMDD → YYYY-MM-DD
  return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
}

// ── Window Presets ───────────────────────────────────────────────────────────

export interface WindowPreset {
  name: string;
  windowCenter: number;
  windowWidth: number;
}

// cspell:disable
export const WINDOW_PRESETS: Record<string, WindowPreset> = {
  lung: { name: "Pulmón", windowCenter: -600, windowWidth: 1500 },
  bone: { name: "Hueso", windowCenter: 400, windowWidth: 1800 },
  softTissue: { name: "Tejido Blando", windowCenter: 40, windowWidth: 400 },
  brain: { name: "Cerebro", windowCenter: 40, windowWidth: 80 },
};
// cspell:enable

// ── Auto Window/Level Calculation ────────────────────────────────────────────

export function calculateAutoWindowLevel(
  pixelData: Int16Array | Uint16Array | Uint8Array,
  rescaleSlope: number,
  rescaleIntercept: number,
  modality?: string,
): { windowCenter: number; windowWidth: number } {
  if (modality && modality.trim().toUpperCase() === "CT") {
    return {
      windowCenter: WINDOW_PRESETS.softTissue.windowCenter,
      windowWidth: WINDOW_PRESETS.softTissue.windowWidth,
    };
  }

  let min = Infinity;
  let max = -Infinity;

  // Sample pixels for performance (every 4th pixel for large images)
  const step = pixelData.length > 100000 ? 4 : 1;
  for (let i = 0; i < pixelData.length; i += step) {
    const val = pixelData[i] * rescaleSlope + rescaleIntercept;
    if (val < min) min = val;
    if (val > max) max = val;
  }

  return {
    windowCenter: (min + max) / 2,
    windowWidth: max - min,
  };
}
