/**
 * study-builder.ts — Unified study ingest, series grouping & 3D spatial sorting engine.
 *
 * Implements the unified hopper for US-49:
 *  - Accepts raw DICOM files/buffers regardless of input source (Folder, ZIP, File, Server).
 *  - Parses metadata via dicom-parser-util.
 *  - Groups slices by SeriesInstanceUID.
 *  - Applies strict hierarchical sorting:
 *      1. Primary: Projected 3D spatial distance (dist = IPP · N)
 *      2. Secondary: Instance Number (0020,0013)
 *      3. Tertiary: Alphanumeric filename ordering
 *  - Computes series-level geometry, plane normal, and dynamic anatomical orientation labels.
 */

import { parseDicomFile, type ParsedDicom } from "./dicom-parser-util.js";
import {
  calculateSpatialDistance,
  computePlaneNormal,
  getOrientationLabels,
  getCanonicalFlip,
  type OrientationLabels,
  type CanonicalFlip,
  type Vector3D,
} from "./spatial-math.js";

/** Input item representation for raw DICOM sources. */
export type StudyRawInput =
  | File
  | { name: string; buffer: ArrayBuffer }
  | { name: string; data: Uint8Array };

export interface BuiltSlice {
  index: number;
  name: string;
  buffer: ArrayBuffer;
  parsed: ParsedDicom;
  projectedDistance: number | null;
  instanceNumber: number | null;
  file?: File;
}

export interface BuiltSeries {
  seriesInstanceUid: string;
  seriesDescription: string;
  seriesNumber: string;
  modality: string;
  slices: BuiltSlice[];
  planeNormal: Vector3D | null;
  orientationLabels: OrientationLabels | null;
  canonicalFlip: CanonicalFlip | null;
  spacingBetweenSlices: number | null;
}

export interface BuiltStudy {
  studyInstanceUid: string;
  studyDate: string;
  studyDescription: string;
  patientName: string;
  patientId: string;
  series: BuiltSeries[];
  primarySeries: BuiltSeries | null;
  totalSlices: number;
}

export type ParseDicomFn = (buffer: ArrayBuffer) => ParsedDicom;

/** Options for StudyBuilder instance or execution. */
export interface StudyBuilderOptions {
  /** Optional custom parser function (defaults to parseDicomFile). */
  parseFn?: ParseDicomFn;
}

/**
 * Extracts the ArrayBuffer, filename and optional File from a StudyRawInput item.
 */
async function extractBufferAndName(
  input: StudyRawInput,
): Promise<{ name: string; buffer: ArrayBuffer; file?: File }> {
  if (typeof File !== "undefined" && input instanceof File) {
    const buffer = await input.arrayBuffer();
    return { name: input.name, buffer, file: input };
  }
  if ("arrayBuffer" in input && typeof input.arrayBuffer === "function") {
    const buffer = await input.arrayBuffer();
    const file =
      "size" in input && "name" in input ? (input as File) : undefined;
    return { name: input.name, buffer, file };
  }
  if ("buffer" in input && input.buffer instanceof ArrayBuffer) {
    return { name: input.name, buffer: input.buffer };
  }
  if ("data" in input && input.data instanceof Uint8Array) {
    const uint8 = input.data;
    const copy = new ArrayBuffer(uint8.byteLength);
    new Uint8Array(copy).set(uint8);
    return { name: input.name, buffer: copy };
  }
  throw new Error(`Unsupported raw study input: ${String(input)}`);
}

/**
 * Sorts slice entries according to strict hierarchical spatial criteria:
 *  1. Primary: projectedDistance (IPP · N)
 *  2. Secondary: instanceNumber
 *  3. Tertiary: natural alphanumeric filename
 */
export function sortSlices<
  T extends {
    name: string;
    projectedDistance: number | null;
    instanceNumber: number | null;
  },
>(slices: T[]): T[] {
  return slices.sort((a, b) => {
    // 1. Primary: projectedDistance
    if (a.projectedDistance !== null && b.projectedDistance !== null) {
      const diff = a.projectedDistance - b.projectedDistance;
      if (Math.abs(diff) > 1e-4) {
        return diff;
      }
    } else if (a.projectedDistance !== null) {
      return -1;
    } else if (b.projectedDistance !== null) {
      return 1;
    }

    // 2. Secondary: instanceNumber
    if (a.instanceNumber !== null && b.instanceNumber !== null) {
      if (a.instanceNumber !== b.instanceNumber) {
        return a.instanceNumber - b.instanceNumber;
      }
    } else if (a.instanceNumber !== null) {
      return -1;
    } else if (b.instanceNumber !== null) {
      return 1;
    }

    // 3. Tertiary: filename natural sort
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

/**
 * StudyBuilder — Ingests heterogeneous DICOM inputs and constructs
 * a canonically sorted, series-grouped study model.
 */
export class StudyBuilder {
  private readonly parseFn: ParseDicomFn;

  constructor(options?: StudyBuilderOptions) {
    this.parseFn = options?.parseFn ?? parseDicomFile;
  }

  /**
   * Processes a list of raw inputs and returns the structured, spatially sorted study.
   */
  public async buildStudy(
    inputs: readonly StudyRawInput[],
  ): Promise<BuiltStudy> {
    const rawSlices: Array<{
      name: string;
      buffer: ArrayBuffer;
      file?: File;
      parsed: ParsedDicom;
      projectedDistance: number | null;
      instanceNumber: number | null;
      seriesUid: string;
    }> = [];

    for (const input of inputs) {
      try {
        const { name, buffer, file } = await extractBufferAndName(input);
        const parsed = this.parseFn(buffer);

        const ipp = parsed.metadata.imagePositionPatient;
        const iop = parsed.metadata.imageOrientationPatient;
        const projectedDistance = calculateSpatialDistance(ipp, iop);

        const instRaw = parsed.metadata.instanceNumber;
        const parsedInst = instRaw ? parseInt(instRaw, 10) : NaN;
        const instanceNumber = isNaN(parsedInst) ? null : parsedInst;

        const seriesUid =
          parsed.metadata.seriesInstanceUid ||
          `series_${parsed.metadata.seriesNumber || "default"}`;

        rawSlices.push({
          name,
          buffer,
          file,
          parsed,
          projectedDistance,
          instanceNumber,
          seriesUid,
        });
      } catch (err) {
        // Non-DICOM or corrupted buffers are safely skipped
        console.warn("Skipping unparseable DICOM item:", err);
      }
    }

    // Group slices by SeriesInstanceUID
    const seriesMap = new Map<
      string,
      Array<{
        name: string;
        buffer: ArrayBuffer;
        file?: File;
        parsed: ParsedDicom;
        projectedDistance: number | null;
        instanceNumber: number | null;
      }>
    >();

    for (const slice of rawSlices) {
      let group = seriesMap.get(slice.seriesUid);
      if (!group) {
        group = [];
        seriesMap.set(slice.seriesUid, group);
      }
      group.push(slice);
    }

    const builtSeriesList: BuiltSeries[] = [];
    let studyInstanceUid = "";
    let studyDate = "";
    let studyDescription = "";
    let patientName = "";
    let patientId = "";

    for (const [seriesUid, slices] of seriesMap.entries()) {
      // Sort slices within the series using hierarchical criteria
      const sorted = sortSlices(slices);

      const builtSlices: BuiltSlice[] = sorted.map((s, idx) => ({
        index: idx,
        name: s.name,
        buffer: s.buffer,
        file: s.file,
        parsed: s.parsed,
        projectedDistance: s.projectedDistance,
        instanceNumber: s.instanceNumber,
      }));

      const refMeta = builtSlices[0]?.parsed.metadata;
      if (!studyInstanceUid && refMeta?.studyInstanceUid) {
        studyInstanceUid = refMeta.studyInstanceUid;
        studyDate = refMeta.studyDate || "";
        studyDescription = refMeta.studyDescription || "";
        patientName = refMeta.patientName || "";
        patientId = refMeta.patientId || "";
      }

      // Compute plane normal, orientation labels and canonical flip from the first slice with valid IOP
      let planeNormal: Vector3D | null = null;
      let orientationLabels: OrientationLabels | null = null;
      let canonicalFlip: CanonicalFlip | null = null;

      for (const sl of builtSlices) {
        const iop = sl.parsed.metadata.imageOrientationPatient;
        if (iop && iop.length >= 6) {
          planeNormal = computePlaneNormal(iop);
          orientationLabels = getOrientationLabels(iop);
          canonicalFlip = getCanonicalFlip(iop);
          break;
        }
      }

      // Compute slice spacing
      let spacingBetweenSlices: number | null = null;
      if (refMeta?.spacingBetweenSlices) {
        spacingBetweenSlices = refMeta.spacingBetweenSlices;
      } else if (refMeta?.sliceThickness) {
        spacingBetweenSlices = refMeta.sliceThickness;
      } else if (builtSlices.length > 1) {
        const d0 = builtSlices[0].projectedDistance;
        const dN = builtSlices[builtSlices.length - 1].projectedDistance;
        if (d0 !== null && dN !== null) {
          const calcSpacing = Math.abs(dN - d0) / (builtSlices.length - 1);
          if (calcSpacing > 0) {
            spacingBetweenSlices = Math.round(calcSpacing * 100) / 100;
          }
        }
      }

      builtSeriesList.push({
        seriesInstanceUid: seriesUid,
        seriesDescription: refMeta?.seriesDescription || "",
        seriesNumber: refMeta?.seriesNumber || "",
        modality: refMeta?.modality || "OT",
        slices: builtSlices,
        planeNormal,
        orientationLabels,
        canonicalFlip,
        spacingBetweenSlices,
      });
    }

    // Primary series: the one with the most slices
    let primarySeries: BuiltSeries | null = null;
    if (builtSeriesList.length > 0) {
      primarySeries = builtSeriesList.reduce(
        (max, s) => (s.slices.length > max.slices.length ? s : max),
        builtSeriesList[0],
      );
    }

    const totalSlices = builtSeriesList.reduce(
      (sum, s) => sum + s.slices.length,
      0,
    );

    return {
      studyInstanceUid,
      studyDate,
      studyDescription,
      patientName,
      patientId,
      series: builtSeriesList,
      primarySeries,
      totalSlices,
    };
  }

  /**
   * Static helper to build a study directly.
   */
  public static async build(
    inputs: readonly StudyRawInput[],
    options?: StudyBuilderOptions,
  ): Promise<BuiltStudy> {
    const builder = new StudyBuilder(options);
    return builder.buildStudy(inputs);
  }
}

/**
 * Functional entry point to process raw DICOM inputs into a structured study.
 */
export async function buildStudy(
  inputs: readonly StudyRawInput[],
  options?: StudyBuilderOptions,
): Promise<BuiltStudy> {
  return StudyBuilder.build(inputs, options);
}
