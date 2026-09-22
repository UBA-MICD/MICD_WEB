/**
 * viewport-manager.ts — Multi-Viewport architecture and sync system (US-13).
 * Supports dynamic grid layouts (1x1, 1x2, 2x2) and synchronization of
 * camera transforms (Pan, Zoom, Window/Level, slice scroll) across viewports.
 */

import {
  type ParsedDicom,
  calculateAutoWindowLevel,
} from "../dicom/dicom-parser-util.js";
import {
  type ViewportState,
  renderDicom,
  applyCanvasTransform,
  createDefaultViewport,
  fitToContainer,
} from "../dicom/dicom-renderer.js";
import {
  getCanonicalFlip,
  getOrientationLabels,
} from "../dicom/spatial-math.js";
import { escapeHtml } from "../shared/dom.js";
import { mprEngine, type MPRPlane, type MPRVolumeData } from "./mpr-engine.js";
import { view3DViewer, type VoxelVolume } from "./view-3d.js";
import { state } from "./state.js";
import { renderMeasurementOverlay } from "./measurements/measurement-overlay.js";
import {
  renderSegmentationOverlay,
  type SegmentationLayer,
} from "./segmentation/segmentation-overlay.js";

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
  /** Segmentación de IA dibujada sobre este viewport (US-SEG). */
  segmentation?: SegmentationLayer | null;
  /**
   * Serie a la que pertenece el window/level actual. Cambia de serie ⇒ el W/L
   * se reinicia; mismo valor ⇒ se conserva al navegar entre cortes.
   */
  wlSeriesKey?: string | null;
  mlLabel?: string | null;
}

// ── Viewport Class ────────────────────────────────────────────────────────────

export class Viewport {
  public readonly id: string;
  public readonly cellElement: HTMLDivElement;
  public readonly canvasElement: HTMLCanvasElement;
  public readonly overlayCanvas: HTMLCanvasElement;
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
  public plane: MPRPlane = "axial";
  public data: ViewportData;
  public readonly glCanvasElement: HTMLCanvasElement;
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

    this.glCanvasElement = document.createElement("canvas");
    this.glCanvasElement.className = "viewport-canvas-gl";
    this.glCanvasElement.setAttribute("role", "presentation");

    this.canvasElement = document.createElement("canvas");
    this.canvasElement.className = "viewport-canvas";
    this.canvasElement.setAttribute("role", "img");
    this.canvasElement.setAttribute("aria-label", `Viewport ${id}`);

    this.overlayCanvas = document.createElement("canvas");
    this.overlayCanvas.className = "annotation-overlay";

    this.ctx = this.canvasElement.getContext("2d");

    // HUD overlays
    this.overlayTL = this.createDiv("overlay overlay--tl");
    this.overlayTR = this.createDiv("overlay overlay--tr");
    this.overlayBL = this.createDiv("overlay overlay--bl");
    this.overlayBR = this.createDiv("overlay overlay--br");

    // Cardinal orientation labels
    this.orientTop = this.createDiv(
      "viewport-orient-label viewport-orient-label--top mpr-orient-label mpr-orient-label--top",
    );
    this.orientBottom = this.createDiv(
      "viewport-orient-label viewport-orient-label--bottom mpr-orient-label mpr-orient-label--bottom",
    );
    this.orientLeft = this.createDiv(
      "viewport-orient-label viewport-orient-label--left mpr-orient-label mpr-orient-label--left",
    );
    this.orientRight = this.createDiv(
      "viewport-orient-label viewport-orient-label--right mpr-orient-label mpr-orient-label--right",
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
    this.cellElement.appendChild(this.glCanvasElement);
    this.cellElement.appendChild(this.canvasElement);
    this.cellElement.appendChild(this.overlayCanvas);
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
      const w = this.cellElement.clientWidth;
      const h = this.cellElement.clientHeight;
      if (w > 0 && h > 0) {
        if (this.canvasElement.width !== w) this.canvasElement.width = w;
        if (this.canvasElement.height !== h) this.canvasElement.height = h;
        if (this.glCanvasElement.width !== w) this.glCanvasElement.width = w;
        if (this.glCanvasElement.height !== h) this.glCanvasElement.height = h;
        if (this.overlayCanvas.width !== w) this.overlayCanvas.width = w;
        if (this.overlayCanvas.height !== h) this.overlayCanvas.height = h;
      }
      // Re-fit if zoom was calculated while the cell was hidden (zoom=0).
      if (this.data.viewport.zoom <= 0 && this.data.parsed?.metadata) {
        this.fitImage();
      }
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
    this.renderOverlay();
  }

  public applyZoomFactor(factor: number): void {
    this.data.viewport.zoom = Math.max(
      0.1,
      Math.min(10, this.data.viewport.zoom * factor),
    );
    if (this.data.segmentation?.visible) {
      // El contorno vive en el canvas de la imagen, en píxeles de imagen: el
      // CSS transform ya lo mueve y lo escala solo, pero el grosor del borde
      // se compensa por zoom, así que hay que repintarlo para que no engorde.
      // Guardado tras el `if` para no pagar un render completo sin segmentación.
      this.render();
      return;
    }
    this.applyTransform();
    this.updateInfoOverlay();
    this.renderOverlay();
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

  public fitImage(attempts = 0): void {
    if (!this.data.parsed?.metadata) return;
    const cw = this.cellElement.clientWidth;
    const ch = this.cellElement.clientHeight;
    // Right after a layout change the browser hasn't sized the cells yet, so
    // clientWidth/Height are 0 → fitToContainer would yield zoom 0 (black image
    // until "Reset"). Retry on the next frame until the cell has real size.
    if ((cw <= 0 || ch <= 0) && attempts < 20) {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => this.fitImage(attempts + 1));
      }
      return;
    }
    const { columns, rows } = this.data.parsed.metadata;
    this.data.viewport.zoom = fitToContainer(cw, ch, columns, rows);
    this.data.viewport.panX = 0;
    this.data.viewport.panY = 0;
    this.applyTransform();
    this.renderOverlay();
  }

  public resetCamera(): void {
    const parsed = this.data.parsed;
    if (!parsed?.metadata) return;
    // Prefer the DICOM's own window/level; when it carries none, derive one from
    // the pixels — otherwise createDefaultViewport() yields W/L 0 and the image
    // renders all black (the "reset shows a dark DICOM" bug in the comparison view).
    if (parsed.metadata.windowWidth > 0) {
      this.data.viewport = createDefaultViewport(parsed.metadata);
    } else if (parsed.pixelData) {
      const auto = calculateAutoWindowLevel(
        parsed.pixelData,
        parsed.metadata.rescaleSlope,
        parsed.metadata.rescaleIntercept,
        parsed.metadata.modality,
      );
      const { flipX, flipY } = getCanonicalFlip(
        parsed.metadata.imageOrientationPatient,
      );
      const vp: ViewportState = {
        windowCenter: auto.windowCenter,
        windowWidth: auto.windowWidth,
        zoom: 1,
        panX: 0,
        panY: 0,
      };
      if (flipX) vp.flipX = true;
      if (flipY) vp.flipY = true;
      this.data.viewport = vp;
    }
    this.fitImage();
    this.render();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  public render(): void {
    if (mprEngine.volume && state.isMprMode) {
      if (this.glCanvasElement) {
        this.glCanvasElement.style.display = "block";
        mprEngine.renderView(this.plane, this.glCanvasElement);
      }
      this.clear();
      if (this.ctx) {
        mprEngine.renderCrosshair(
          this.plane,
          this.ctx,
          this.canvasElement.width,
          this.canvasElement.height,
        );
      }
      this.updateOrientationLabels();
      this.updateInfoOverlay();
      return;
    }

    if (this.glCanvasElement) {
      this.glCanvasElement.style.display = "none";
    }

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

    // Sobre el canvas de la imagen, no sobre el de anotaciones: así el
    // contorno acompaña al zoom y al paneo por el mismo CSS transform.
    renderSegmentationOverlay({
      canvas: this.canvasElement,
      metadata: this.data.parsed.metadata,
      layer: this.data.segmentation,
      zoom: this.data.viewport.zoom,
    });

    this.applyTransform();
    this.updateInfoOverlay();
    this.updateOrientationLabels();

    if (mprEngine.volume && this.ctx) {
      mprEngine.renderCrosshair(
        this.plane,
        this.ctx,
        this.canvasElement.width,
        this.canvasElement.height,
      );
    }

    this.renderOverlay();
  }

  public renderOverlay(): void {
    if (!this.overlayCanvas || !this.data.parsed?.metadata) return;
    const w = this.cellElement.clientWidth || this.overlayCanvas.width || 300;
    const h = this.cellElement.clientHeight || this.overlayCanvas.height || 300;
    if (w > 0 && h > 0) {
      if (this.overlayCanvas.width !== w) this.overlayCanvas.width = w;
      if (this.overlayCanvas.height !== h) this.overlayCanvas.height = h;
    }

    renderMeasurementOverlay({
      canvas: this.overlayCanvas,
      viewport: this.data.viewport,
      metadata: this.data.parsed.metadata,
      pixelData: this.data.parsed.pixelData,
      sopInstanceUid:
        this.data.parsed.metadata.sopInstanceUid ||
        `slice_${this.data.currentIndex}`,
      cellId: this.id,
    });
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
    const ovCtx = this.overlayCanvas?.getContext("2d");
    ovCtx?.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
  }

  private updateOrientationLabels(): void {
    const hasData = Boolean(this.data.parsed?.pixelData);
    if (!hasData) {
      this.orientTop.textContent = "";
      this.orientBottom.textContent = "";
      this.orientLeft.textContent = "";
      this.orientRight.textContent = "";
      return;
    }

    if (state.isMprMode) {
      if (this.plane === "coronal") {
        this.orientTop.textContent = "S";
        this.orientBottom.textContent = "I";
        this.orientLeft.textContent = "R";
        this.orientRight.textContent = "L";
      } else if (this.plane === "sagittal") {
        this.orientTop.textContent = "S";
        this.orientBottom.textContent = "I";
        this.orientLeft.textContent = "A";
        this.orientRight.textContent = "P";
      } else {
        this.orientTop.textContent = "A";
        this.orientBottom.textContent = "P";
        this.orientLeft.textContent = "R";
        this.orientRight.textContent = "L";
      }
      return;
    }

    const iop = this.data.parsed?.metadata?.imageOrientationPatient;
    const labels = getOrientationLabels(iop);
    if (labels) {
      this.orientTop.textContent = labels.top;
      this.orientBottom.textContent = labels.bottom;
      this.orientLeft.textContent = labels.left;
      this.orientRight.textContent = labels.right;
    } else {
      this.orientTop.textContent = "";
      this.orientBottom.textContent = "";
      this.orientLeft.textContent = "";
      this.orientRight.textContent = "";
    }
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
    // The AI label ("IA: …") is info, so the top-bar info toggle hides it too.
    const showAi = this.data.mlLabel && state.areLabelsVisible !== false;
    this.overlayBR.innerHTML = `<div>Zoom: ${(zoom * 100).toFixed(0)}%</div><div>Slice: ${this.data.currentIndex + 1}/${totalItems}</div>${showAi ? `<div class="vp-overlay__ai">${escapeHtml(this.data.mlLabel as string)}</div>` : ""}`;
  }

  public destroy(): void {
    this.resizeObserver?.disconnect();
    this.glCanvasElement.remove();
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

  public setVolume(data: MPRVolumeData): void {
    mprEngine.loadVolume(data);
    view3DViewer.setVolume(data as unknown as VoxelVolume);
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
    const defaultPlanes: MPRPlane[] = ["axial", "coronal", "sagittal", "axial"];

    // Create missing viewports
    for (let i = 0; i < requiredCount; i++) {
      const id = `vp-${i}`;
      if (!this.viewports.has(id)) {
        const vp = new Viewport(id, (selectedId) =>
          this.setActiveViewport(selectedId),
        );
        vp.plane = defaultPlanes[i] || "axial";
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

  /**
   * Identifies whether the specified viewport ID corresponds to the top-right viewport.
   * In 2x2 and 1x2 grid layouts, 'vp-1' represents the top-right cell.
   */
  public isTopRightViewport(id: string): boolean {
    if (id === "vp-1") return true;
    const vp = this.viewports.get(id);
    if (!vp) return false;
    const cell = vp.cellElement;
    const containerRect = this.container.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    if (containerRect.width > 0 && containerRect.height > 0) {
      const isRightHalf =
        cellRect.left + cellRect.width / 2 >
        containerRect.left + containerRect.width / 2;
      const isTopHalf =
        cellRect.top + cellRect.height / 2 <
        containerRect.top + containerRect.height / 2;
      return isRightHalf && isTopHalf;
    }
    return false;
  }

  /**
   * Identifies whether the specified viewport ID corresponds to the combined 3D volume viewport.
   * In 2x2 grid layout, 'vp-3' represents the bottom-right cell (combined 3D / volume view).
   */
  public isCombined3DViewport(id: string): boolean {
    if (id === "vp-3") return true;
    const vp = this.viewports.get(id);
    if (!vp) return false;
    if (this.currentLayout === "2x2") {
      const cell = vp.cellElement;
      const containerRect = this.container.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      if (containerRect.width > 0 && containerRect.height > 0) {
        const isRightHalf =
          cellRect.left + cellRect.width / 2 >
          containerRect.left + containerRect.width / 2;
        const isBottomHalf =
          cellRect.top + cellRect.height / 2 >
          containerRect.top + containerRect.height / 2;
        return isRightHalf && isBottomHalf;
      }
    }
    return false;
  }

  // ── Multi-viewport sync dispatcher ───────────────────────────────────────

  public dispatchMprCrosshair(
    originId: string,
    deltaScreenX: number,
    deltaScreenY: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    // Clinical requirement: crosshair drag is enabled on the 3 orthogonal planes
    // (vp-0 Axial, vp-1 Coronal, vp-2 Sagittal) and strictly blocked on the
    // combined 3D volume viewport (vp-3).
    if (this.isCombined3DViewport(originId)) {
      return;
    }

    const origin = this.viewports.get(originId);
    if (!origin) return;

    mprEngine.applyCrosshairDelta2D(
      origin.plane,
      deltaScreenX,
      deltaScreenY,
      viewportWidth,
      viewportHeight,
    );

    // Re-render all viewports in real time reflecting synchronized cuts
    for (const vp of this.viewports.values()) {
      vp.render();
    }
  }

  public dispatchMprPan(
    originId: string,
    deltaScreenX: number,
    deltaScreenY: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const origin = this.viewports.get(originId);
    if (!origin) return;

    mprEngine.applyPanDelta2D(
      origin.plane,
      deltaScreenX,
      deltaScreenY,
      viewportWidth,
      viewportHeight,
    );

    for (const vp of this.viewports.values()) {
      vp.render();
    }
  }

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
