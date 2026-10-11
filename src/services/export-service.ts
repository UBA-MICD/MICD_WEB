/* cspell:disable */
/**
 * export-service.ts — DICOM Study & Viewport Export Service.
 * Handles PNG canvas export, DICOM PII anonymization, descriptive filename generation,
 * and ZIP packaging via fflate.
 */

import { zipSync } from "fflate";
import { anonymizeDicomBytes } from "../upload/local-anonymizer.js";
import { showBanner } from "../shared/banner.js";
import { authFetch, API_BASE } from "../auth/auth.js";
import { fetchStudyInstances, fetchInstanceFile } from "./api.js";
import { state } from "../viewer/state.js";
import { dicomCache } from "../viewer/cache.js";
import { t } from "../i18n/i18n.js";

export interface StudyExportMetadata {
  studyDate?: string;
  modality?: string;
  studyDescription?: string;
  patientName?: string;
  patientId?: string;
}

/**
 * Generates a clean, metadata-driven descriptive filename for exported studies or images.
 * Format: YYYYMMDD_Modality_StudyDescription.ext
 * Avoids raw UUIDs and Patient PII.
 */
export function generateDescriptiveFilename(
  meta?: StudyExportMetadata,
  extension: string = "zip",
): string {
  const ext = extension.startsWith(".") ? extension.slice(1) : extension;

  // 1. Format Date (YYYYMMDD)
  let dateStr = "UNKNOWN_DATE";
  if (meta?.studyDate) {
    const cleaned = meta.studyDate.replace(/[-_./\s]/g, "");
    if (/^\d{8}$/.test(cleaned)) {
      dateStr = cleaned;
    } else {
      const parsed = new Date(meta.studyDate);
      if (!isNaN(parsed.getTime())) {
        dateStr = parsed.toISOString().slice(0, 10).replace(/-/g, "");
      }
    }
  }
  if (dateStr === "UNKNOWN_DATE") {
    dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  }

  // 2. Format Modality
  let modality = (meta?.modality || "DICOM").trim().toUpperCase();
  modality = modality.replace(/[^A-Z0-9]/g, "") || "STUDY";

  // 3. Format Study Description
  let desc = (meta?.studyDescription || "Export").trim();
  desc = desc
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (desc.length > 30) {
    desc = desc.slice(0, 30);
  }
  if (!desc) desc = "Study";

  return `${dateStr}_${modality}_${desc}.${ext}`;
}

/**
 * Saves a Blob: the native save dialog under Electron, an invisible <a> link
 * in the browser.
 *
 * Returns whether a file was actually written. The browser path always
 * reports `true` — `<a download>` cannot fail or be declined from here — but
 * the desktop path returns `false` when the user dismisses the save dialog,
 * and callers must not announce success without checking. Rejects if the
 * write itself fails.
 */
export async function downloadBlob(
  blob: Blob,
  filename: string,
): Promise<boolean> {
  if (typeof window !== "undefined" && window.api?.saveFile) {
    return await window.api.saveFile(filename, await blob.arrayBuffer());
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/**
 * Renders and exports the current DICOM viewport canvas as a PNG image.
 */
export async function exportCurrentViewToPNG(
  canvasTarget: string | HTMLCanvasElement = "dicom-canvas",
  customFilename?: string,
): Promise<void> {
  const canvas =
    typeof canvasTarget === "string"
      ? (document.getElementById(canvasTarget) as HTMLCanvasElement)
      : canvasTarget;

  if (!canvas) {
    showBanner(t("export.canvasNotFound"), "error");
    return;
  }

  const meta = state.parsed?.metadata;
  const filename =
    customFilename ||
    generateDescriptiveFilename(
      {
        studyDate: meta?.studyDate,
        modality: meta?.modality,
        studyDescription: meta?.studyDescription,
      },
      "png",
    );

  showBanner(t("export.exportingPng"), "warning");

  return new Promise((resolve, reject) => {
    // The callback is async, so anything thrown inside it lands nowhere —
    // this promise would simply never settle. Everything after toBlob() is
    // wrapped so a failed save rejects the caller instead.
    canvas.toBlob(async (blob) => {
      if (!blob) {
        showBanner(t("export.canvasBlobError"), "error");
        reject(new Error("Canvas toBlob failed"));
        return;
      }
      try {
        const saved = await downloadBlob(blob, filename);
        showBanner(
          saved ? t("export.pngSuccess") : t("export.saveCanceled"),
          saved ? "success" : "warning",
        );
        resolve();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        showBanner(t("export.genericError", { message }), "error");
        reject(err instanceof Error ? err : new Error(message));
      }
    }, "image/png");
  });
}

// Files fetched/anonymized at once: enough to hide per-file latency on large
// series without flooding the anonymization service or holding a whole CT in memory.
export const EXPORT_CONCURRENCY = 8;

/**
 * Maps `items` through `fn` with at most `batchSize` calls in flight, keeping
 * input order. Rejects on the first failure, so an export still fails closed.
 */
export async function mapInBatches<T, R>(
  items: readonly T[],
  batchSize: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    out.push(...(await Promise.all(batch.map((item, j) => fn(item, start + j)))));
  }
  return out;
}

/**
 * Packages multiple files into a single .zip Blob using fflate.
 *
 * Building the archive and saving it are separate steps on purpose: saving is
 * async and can be declined (see `downloadBlob`), so the caller owns it and
 * reports the outcome.
 */
export function buildStudyZip(
  files: Array<{ name: string; buffer: ArrayBuffer }>,
): Blob {
  const zipData: Record<string, Uint8Array> = {};

  files.forEach((f) => {
    zipData[f.name] = new Uint8Array(f.buffer);
  });

  const compressed = zipSync(zipData, { level: 6 });
  return new Blob([compressed], { type: "application/zip" });
}

/**
 * Exports the currently active study (server or local disk) as an anonymized ZIP archive.
 */
export async function exportCurrentStudyAsZip(
  opts: { anonymize?: boolean } = {},
): Promise<void> {
  const anonymize = opts.anonymize !== false;
  showBanner(t("export.preparingZip"), "warning");

  try {
    const filesToZip: Array<{ name: string; buffer: ArrayBuffer }> = [];
    let meta: StudyExportMetadata = {};

    if (state.source === "server" && state.serverStudyId) {
      const studyId = state.serverStudyId;
      const instances = state.serverInstances;

      if (instances.length === 0) {
        throw new Error(t("export.noImagesInStudy"));
      }

      showBanner(
        t("export.downloadingServerImages", { count: instances.length }),
        "warning",
      );

      const slices = await mapInBatches(
        instances,
        EXPORT_CONCURRENCY,
        async (instanceId, i) => {
          const name = `slice_${String(i + 1).padStart(4, "0")}.dcm`;
          let buf: ArrayBuffer;
          const cached = dicomCache.get(i);
          if (cached?.rawDataSet?.byteArray?.buffer) {
            buf = cached.rawDataSet.byteArray.buffer.slice(0);
          } else {
            const res = await fetchInstanceFile(studyId, instanceId);
            if (!res.ok)
              throw new Error(
                t("export.instanceDownloadError", { index: i + 1 }),
              );
            buf = await res.arrayBuffer();
          }
          if (anonymize) buf = await anonymizeDicomBytes(buf, name);
          return { name, buffer: buf };
        },
      );
      filesToZip.push(...slices);

      if (state.parsed?.metadata) {
        meta = {
          studyDate: state.parsed.metadata.studyDate,
          modality: state.parsed.metadata.modality,
          studyDescription: state.parsed.metadata.studyDescription,
        };
      }
    } else if (state.files.length > 0) {
      // Local files
      const localFiles = await mapInBatches(
        state.files,
        EXPORT_CONCURRENCY,
        async (file, i) => {
          const name = file.name || `image_${i + 1}.dcm`;
          let buf = await file.arrayBuffer();
          if (anonymize) buf = await anonymizeDicomBytes(buf, name);
          return { name, buffer: buf };
        },
      );
      filesToZip.push(...localFiles);

      if (state.parsed?.metadata) {
        meta = {
          studyDate: state.parsed.metadata.studyDate,
          modality: state.parsed.metadata.modality,
          studyDescription: state.parsed.metadata.studyDescription,
        };
      }
    } else {
      throw new Error(t("export.noStudyLoaded"));
    }

    const zipFilename = generateDescriptiveFilename(meta, "zip");
    const saved = await downloadBlob(buildStudyZip(filesToZip), zipFilename);
    showBanner(
      saved
        ? t("export.zipSuccess", { filename: zipFilename })
        : t("export.saveCanceled"),
      saved ? "success" : "warning",
    );
  } catch (err: any) {
    console.error("Export Error:", err);
    showBanner(
      t("export.genericError", { message: err.message || err }),
      "error",
    );
  }
}

/**
 * Exports a specific study from the server by study ID as an anonymized ZIP archive.
 */
export async function exportStudyByIdAsZip(
  studyId: string,
  studyMeta?: StudyExportMetadata,
  opts: { anonymize?: boolean } = {},
): Promise<void> {
  const anonymize = opts.anonymize !== false;
  showBanner(t("export.fetchingStudyInfo"), "warning");

  try {
    const res = await fetchStudyInstances(studyId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      instances: Array<{ instanceId: string }>;
    };
    const instanceIds = data.instances.map((x) => x.instanceId);

    if (instanceIds.length === 0) {
      throw new Error(t("export.noInstancesInStudy"));
    }

    showBanner(
      t("export.downloadingFiles", { count: instanceIds.length }),
      "warning",
    );
    const filesToZip = await mapInBatches(
      instanceIds,
      EXPORT_CONCURRENCY,
      async (instId, i) => {
        const name = `instance_${String(i + 1).padStart(4, "0")}.dcm`;
        const fRes = await fetchInstanceFile(studyId, instId);
        if (!fRes.ok)
          throw new Error(t("export.fileFetchError", { index: i + 1 }));
        let buf = await fRes.arrayBuffer();
        if (anonymize) buf = await anonymizeDicomBytes(buf, name);
        return { name, buffer: buf };
      },
    );

    const zipFilename = generateDescriptiveFilename(studyMeta, "zip");
    const saved = await downloadBlob(buildStudyZip(filesToZip), zipFilename);
    showBanner(
      saved
        ? t("export.zipSuccess", { filename: zipFilename })
        : t("export.saveCanceled"),
      saved ? "success" : "warning",
    );
  } catch (err: any) {
    console.error("Export study by ID error:", err);
    showBanner(
      t("export.genericError", { message: err.message || err }),
      "error",
    );
  }
}
