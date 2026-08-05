/**
 * zip-expand.ts — Client-side ZIP expansion for the Cargar tab.
 *
 * Splits from upload.ts so that extractZipEntries can be unit-tested in Node
 * without needing the DOM or fflate's import-map resolution. Only expandFiles
 * (the production entry point) imports fflate, and it does so dynamically.
 */

export type UnzipFn = (
  data: Uint8Array,
  cb: (err: Error | null, out: Record<string, Uint8Array>) => void,
) => void;

const JUNK_NAMES = new Set(["dicomdir", "thumbs.db"]);

function isDicomEntry(entryPath: string): boolean {
  const parts = entryPath.split(/[/\\]/);
  const base = parts[parts.length - 1] ?? "";
  const lower = base.toLowerCase();

  if (base.startsWith(".")) return false;
  if (JUNK_NAMES.has(lower)) return false;
  if (entryPath.includes("..")) return false;

  if (lower.endsWith(".dcm")) return true;
  const hasExtension = /\.[^.]+$/.test(base);
  return !hasExtension;
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

  return Object.entries(out)
    .filter(([path]) => isDicomEntry(path))
    .map(([path, buf]) => {
      const parts = path.split(/[/\\]/);
      return { name: parts[parts.length - 1] ?? path, data: buf };
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
): Promise<File[]> {
  const { unzip } = (await import("fflate")) as { unzip: UnzipFn };
  const result: File[] = [];

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      result.push(file);
      continue;
    }

    if (statusEl) {
      statusEl.textContent = `Descomprimiendo ${file.name}…`;
    }

    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const entries = await extractZipEntries(buf, unzip);
      for (const entry of entries) {
        // Copy into a fresh ArrayBuffer so the File constructor's type is satisfied
        result.push(new File([new Uint8Array(entry.data)], entry.name));
      }
    } catch {
      // Corrupt or unreadable zip — skip silently; startUpload will show
      // "No se encontraron archivos DICOM." if nothing was extracted.
    } finally {
      if (statusEl) statusEl.textContent = "";
    }
  }

  return result;
}
