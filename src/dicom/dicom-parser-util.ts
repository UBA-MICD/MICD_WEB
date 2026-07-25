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
  };
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

// ── Modality Default Window ───────────────────────────────────────────────────

/**
 * Returns the standard clinical WL/WW defaults for a given modality.
 * Returns { windowCenter: 0, windowWidth: 0 } when no standard default exists,
 * signalling the caller to fall back to pixel-range auto-calculation.
 */
export function getModalityDefaultWindow(
  modality: string,
): { windowCenter: number; windowWidth: number } {
  switch (modality.toUpperCase()) {
    case "CT":
      return { windowCenter: 40, windowWidth: 400 };
    case "MR":
      return { windowCenter: 600, windowWidth: 1200 };
    case "US":
      return { windowCenter: 128, windowWidth: 256 };
    case "CR":
    case "DX":
      return { windowCenter: 2048, windowWidth: 4096 };
    case "PT":
      return { windowCenter: 3000, windowWidth: 6000 };
    case "NM":
      return { windowCenter: 600, windowWidth: 1200 };
    default:
      return { windowCenter: 0, windowWidth: 0 };
  }
}

// ── Auto Window/Level Calculation ────────────────────────────────────────────

export function calculateAutoWindowLevel(
  pixelData: Int16Array | Uint16Array | Uint8Array,
  rescaleSlope: number,
  rescaleIntercept: number,
): { windowCenter: number; windowWidth: number } {
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
