/**
 * viewport-manager.ts — Multi-Viewport architecture and sync system (US-13).
 * Supports dynamic grid layouts (1x1, 1x2, 2x2) and synchronization of
 * camera transforms (Pan, Zoom, Window/Level, slice scroll) across viewports.
 */

import type { ParsedDicom } from "../dicom/dicom-parser-util.js";
import {
  type ViewportState,
  renderDicom,
  applyCanvasTransform,
  createDefaultViewport,
  fitToContainer,
} from "../dicom/dicom-renderer.js";
import { escapeHtml } from "../shared/dom.js";

// ── Types and Contracts ───────────────────────────────────────────────────────

export type GridLayout = "1x1" | "1x2" | "2x2";

export interface OverlayLayer {
  files: File[];
  parsed: ParsedDicom | null;
  viewport: ViewportState;
}

export interface ViewportData {
  source: "local" | "server";
  files: File[];
  serverStudyId: string | null;
  serverInstances: string[];
  currentIndex: number;
  parsed: ParsedDicom | null;
  viewport: ViewportState;
  overlay?: OverlayLayer | null;
}

// ── Viewport Class ────────────────────────────────────────────────────────────

export class Viewport {
  public readonly id: string;
  public readonly cellElement: HTMLDivElement;
  public readonly canvasElement: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;

  // HUD overlay elements
  private readonly overlayTL: HTMLDivElement;
  private readonly overlayTR: HTMLDivElement;
  private readonly overlayBL: HTMLDivElement;
  private readonly overlayBR: HTMLDivElement;

  // Cardinal orientation labels
  private readonly orientTop: HTMLDivElement;
  private readonly orientBottom: HTMLDivElement;
  private readonly orientLeft: HTMLDivElement;
  private readonly orientRight: HTMLDivElement;

  // Viewport state
  public data: ViewportData;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onSelectCallback?: (id: string) => void;

  constructor(id: string, onSelect?: (id: string) => void) {
    this.id = id;
    this.onSelectCallback = onSelect;

    this.data = {
      source: "local",
      files: [],
      serverStudyId: null,
      serverInstances: [],
      currentIndex: 0,
      parsed: null,
      viewport: { windowCenter: 0, windowWidth: 0, zoom: 1, panX: 0, panY: 0 },
    };

    // Create encapsulated DOM elements
    this.cellElement = document.createElement("div");
    this.cellElement.className = "viewport-cell";
    this.cellElement.dataset.viewportId = id;
    this.cellElement.tabIndex = 0;

    this.canvasElement = document.createElement("canvas");
    this.canvasElement.className = "viewport-canvas";
    this.canvasElement.setAttribute("role", "img");
    this.canvasElement.setAttribute("aria-label", `Viewport ${id}`);

    this.ctx = this.canvasElement.getContext("2d");

    // HUD overlays
    this.overlayTL = this.createDiv("overlay overlay--tl");
    this.overlayTR = this.createDiv("overlay overlay--tr");
    this.overlayBL = this.createDiv("overlay overlay--bl");
    this.overlayBR = this.createDiv("overlay overlay--br");

    // Cardinal orientation labels
    this.orientTop = this.createDiv("mpr-orient-label mpr-orient-label--top");
    this.orientBottom = this.createDiv(
      "mpr-orient-label mpr-orient-label--bottom",
    );
    this.orientLeft = this.createDiv("mpr-orient-label mpr-orient-label--left");
    this.orientRight = this.createDiv(
      "mpr-orient-label mpr-orient-label--right",
    );

    this.attachDom();
    this.setupEvents();
  }

  private createDiv(className: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = className;
    return el;
  }

  private attachDom(): void {
    this.cellElement.appendChild(this.canvasElement);
    this.cellElement.appendChild(this.orientTop);
    this.cellElement.appendChild(this.orientBottom);
    this.cellElement.appendChild(this.orientLeft);
    this.cellElement.appendChild(this.orientRight);
    this.cellElement.appendChild(this.overlayTL);
    this.cellElement.appendChild(this.overlayTR);
    this.cellElement.appendChild(this.overlayBL);
    this.cellElement.appendChild(this.overlayBR);
  }

  private setupEvents(): void {
    this.cellElement.addEventListener("pointerdown", () => {
      this.onSelectCallback?.(this.id);
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.render();
    });
    this.resizeObserver.observe(this.cellElement);
  }

  public setActive(active: boolean): void {
    this.cellElement.classList.toggle("active", active);
  }

  public get itemCount(): number {
    return this.data.source === "server"
      ? this.data.serverInstances.length
      : this.data.files.length;
  }

  // ── Camera / State Mutations ──────────────────────────────────────────────

  public applyPanDelta(dx: number, dy: number): void {
    this.data.viewport.panX += dx;
    this.data.viewport.panY += dy;
    this.applyTransform();
  }

  public applyZoomFactor(factor: number): void {
    this.data.viewport.zoom = Math.max(
      0.1,
      Math.min(10, this.data.viewport.zoom * factor),
    );
    this.applyTransform();
    this.updateInfoOverlay();
  }

  public applyWindowLevelDelta(dWidth: number, dCenter: number): void {
    this.data.viewport.windowWidth = Math.max(
      1,
      this.data.viewport.windowWidth + dWidth,
    );
    this.data.viewport.windowCenter += dCenter;
    this.render();
  }

  /**
   * Advances or retreats the active slice index.
   * @returns true if the index changed and the slice should be reloaded.
   */
  public applySliceDelta(delta: number): boolean {
    const total = this.itemCount;
    if (total <= 1) return false;
    const target = this.data.currentIndex + delta;
    if (target >= 0 && target < total) {
      this.data.currentIndex = target;
      return true;
    }
    return false;
  }

  public fitImage(): void {
    if (!this.data.parsed?.metadata) return;
    const { columns, rows } = this.data.parsed.metadata;
    this.data.viewport.zoom = fitToContainer(
      this.cellElement.clientWidth,
      this.cellElement.clientHeight,
      columns,
      rows,
    );
    this.data.viewport.panX = 0;
    this.data.viewport.panY = 0;
  }

  public resetCamera(): void {
    if (!this.data.parsed?.metadata) return;
    this.data.viewport = createDefaultViewport(this.data.parsed.metadata);
    this.fitImage();
    this.render();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  public render(): void {
    if (!this.data.parsed?.pixelData || !this.ctx) {
      this.clear();
      this.updateOrientationLabels();
      return;
    }

    renderDicom({
      canvas: this.canvasElement,
      pixelData: this.data.parsed.pixelData,
      metadata: this.data.parsed.metadata,
      viewport: this.data.viewport,
      overlayPixelData: this.data.overlay?.parsed?.pixelData,
      overlayMetadata: this.data.overlay?.parsed?.metadata,
      overlayViewport: this.data.overlay?.viewport,
    });

    this.applyTransform();
    this.updateInfoOverlay();
    this.updateOrientationLabels();
  }

  private applyTransform(): void {
    applyCanvasTransform(
      this.cellElement as unknown as HTMLCanvasElement,
      this.canvasElement,
      this.data.viewport,
    );
  }

  private clear(): void {
    this.ctx?.clearRect(
      0,
      0,
      this.canvasElement.width,
      this.canvasElement.height,
    );
  }

  private updateOrientationLabels(): void {
    const hasData = Boolean(this.data.parsed?.pixelData);
    this.orientTop.textContent = hasData ? "A" : "";
    this.orientBottom.textContent = hasData ? "P" : "";
    this.orientLeft.textContent = hasData ? "R" : "";
    this.orientRight.textContent = hasData ? "L" : "";
  }

  private updateInfoOverlay(): void {
    const parsed = this.data.parsed;
    if (!parsed) {
      this.overlayTL.innerHTML = "";
      this.overlayTR.innerHTML = "";
      this.overlayBL.innerHTML = "";
      this.overlayBR.innerHTML = "";
      return;
    }

    const { metadata } = parsed;
    const patientName = escapeHtml(metadata.patientName || "Anonymous");
    const modality = escapeHtml(metadata.modality || "OT");
    const seriesDesc = escapeHtml(metadata.seriesDescription || "");
    const { windowWidth, windowCenter, zoom } = this.data.viewport;
    const totalItems = Math.max(1, this.itemCount);

    this.overlayTL.innerHTML = `<div>${patientName}</div><div>${modality} ${seriesDesc}</div>`;
    this.overlayTR.innerHTML = `<div>${escapeHtml(metadata.studyDate || "")}</div>`;
    this.overlayBL.innerHTML = `<div>W: ${Math.round(windowWidth)} L: ${Math.round(windowCenter)}</div>`;
    this.overlayBR.innerHTML = `<div>Zoom: ${(zoom * 100).toFixed(0)}%</div><div>Slice: ${this.data.currentIndex + 1}/${totalItems}</div>`;
  }

  public destroy(): void {
    this.resizeObserver?.disconnect();
    this.cellElement.remove();
  }
}

// ── ViewportManager Class ─────────────────────────────────────────────────────

export class ViewportManager {
  private readonly container: HTMLElement;
  private readonly viewports: Map<string, Viewport> = new Map();
  private activeViewportId: string | null = null;
  private currentLayout: GridLayout = "1x1";
  public isSynchronized = false;

  constructor(containerElement: HTMLElement) {
    this.container = containerElement;
    this.setLayout("1x1");
  }

  public get activeViewport(): Viewport | null {
    return this.activeViewportId
      ? (this.viewports.get(this.activeViewportId) ?? null)
      : null;
  }

  public getAllViewports(): Viewport[] {
    return Array.from(this.viewports.values());
  }

  public getLayout(): GridLayout {
    return this.currentLayout;
  }

  public setLayout(layout: GridLayout): void {
    this.currentLayout = layout;
    const requiredCount = layout === "1x1" ? 1 : layout === "1x2" ? 2 : 4;

    // Update grid classes on the container
    this.container.classList.remove(
      "grid-layout-1x1",
      "grid-layout-1x2",
      "grid-layout-2x2",
    );
    this.container.classList.add(`grid-layout-${layout}`);

    const currentKeys = Array.from(this.viewports.keys());

    // Create missing viewports
    for (let i = 0; i < requiredCount; i++) {
      const id = `vp-${i}`;
      if (!this.viewports.has(id)) {
        const vp = new Viewport(id, (selectedId) =>
          this.setActiveViewport(selectedId),
        );
        this.viewports.set(id, vp);
        this.container.appendChild(vp.cellElement);
      }
    }

    // Remove surplus viewports
    for (const key of currentKeys) {
      const index = parseInt(key.replace("vp-", ""), 10);
      if (index >= requiredCount) {
        this.viewports.get(key)?.destroy();
        this.viewports.delete(key);
      }
    }

    // Ensure a valid active viewport
    if (!this.activeViewportId || !this.viewports.has(this.activeViewportId)) {
      this.setActiveViewport("vp-0");
    } else {
      this.setActiveViewport(this.activeViewportId);
    }
  }

  public setActiveViewport(id: string): void {
    if (!this.viewports.has(id)) return;
    this.activeViewportId = id;
    for (const [vpId, vp] of this.viewports.entries()) {
      vp.setActive(vpId === id);
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("viewport-changed", { detail: { id } }),
      );
    }
  }

  public setSync(enabled: boolean): void {
    this.isSynchronized = enabled;
  }

  // ── Multi-viewport sync dispatcher ───────────────────────────────────────

  public dispatchPan(originId: string, dx: number, dy: number): void {
    this.viewports.get(originId)?.applyPanDelta(dx, dy);

    if (this.isSynchronized) {
      for (const [id, vp] of this.viewports.entries()) {
        if (id !== originId) vp.applyPanDelta(dx, dy);
      }
    }
  }

  public dispatchZoom(originId: string, factor: number): void {
    this.viewports.get(originId)?.applyZoomFactor(factor);

    if (this.isSynchronized) {
      for (const [id, vp] of this.viewports.entries()) {
        if (id !== originId) vp.applyZoomFactor(factor);
      }
    }
  }

  public dispatchWindowLevel(
    originId: string,
    dWidth: number,
    dCenter: number,
  ): void {
    this.viewports.get(originId)?.applyWindowLevelDelta(dWidth, dCenter);

    if (this.isSynchronized) {
      for (const [id, vp] of this.viewports.entries()) {
        if (id !== originId) vp.applyWindowLevelDelta(dWidth, dCenter);
      }
    }
  }

  public async dispatchSliceDelta(
    originId: string,
    delta: number,
    loadSliceFn: (vp: Viewport) => Promise<void>,
  ): Promise<void> {
    const origin = this.viewports.get(originId);
    if (!origin) return;

    if (origin.applySliceDelta(delta)) {
      await loadSliceFn(origin);
    }

    if (this.isSynchronized) {
      const syncPromises: Promise<void>[] = [];
      for (const [id, vp] of this.viewports.entries()) {
        if (id !== originId && vp.applySliceDelta(delta)) {
          syncPromises.push(loadSliceFn(vp));
        }
      }
      if (syncPromises.length > 0) {
        await Promise.all(syncPromises);
      }
    }
  }

  public destroy(): void {
    for (const vp of this.viewports.values()) {
      vp.destroy();
    }
    this.viewports.clear();
    this.activeViewportId = null;
  }
}
