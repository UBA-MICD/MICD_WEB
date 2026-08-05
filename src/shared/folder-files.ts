/**
 * folder-files.ts — Turn a folder/multi-file selection into the ordered list
 * of DICOM images the viewer can walk through.
 *
 * Two jobs:
 *  1. Keep only DICOM images (drop sidecar files like .txt/.png and OS junk).
 *  2. Order them the way a radiologist scrolls a series — numerically, so
 *     `image-2` comes before `image-10`, and grouped by sub-folder (series).
 */

/** Minimal shape we need from a browser `File` (so this stays DOM-free/testable). */
export interface FolderFile {
  name: string;
  /** Set by the browser when files come from a <input webkitdirectory> selection. */
  webkitRelativePath?: string;
}

// Files that live next to DICOM data but are never images themselves.
const JUNK_NAMES = new Set(["dicomdir", "thumbs.db"]);

/** The path we sort/inspect by — relative path inside the folder when available. */
function pathOf(file: FolderFile): string {
  return file.webkitRelativePath && file.webkitRelativePath.length > 0
    ? file.webkitRelativePath
    : file.name;
}

/** Last path segment, e.g. "study/series-1/image-1.dcm" → "image-1.dcm". */
function baseName(path: string): string {
  const segments = path.split(/[/\\]/);
  return segments[segments.length - 1] ?? path;
}

function isDicomCandidate(path: string): boolean {
  const base = baseName(path);
  const lower = base.toLowerCase();

  // Hidden / OS metadata files (.DS_Store, ._foo, …) are never DICOM images.
  if (base.startsWith(".")) return false;
  if (JUNK_NAMES.has(lower)) return false;

  if (lower.endsWith(".dcm")) return true;

  // Many PACS exports name slices with no extension (IM000001, I10, …).
  // Treat "no extension" as a DICOM candidate; reject other extensions
  // (.txt, .png, .jpg, .json, …) which are sidecar files.
  const hasExtension = /\.[^.]+$/.test(base);
  return !hasExtension;
}

export interface ServerUploadSelection {
  valid: File[];
  rejected: File[];
}

/**
 * Split a drag-and-drop file list into files the server upload accepts
 * (.dcm / no-extension DICOM candidates and .zip archives) and those it
 * doesn't. Pure: never mutates the input.
 */
export function collectServerUploadFiles(
  files: readonly File[],
): ServerUploadSelection {
  const valid: File[] = [];
  const rejected: File[] = [];
  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".zip") || isDicomCandidate(file.name)) {
      valid.push(file);
    } else {
      rejected.push(file);
    }
  }
  return { valid, rejected };
}

/**
 * Filter a selection down to DICOM images, ordered for sequential viewing.
 * Pure: never mutates the input.
 */
export function collectDicomFiles<T extends FolderFile>(
  files: readonly T[],
): T[] {
  return files
    .filter((file) => isDicomCandidate(pathOf(file)))
    .sort((a, b) =>
      pathOf(a).localeCompare(pathOf(b), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}
