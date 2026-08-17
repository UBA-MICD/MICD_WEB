/**
 * zip-expand.ts — Client-side ZIP expansion for the Cargar tab.
 *
 * Splits from upload.ts so that extractZipEntries can be unit-tested in Node
 * without needing the DOM or fflate's import-map resolution.
 */

import { isDicomCandidate } from "../shared/folder-files.js";
import { t } from "../i18n/i18n.js";
export type UnzipFn = (
  data: Uint8Array,
  cb: (err: Error | null, out: Record<string, Uint8Array>) => void,
) => void;

export const MAX_CLIENT_ZIP_BYTES = 512 * 1024 * 1024;

function isDicomEntry(entryPath: string): boolean {
  if (entryPath.includes("..")) return false;
  const parts = entryPath.split(/[/\\]/);
  const base = parts[parts.length - 1] ?? "";
  if (base === "") return false;
  return isDicomCandidate(base);
}

/**
 * Extract DICOM-candidate entries from a ZIP buffer. Pure: no DOM, no network.
 * Receives the unzip implementation as a parameter so tests can mock it.
 */
export async function extractZipEntries(
  data: Uint8Array,
  unzipFn: UnzipFn,
): Promise<{ name: string; data: Uint8Array }[]> {
  const out = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzipFn(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

  const seen = new Set<string>();
  return Object.entries(out)
    .filter(([path]) => isDicomEntry(path))
    .map(([path, buf]) => {
      const parts = path.split(/[/\\]/);
      let name = parts[parts.length - 1] ?? path;
      if (seen.has(name)) {
        const parent = parts.length >= 2 ? (parts[parts.length - 2] ?? "") : "";
        name = parent ? `${parent}_${name}` : `${name}_${seen.size + 1}`;
      }
      seen.add(name);
      return { name, data: buf };
    });
}

/**
 * Given a mixed file list, expand any .zip files using fflate.unzip and
 * return the flat list of individual files (zips replaced by their entries).
 * Non-zip files pass through unchanged.
 *
 * `statusEl` receives a "Descomprimiendo…" message while a zip is being
 * processed; pass null if no status element is available.
 */
export async function expandFiles(
  files: readonly File[],
  statusEl: HTMLElement | null,
  unzipFnOverride?: UnzipFn,
): Promise<{ files: File[]; corruptZips: string[]; tooBigZips: string[] }> {
  const result: File[] = [];
  const corruptZips: string[] = [];
  const tooBigZips: string[] = [];
  let unzip: UnzipFn | undefined = unzipFnOverride;

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      result.push(file);
      continue;
    }

    if (file.size > MAX_CLIENT_ZIP_BYTES) {
      tooBigZips.push(file.name);
      continue;
    }

    if (statusEl) {
      statusEl.textContent = t("upload.unzippingNamed", { name: file.name });
    }

    try {
      if (!unzip) {
        unzip = ((await import("fflate")) as { unzip: UnzipFn }).unzip;
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      const entries = await extractZipEntries(buf, unzip);
      for (const entry of entries) {
        result.push(new File([new Uint8Array(entry.data)], entry.name));
      }
    } catch {
      corruptZips.push(file.name);
    } finally {
      if (statusEl) statusEl.textContent = "";
    }
  }

  return { files: result, corruptZips, tooBigZips };
}
