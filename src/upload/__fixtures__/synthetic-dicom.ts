/* cspell:disable */
/**
 * synthetic-dicom.ts — in-memory synthetic DICOM builder for the anonymization
 * integration tests (TK-15 / #73).
 *
 * EVERYTHING HERE IS SYNTHETIC. No real patient data is used or copied. The
 * PII values are obvious fakes ("TEST^SYNTHETIC", "SYN-0001", …) chosen so a
 * test can prove they were removed. This file never reads from disk or the
 * network; the bytes are assembled here so the suite runs in CI with no
 * external corpus (unlike dicom-anonymizer.fixtures.test.ts, which is gated on
 * MICD_PHI_FIXTURES).
 *
 * The output is a real Part-10 file (128-byte preamble + "DICM" + file-meta +
 * dataset, Explicit VR Little Endian) so the production `dicom-parser` parses
 * it and reports the same element offsets the scrubber relies on.
 */

/** Explicit VR Little Endian — the transfer syntax the dataset is encoded in. */
const EXPLICIT_VR_LE = "1.2.840.10008.1.2.1";

/**
 * The fake PII placed in the fixture, keyed by the lowercase tag id
 * `dicom-parser` uses. Tests assert every one of these is gone after
 * anonymization and that none of the values leaks into a log or error.
 */
export const SYNTHETIC_PII: Record<string, { vr: string; value: string }> = {
  x00100010: { vr: "PN", value: "TEST^SYNTHETIC" }, // PatientName
  x00100020: { vr: "LO", value: "SYN-0001" }, // PatientID
  x00100030: { vr: "DA", value: "19750612" }, // PatientBirthDate
  x00100040: { vr: "CS", value: "F" }, // PatientSex
  x00101010: { vr: "AS", value: "045Y" }, // PatientAge
  x00101040: { vr: "LO", value: "Calle Falsa 123" }, // PatientAddress
  x00101000: { vr: "LO", value: "SYN-OLD-42" }, // OtherPatientIDs
  x00080050: { vr: "SH", value: "ACC-SYN-9" }, // AccessionNumber
  x00080080: { vr: "LO", value: "Hospital Sintetico" }, // InstitutionName
  x00080090: { vr: "PN", value: "SYNTH^REFERRING" }, // ReferringPhysicianName
  x00081050: { vr: "PN", value: "SYNTH^PERFORMING" }, // PerformingPhysicianName
  x00081070: { vr: "PN", value: "SYNTH^OPERATOR" }, // OperatorsName
};

/** UIDs that an anonymizer is expected to remap (kept here to assert change). */
export const SYNTHETIC_UIDS: Record<string, string> = {
  x00080018: "1.2.826.0.1.3680043.8.498.1.1", // SOPInstanceUID
  x0020000d: "1.2.826.0.1.3680043.8.498.1.2", // StudyInstanceUID
  x0020000e: "1.2.826.0.1.3680043.8.498.1.3", // SeriesInstanceUID
};

/** A fake private creator + private data element (odd group 0009). */
export const SYNTHETIC_PRIVATE = {
  creatorTag: "x00090010",
  creator: "ACME SYNTHETIC",
  dataTag: "x00091001",
  data: "PRIVATE-SYN-SECRET",
};

/** PII nested one level down, inside OtherPatientIDsSequence (0010,1002). */
export const SYNTHETIC_NESTED = {
  sequenceTag: "x00101002",
  innerTag: "x00100020", // PatientID again, inside the item
  innerValue: "SYN-NESTED-7",
};

// ── Minimal Explicit VR LE encoder ──────────────────────────────────────────

/** VRs that carry a 2-byte reserved field + 4-byte length (PS3.5 Table 7.1-1). */
const LONG_LENGTH_VR = new Set(["OB", "OW", "OF", "SQ", "UT", "UN"]);

function parseTag(tag: string): { group: number; element: number } {
  // "x00100010" -> group 0x0010, element 0x0010
  const hex = tag.replace(/^x/, "").padStart(8, "0");
  return {
    group: parseInt(hex.slice(0, 4), 16),
    element: parseInt(hex.slice(4), 16),
  };
}

/** Pad to even length: UIDs pad with NUL, text with a space (PS3.5 §6.2). */
function padValue(bytes: Uint8Array, vr: string): Uint8Array {
  if (bytes.length % 2 === 0) return bytes;
  const pad = vr === "UI" ? 0x00 : 0x20;
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  out[bytes.length] = pad;
  return out;
}

function u16(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
}
function u32(n: number): Uint8Array {
  return new Uint8Array([
    n & 0xff,
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    (n >> 24) & 0xff,
  ]);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Encode one Explicit VR LE element; `value` already holds the raw bytes. */
function element(tag: string, vr: string, value: Uint8Array): Uint8Array {
  const { group, element: el } = parseTag(tag);
  const padded = padValue(value, vr);
  const head = [u16(group), u16(el), new TextEncoder().encode(vr)];
  if (LONG_LENGTH_VR.has(vr)) {
    head.push(u16(0), u32(padded.length)); // 2 reserved + 4-byte length
  } else {
    head.push(u16(padded.length));
  }
  return concat([...head, padded]);
}

function strElement(tag: string, vr: string, value: string): Uint8Array {
  return element(tag, vr, new TextEncoder().encode(value));
}

/** A single sequence item (FFFE,E000) with an explicit length. */
function item(contents: Uint8Array): Uint8Array {
  return concat([u16(0xfffe), u16(0xe000), u32(contents.length), contents]);
}

export interface SyntheticDicomOptions {
  /** Omit the nested sequence (keeps the fixture minimal when not needed). */
  withoutNested?: boolean;
  /** Omit the private element. */
  withoutPrivate?: boolean;
}

interface BuildValues {
  pii: Record<string, string>;
  uids: Record<string, string>;
  nestedInner: string;
  privateData: string;
}

function build(
  values: BuildValues,
  options: SyntheticDicomOptions,
): ArrayBuffer {
  const dataset: Uint8Array[] = [];

  // Identifying tags, in ascending tag order (DICOM requires it).
  const ordered = Object.keys({ ...SYNTHETIC_PII, ...SYNTHETIC_UIDS }).sort();
  for (const tag of ordered) {
    if (SYNTHETIC_UIDS[tag]) {
      dataset.push(strElement(tag, "UI", values.uids[tag]));
    } else {
      dataset.push(strElement(tag, SYNTHETIC_PII[tag].vr, values.pii[tag]));
    }
  }

  if (!options.withoutNested) {
    const inner = strElement(
      SYNTHETIC_NESTED.innerTag,
      "LO",
      values.nestedInner,
    );
    dataset.push(element(SYNTHETIC_NESTED.sequenceTag, "SQ", item(inner)));
  }

  if (!options.withoutPrivate) {
    dataset.push(
      strElement(SYNTHETIC_PRIVATE.creatorTag, "LO", SYNTHETIC_PRIVATE.creator),
    );
    dataset.push(
      strElement(SYNTHETIC_PRIVATE.dataTag, "LO", values.privateData),
    );
  }

  // A few bytes of "pixel data" — anonymization must not touch these.
  dataset.push(element("x7fe00010", "OW", new Uint8Array([1, 2, 3, 4, 5, 6])));

  // File meta: just the transfer syntax (dicom-parser reads group 0002 until
  // the group changes, so an explicit group-length element is not required).
  const meta = strElement("x00020010", "UI", EXPLICIT_VR_LE);

  const preamble = new Uint8Array(128); // 128 NUL bytes
  const magic = new TextEncoder().encode("DICM");

  // Freshly allocated, so .buffer is a plain ArrayBuffer (not shared).
  return concat([preamble, magic, meta, ...dataset]).buffer as ArrayBuffer;
}

/**
 * Build a synthetic DICOM Part-10 file carrying the fake PII above, a nested
 * sequence, a private element, UIDs and a little pixel data (to prove the
 * scrubber leaves image bytes alone).
 */
export function buildSyntheticDicom(
  options: SyntheticDicomOptions = {},
): ArrayBuffer {
  const pii = Object.fromEntries(
    Object.entries(SYNTHETIC_PII).map(([t, { value }]) => [t, value]),
  );
  return build(
    {
      pii,
      uids: { ...SYNTHETIC_UIDS },
      nestedInner: SYNTHETIC_NESTED.innerValue,
      privateData: SYNTHETIC_PRIVATE.data,
    },
    options,
  );
}

/**
 * The same file as a *correct* anonymizer would return it: identifying tags
 * blanked, UIDs remapped, private data cleared, pixel data intact. Used to
 * stand in for the external module's output in the integration tests.
 */
export function buildAnonymizedSyntheticDicom(
  options: SyntheticDicomOptions = {},
): ArrayBuffer {
  const pii = Object.fromEntries(
    Object.keys(SYNTHETIC_PII).map((t) => [t, ""]),
  );
  const uids = Object.fromEntries(
    Object.entries(SYNTHETIC_UIDS).map(([t, v]) => [t, `${v}.900`]),
  );
  return build({ pii, uids, nestedInner: "", privateData: "" }, options);
}

// ── expectNoPII (reused by the integration tests) ───────────────────────────

export interface PiiViolation {
  tag: string;
  reason: string;
}

/** Trimmed string value of a tag, or "" when absent/blank. */
function tagString(dataSet: any, tag: string): string {
  try {
    const el = dataSet?.elements?.[tag];
    if (!el || typeof el.dataOffset !== "number" || !el.length) return "";
    const bytes = new Uint8Array(
      dataSet.byteArray.buffer,
      dataSet.byteArray.byteOffset + el.dataOffset,
      el.length,
    );
    return new TextDecoder().decode(bytes).replace(/\0+$/, "").trim();
  } catch {
    return "";
  }
}

/**
 * Assert that none of the fixture's identifying values survived
 * anonymization. A tag passes if it is absent, blank, or holds a value
 * *different* from the original — the same rule the backend verifier uses, so
 * a placeholder or a hash counts as removed. UIDs must change when present.
 *
 * `parser` is the real `dicom-parser` module (passed in so this file has no
 * import-time dependency on a browser global). Returns the list of
 * violations; callers assert it is empty.
 */
export function expectNoPII(
  anonymized: ArrayBuffer,
  original: ArrayBuffer,
  parser: { parseDicom: (b: Uint8Array) => any },
): PiiViolation[] {
  const after = parser.parseDicom(new Uint8Array(anonymized));
  const before = parser.parseDicom(new Uint8Array(original));
  const violations: PiiViolation[] = [];

  const piiTags = [
    ...Object.keys(SYNTHETIC_PII),
    SYNTHETIC_NESTED.innerTag,
    SYNTHETIC_PRIVATE.dataTag,
  ];
  for (const tag of piiTags) {
    const now = tagString(after, tag);
    const was = tagString(before, tag);
    if (now !== "" && now === was) {
      violations.push({ tag, reason: "identifying value unchanged" });
    }
  }

  for (const tag of Object.keys(SYNTHETIC_UIDS)) {
    const now = tagString(after, tag);
    const was = tagString(before, tag);
    if (now !== "" && now === was) {
      violations.push({ tag, reason: "UID not remapped" });
    }
  }

  return violations;
}
