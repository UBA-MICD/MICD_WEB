/* cspell:disable */
/**
 * dicom-anonymizer.ts — DICOM PII Scrubbing Utility.
 * Uses dicom-parser element offsets to overwrite sensitive PII tags in-place
 * with padding bytes, preserving DICOM binary layout and image data.
 */

declare const dicomParser: any;

export const PII_TAGS = [
  "x00100010", // PatientName
  "x00100020", // PatientID
  "x00100030", // PatientBirthDate
  "x00100040", // PatientSex
  "x00101000", // OtherPatientIDs
  "x00101001", // OtherPatientNames
  "x00101010", // PatientAge
  "x00101040", // PatientAddress
  "x00102160", // EthnicGroup
  "x00104000", // PatientComments
  "x00080080", // InstitutionName
  "x00080081", // InstitutionAddress
  "x00080090", // ReferringPhysicianName
  "x00080092", // ReferringPhysicianAddress
  "x00080094", // ReferringPhysicianTelephoneNumbers
  "x00081040", // InstitutionalDepartmentName
  "x00081048", // PhysiciansOfRecord
  "x00081050", // PerformingPhysicianName
  "x00081060", // NameOfPhysiciansReadingStudy
  "x00081070", // OperatorsName
];

export interface AnonymizeOptions {
  tagsToScrub?: string[];
  replacementByte?: number; // default 0x20 (ASCII space)
  customParser?: any;
}

/**
 * Anonymizes a DICOM file in-memory by zeroing/padding PII tag values
 * based on element byte offsets identified by dicom-parser.
 *
 * Returns a new ArrayBuffer containing the sanitized DICOM file.
 */
export function anonymizeDicomBuffer(
  buffer: ArrayBuffer,
  options: AnonymizeOptions = {},
): ArrayBuffer {
  const {
    tagsToScrub = PII_TAGS,
    replacementByte = 0x20, // Space character
    customParser,
  } = options;

  const copy = new Uint8Array(buffer.slice(0));
  const parser = customParser ?? getParserInstance();

  if (!parser || typeof parser.parseDicom !== "function") {
    return copy.buffer;
  }

  try {
    const dataSet = parser.parseDicom(copy);
    if (!dataSet || !dataSet.elements) {
      return copy.buffer;
    }

    for (const tag of tagsToScrub) {
      const el = dataSet.elements[tag];
      if (
        el &&
        typeof el.dataOffset === "number" &&
        typeof el.length === "number" &&
        el.length > 0
      ) {
        const start = el.dataOffset;
        const end = start + el.length;
        if (start >= 0 && end <= copy.length) {
          copy.fill(replacementByte, start, end);
        }
      }
    }
  } catch (err) {
    console.warn(
      "DICOM anonymization warning: Failed parsing dataset during scrub.",
      err,
    );
  }

  return copy.buffer;
}

function getParserInstance(): any {
  if (typeof window !== "undefined" && (window as any).dicomParser) {
    return (window as any).dicomParser;
  }
  if (typeof globalThis !== "undefined" && (globalThis as any).dicomParser) {
    return (globalThis as any).dicomParser;
  }
  return null;
}
