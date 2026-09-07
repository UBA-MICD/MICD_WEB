import { parseDicomFile, ParsedDicom } from "../dicom/dicom-parser-util.js";
import { authFetch, API_BASE } from "../auth/auth.js";
import { fetchInstanceFile } from "../services/api.js";
import { state } from "./state.js";

/**
 * DicomCache — Handles in-memory caching and non-blocking background prefetching
 * for DICOM slice loading (US 1).
 */
export class DicomCache {
  private cache = new Map<number, ParsedDicom>();
  private pending = new Map<number, Promise<ParsedDicom | null>>();

  /** Clear all cached images and active promises. */
  public clear(): void {
    this.cache.clear();
    this.pending.clear();
  }

  /** Get a slice if already available in memory. */
  public get(index: number): ParsedDicom | undefined {
    return this.cache.get(index);
  }

  /** Store a slice in memory. */
  public set(index: number, parsed: ParsedDicom): void {
    this.cache.set(index, parsed);
  }

  /** Retrieve a slice from cache or fetch it asynchronously. */
  public async getOrFetch(index: number): Promise<ParsedDicom | null> {
    if (this.cache.has(index)) {
      return this.cache.get(index)!;
    }
    if (this.pending.has(index)) {
      return this.pending.get(index)!;
    }

    const promise = this.fetchIndex(index)
      .then((parsed) => {
        if (parsed) {
          this.cache.set(index, parsed);
        }
        this.pending.delete(index);
        return parsed;
      })
      .catch((err) => {
        console.warn(`Failed to fetch DICOM slice ${index}`, err);
        this.pending.delete(index);
        return null;
      });

    this.pending.set(index, promise);
    return promise;
  }

  /** Fetch a specific slice index from local disk files or Orthanc server. */
  private async fetchIndex(index: number): Promise<ParsedDicom | null> {
    if (state.source === "local") {
      if (index < 0 || index >= state.files.length) return null;
      const file = state.files[index];
      const buffer = await file.arrayBuffer();
      return parseDicomFile(buffer);
    } else {
      if (
        index < 0 ||
        index >= state.serverInstances.length ||
        !state.serverStudyId
      ) {
        return null;
      }
      const instanceId = state.serverInstances[index];
      const res = await fetchInstanceFile(state.serverStudyId, instanceId);
      if (!res.ok) return null;
      const buffer = await res.arrayBuffer();
      return parseDicomFile(buffer);
    }
  }

  /**
   * Prefetch up to `count` slices immediately following `currentIndex`
   * in the background without blocking the UI thread.
   */
  public prefetchNext(currentIndex: number, count: number = 5): void {
    const total =
      state.source === "server"
        ? state.serverInstances.length
        : state.files.length;
    for (let i = 1; i <= count; i++) {
      const targetIndex = currentIndex + i;
      if (
        targetIndex < total &&
        !this.cache.has(targetIndex) &&
        !this.pending.has(targetIndex)
      ) {
        void this.getOrFetch(targetIndex);
      }
    }
  }

  /** Returns all cached ParsedDicom objects ordered by index. */
  public getAllCachedOrdered(): Array<{ index: number; parsed: ParsedDicom }> {
    const items: Array<{ index: number; parsed: ParsedDicom }> = [];
    for (const [index, parsed] of this.cache.entries()) {
      items.push({ index, parsed });
    }
    return items.sort((a, b) => a.index - b.index);
  }
}

export const dicomCache = new DicomCache();
