/* cspell:disable */
/**
 * export-service.ts — DICOM Study & Viewport Export Service.
 * Handles PNG canvas export, DICOM PII anonymization, descriptive filename generation,
 * and ZIP packaging via fflate.
 */

import { zipSync } from "fflate";
import { anonymizeDicomBuffer } from "../utils/dicom-anonymizer.js";
import { showBanner } from "../shared/banner.js";
import { authFetch, API_BASE } from "../auth/auth.js";
import { state } from "../viewer/state.js";
import { dicomCache } from "../viewer/cache.js";

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
 * Downloads a Blob using an invisible <a> link.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
    showBanner(
      "No se encontró el canvas de renderizado para exportar PNG.",
      "error",
    );
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

  showBanner("Exportando imagen actual a PNG…", "warning");

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        showBanner("Error al generar imagen PNG desde el canvas.", "error");
        reject(new Error("Canvas toBlob failed"));
        return;
      }
      downloadBlob(blob, filename);
      showBanner("Imagen PNG descargada con éxito.", "success");
      resolve();
    }, "image/png");
  });
}

/**
 * Packages multiple files into a single .zip file using fflate and triggers download.
 */
export function exportStudyToZip(
  files: Array<{ name: string; buffer: ArrayBuffer }>,
  zipFilename: string,
): Blob {
  const zipData: Record<string, Uint8Array> = {};

  files.forEach((f) => {
    zipData[f.name] = new Uint8Array(f.buffer);
  });

  const compressed = zipSync(zipData, { level: 6 });
  const blob = new Blob([compressed], { type: "application/zip" });
  downloadBlob(blob, zipFilename);
  return blob;
}

/**
 * Exports the currently active study (server or local disk) as an anonymized ZIP archive.
 */
export async function exportCurrentStudyAsZip(
  opts: { anonymize?: boolean } = {},
): Promise<void> {
  const anonymize = opts.anonymize !== false;
  showBanner("Preparando exportación de estudio .zip…", "warning");

  try {
    const filesToZip: Array<{ name: string; buffer: ArrayBuffer }> = [];
    let meta: StudyExportMetadata = {};

    if (state.source === "server" && state.serverStudyId) {
      const studyId = state.serverStudyId;
      const instances = state.serverInstances;

      if (instances.length === 0) {
        throw new Error("El estudio no contiene imágenes.");
      }

      showBanner(
        `Descargando ${instances.length} imágenes del servidor…`,
        "warning",
      );

      for (let i = 0; i < instances.length; i++) {
        const instanceId = instances[i];
        let buf: ArrayBuffer | undefined = undefined;

        // Try cache first
        const cached = dicomCache.get(i);
        if (cached?.rawDataSet?.byteArray?.buffer) {
          buf = cached.rawDataSet.byteArray.buffer.slice(0);
        } else {
          const res = await authFetch(
            `${API_BASE}/v1/studies/${encodeURIComponent(studyId)}/instances/${encodeURIComponent(instanceId)}/file`,
          );
          if (!res.ok) throw new Error(`Error descargando instancia ${i + 1}`);
          buf = await res.arrayBuffer();
        }

        if (anonymize && buf) {
          buf = anonymizeDicomBuffer(buf);
        }

        if (buf) {
          const numStr = String(i + 1).padStart(4, "0");
          filesToZip.push({ name: `slice_${numStr}.dcm`, buffer: buf });
        }
      }

      if (state.parsed?.metadata) {
        meta = {
          studyDate: state.parsed.metadata.studyDate,
          modality: state.parsed.metadata.modality,
          studyDescription: state.parsed.metadata.studyDescription,
        };
      }
    } else if (state.files.length > 0) {
      // Local files
      for (let i = 0; i < state.files.length; i++) {
        const file = state.files[i];
        let buf = await file.arrayBuffer();
        if (anonymize) {
          buf = anonymizeDicomBuffer(buf);
        }
        filesToZip.push({
          name: file.name || `image_${i + 1}.dcm`,
          buffer: buf,
        });
      }

      if (state.parsed?.metadata) {
        meta = {
          studyDate: state.parsed.metadata.studyDate,
          modality: state.parsed.metadata.modality,
          studyDescription: state.parsed.metadata.studyDescription,
        };
      }
    } else {
      throw new Error("No hay ningún estudio cargado para exportar.");
    }

    const zipFilename = generateDescriptiveFilename(meta, "zip");
    exportStudyToZip(filesToZip, zipFilename);
    showBanner(
      `Estudio exportado exitosamente como '${zipFilename}'.`,
      "success",
    );
  } catch (err: any) {
    console.error("Export Error:", err);
    showBanner(`Error al exportar estudio: ${err.message || err}`, "error");
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
  showBanner("Obteniendo información del estudio en el servidor…", "warning");

  try {
    const res = await authFetch(
      `${API_BASE}/v1/studies/${encodeURIComponent(studyId)}/instances`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      instances: Array<{ instanceId: string }>;
    };
    const instanceIds = data.instances.map((x) => x.instanceId);

    if (instanceIds.length === 0) {
      throw new Error("El estudio seleccionado no contiene instancias.");
    }

    showBanner(
      `Descargando ${instanceIds.length} archivos DICOM del estudio…`,
      "warning",
    );
    const filesToZip: Array<{ name: string; buffer: ArrayBuffer }> = [];

    for (let i = 0; i < instanceIds.length; i++) {
      const instId = instanceIds[i];
      const fRes = await authFetch(
        `${API_BASE}/v1/studies/${encodeURIComponent(studyId)}/instances/${encodeURIComponent(instId)}/file`,
      );
      if (!fRes.ok) throw new Error(`Error recuperando archivo ${i + 1}`);
      let buf = await fRes.arrayBuffer();

      if (anonymize) {
        buf = anonymizeDicomBuffer(buf);
      }

      const numStr = String(i + 1).padStart(4, "0");
      filesToZip.push({ name: `instance_${numStr}.dcm`, buffer: buf });
    }

    const zipFilename = generateDescriptiveFilename(studyMeta, "zip");
    exportStudyToZip(filesToZip, zipFilename);
    showBanner(
      `Estudio exportado exitosamente como '${zipFilename}'.`,
      "success",
    );
  } catch (err: any) {
    console.error("Export study by ID error:", err);
    showBanner(`Error al exportar estudio: ${err.message || err}`, "error");
  }
}
