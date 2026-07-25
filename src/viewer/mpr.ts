import { ParsedDicom } from "../dicom/dicom-parser-util.js";
import { dicomCache } from "./cache.js";
import { $, showLoading, showError } from "../shared/dom.js";
import { state, itemCount } from "./state.js";

/**
 * MPR 3D Unified Viewport Module (US 2 Replaced)
 * Manages 3D voxel volume reconstruction using TypedArrays, software raycasting / 3D slice projection,
 * color-coded 3D Crosshair navigation (X=Red, Y=Green, Z=Blue), camera rotation/pan/zoom,
 * and 3D Orientation Gizmo rendering.
 */

export interface VoxelVolume {
  depth: number; // Z dimension
  rows: number; // Y dimension
  cols: number; // X dimension
  data: Int16Array | Uint16Array;
  pixelSpacing: [number, number]; // [rowSpacing (dy), colSpacing (dx)] in mm
  sliceSpacing: number; // dz in mm
  rescaleSlope: number;
  rescaleIntercept: number;
  windowCenter: number;
  windowWidth: number;
}

export interface Camera3D {
  theta: number; // Pitch angle in radians
  phi: number; // Yaw/Roll angle in radians
  zoom: number;
  panX: number;
  panY: number;
}

export interface Crosshair3D {
  x: number; // 0..cols-1
  y: number; // 0..rows-1
  z: number; // 0..depth-1
}

export class MPR3DViewer {
  public volume: VoxelVolume | null = null;
  public camera: Camera3D = { theta: 0, phi: 0, zoom: 1, panX: 0, panY: 0 };
  public crosshair: Crosshair3D = { x: 0, y: 0, z: 0 };
  public activeView: "axial" | "coronal" | "sagittal" = "axial";
  public isActive = false;

  private offscreenCanvas: HTMLCanvasElement = document.createElement("canvas");

  public async toggle3DMode(): Promise<boolean> {
    if (this.isActive) {
      this.isActive = false;
      state.is3DMode = false;
      return false;
    }

    const totalSlices = itemCount();
    if (totalSlices <= 1) {
      showError(
        "El estudio requiere al menos 2 cortes para la vista volumétrica 3D.",
      );
      return false;
    }

    showLoading(true);
    try {
      const parsedSlices: ParsedDicom[] = [];
      for (let i = 0; i < totalSlices; i++) {
        const parsed = await dicomCache.getOrFetch(i);
        if (!parsed || !parsed.pixelData) {
          throw new Error(
            `No se pudo obtener el píxel data del corte ${i + 1}`,
          );
        }
        parsedSlices.push(parsed);
      }

      this.volume = this.buildVolume(parsedSlices);
      this.crosshair = {
        x: Math.floor(this.volume.cols / 2),
        y: Math.floor(this.volume.rows / 2),
        z: Math.floor(this.volume.depth / 2),
      };

      const container = $("viewport-container");
      let fitZoom = 1;
      if (
        container &&
        container.clientWidth > 0 &&
        container.clientHeight > 0
      ) {
        fitZoom =
          Math.min(
            container.clientWidth / this.volume.cols,
            container.clientHeight / this.volume.rows,
          ) * 0.9;
      }

      this.camera = {
        theta: 0,
        phi: 0,
        zoom: fitZoom > 0 ? fitZoom : 1,
        panX: 0,
        panY: 0,
      };
      this.activeView = "axial";
      this.isActive = true;
      state.is3DMode = true;
      return true;
    } catch (err: any) {
      showError(`Error al cargar el volumen 3D: ${err.message || err}`);
      return false;
    } finally {
      showLoading(false);
    }
  }

  private buildVolume(slices: ParsedDicom[]): VoxelVolume {
    const depth = slices.length;
    const refMeta = slices[0].metadata;
    const rows = refMeta.rows;
    const cols = refMeta.columns;

    const rowSpacing = refMeta.pixelSpacing ? refMeta.pixelSpacing[0] : 1;
    const colSpacing = refMeta.pixelSpacing ? refMeta.pixelSpacing[1] : 1;

    let sliceSpacing =
      refMeta.spacingBetweenSlices || refMeta.sliceThickness || 1;
    const ipp0 = slices[0].metadata.imagePositionPatient;
    const ippN = slices[depth - 1].metadata.imagePositionPatient;
    if (depth > 1 && ipp0 && ippN) {
      const z0 = ipp0[2];
      const zN = ippN[2];
      const calcZ = Math.abs(zN - z0) / (depth - 1);
      if (calcZ > 0) sliceSpacing = calcZ;
    }

    const isSigned = refMeta.pixelRepresentation === 1;
    const slicePixels = rows * cols;
    const totalVoxels = depth * slicePixels;

    const data = isSigned
      ? new Int16Array(totalVoxels)
      : new Uint16Array(totalVoxels);

    for (let z = 0; z < depth; z++) {
      const p = slices[z].pixelData;
      if (p) data.set(p, z * slicePixels);
    }

    let windowCenter = refMeta.windowCenter;
    let windowWidth = refMeta.windowWidth;
    if (windowWidth <= 0 && state.viewport.windowWidth > 0) {
      windowCenter = state.viewport.windowCenter;
      windowWidth = state.viewport.windowWidth;
    }

    return {
      depth,
      rows,
      cols,
      data,
      pixelSpacing: [rowSpacing, colSpacing],
      sliceSpacing,
      rescaleSlope: refMeta.rescaleSlope,
      rescaleIntercept: refMeta.rescaleIntercept,
      windowCenter,
      windowWidth,
    };
  }

  /** Set quick orientation: Axial, Coronal, Sagittal. */
  public setOrientation(view: "axial" | "coronal" | "sagittal"): void {
    this.activeView = view;
    if (view === "axial") {
      this.camera.theta = 0;
      this.camera.phi = 0;
    } else if (view === "coronal") {
      this.camera.theta = Math.PI / 2;
      this.camera.phi = 0;
    } else if (view === "sagittal") {
      this.camera.theta = Math.PI / 2;
      this.camera.phi = Math.PI / 2;
    }
  }

  /** Update 3D Crosshair focal point from canvas click/drag coordinates. */
  public updateCrosshairFromPointer(
    clickX: number,
    clickY: number,
    canvasW: number,
    canvasH: number,
  ): void {
    if (!this.volume) return;
    const { depth, rows, cols } = this.volume;

    const centerCanvasX = canvasW / 2 + this.camera.panX + state.viewport.panX;
    const centerCanvasY = canvasH / 2 + this.camera.panY + state.viewport.panY;

    const totalZoom = this.camera.zoom * state.viewport.zoom;
    const relX = (clickX - centerCanvasX) / totalZoom;
    const relY = (clickY - centerCanvasY) / totalZoom;

    if (this.activeView === "axial") {
      this.crosshair.x = Math.max(
        0,
        Math.min(cols - 1, Math.round(relX + cols / 2)),
      );
      this.crosshair.y = Math.max(
        0,
        Math.min(rows - 1, Math.round(relY + rows / 2)),
      );
    } else if (this.activeView === "coronal") {
      this.crosshair.x = Math.max(
        0,
        Math.min(cols - 1, Math.round(relX + cols / 2)),
      );
      this.crosshair.z = Math.max(
        0,
        Math.min(depth - 1, Math.round(relY + depth / 2)),
      );
    } else {
      // Sagittal
      this.crosshair.y = Math.max(
        0,
        Math.min(rows - 1, Math.round(relX + rows / 2)),
      );
      this.crosshair.z = Math.max(
        0,
        Math.min(depth - 1, Math.round(relY + depth / 2)),
      );
    }
  }

  /** Get current slice depth index and total count for current active view. */
  public getDepthInfo(): { current: number; total: number } {
    if (!this.volume) return { current: 0, total: 1 };
    if (this.activeView === "axial") {
      return { current: this.crosshair.z, total: this.volume.depth };
    } else if (this.activeView === "coronal") {
      return { current: this.crosshair.y, total: this.volume.rows };
    } else {
      return { current: this.crosshair.x, total: this.volume.cols };
    }
  }

  /** Set current slice depth from right-side vertical depth slider. */
  public setDepthIndex(index: number): void {
    if (!this.volume) return;
    const { depth, rows, cols } = this.volume;
    if (this.activeView === "axial") {
      this.crosshair.z = Math.max(0, Math.min(depth - 1, index));
    } else if (this.activeView === "coronal") {
      this.crosshair.y = Math.max(0, Math.min(rows - 1, index));
    } else {
      this.crosshair.x = Math.max(0, Math.min(cols - 1, index));
    }
  }

  /** Render the 3D Unified Volume Viewport on the main canvas. */
  public render(canvas: HTMLCanvasElement): void {
    if (!this.volume || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const { depth, rows, cols, data, rescaleSlope, rescaleIntercept } =
      this.volume;

    const wc =
      state.viewport.windowWidth > 0
        ? state.viewport.windowCenter
        : this.volume.windowCenter;
    const ww =
      state.viewport.windowWidth > 0
        ? state.viewport.windowWidth
        : this.volume.windowWidth;

    const minW = wc - ww / 2;

    // 1. Render active 2D slice onto offscreen canvas
    if (this.activeView === "axial") {
      const z = Math.max(0, Math.min(depth - 1, this.crosshair.z));
      this.offscreenCanvas.width = cols;
      this.offscreenCanvas.height = rows;
      const offCtx = this.offscreenCanvas.getContext("2d")!;
      offCtx.imageSmoothingEnabled = true;
      offCtx.imageSmoothingQuality = "high";
      const imgData = offCtx.createImageData(cols, rows);
      const sliceOffset = z * rows * cols;

      for (let i = 0; i < rows * cols; i++) {
        const hu = data[sliceOffset + i] * rescaleSlope + rescaleIntercept;
        let val = 0;
        if (hu <= minW) val = 0;
        else if (hu >= minW + ww) val = 255;
        else val = Math.round(((hu - minW) / ww) * 255);

        const idx = i * 4;
        imgData.data[idx] = val;
        imgData.data[idx + 1] = val;
        imgData.data[idx + 2] = val;
        imgData.data[idx + 3] = 255;
      }
      offCtx.putImageData(imgData, 0, 0);
    } else if (this.activeView === "coronal") {
      const y = Math.max(0, Math.min(rows - 1, this.crosshair.y));
      this.offscreenCanvas.width = cols;
      this.offscreenCanvas.height = depth;
      const offCtx = this.offscreenCanvas.getContext("2d")!;
      offCtx.imageSmoothingEnabled = true;
      offCtx.imageSmoothingQuality = "high";
      const imgData = offCtx.createImageData(cols, depth);

      for (let z = 0; z < depth; z++) {
        const zRowOffset = z * rows * cols + y * cols;
        for (let x = 0; x < cols; x++) {
          const hu = data[zRowOffset + x] * rescaleSlope + rescaleIntercept;
          let val = 0;
          if (hu <= minW) val = 0;
          else if (hu >= minW + ww) val = 255;
          else val = Math.round(((hu - minW) / ww) * 255);

          const idx = (z * cols + x) * 4;
          imgData.data[idx] = val;
          imgData.data[idx + 1] = val;
          imgData.data[idx + 2] = val;
          imgData.data[idx + 3] = 255;
        }
      }
      offCtx.putImageData(imgData, 0, 0);
    } else {
      // Sagittal
      const x = Math.max(0, Math.min(cols - 1, this.crosshair.x));
      this.offscreenCanvas.width = rows;
      this.offscreenCanvas.height = depth;
      const offCtx = this.offscreenCanvas.getContext("2d")!;
      offCtx.imageSmoothingEnabled = true;
      offCtx.imageSmoothingQuality = "high";
      const imgData = offCtx.createImageData(rows, depth);

      for (let z = 0; z < depth; z++) {
        const zOffset = z * rows * cols + x;
        for (let y = 0; y < rows; y++) {
          const hu = data[zOffset + y * cols] * rescaleSlope + rescaleIntercept;
          let val = 0;
          if (hu <= minW) val = 0;
          else if (hu >= minW + ww) val = 255;
          else val = Math.round(((hu - minW) / ww) * 255);

          const idx = (z * rows + y) * 4;
          imgData.data[idx] = val;
          imgData.data[idx + 1] = val;
          imgData.data[idx + 2] = val;
          imgData.data[idx + 3] = 255;
        }
      }
      offCtx.putImageData(imgData, 0, 0);
    }

    // 2. Draw volume slice and crosshair centered on main viewport canvas
    ctx.save();
    ctx.translate(
      width / 2 + this.camera.panX + state.viewport.panX,
      height / 2 + this.camera.panY + state.viewport.panY,
    );

    const totalZoom = this.camera.zoom * state.viewport.zoom;
    ctx.scale(totalZoom, totalZoom);
    ctx.rotate(this.camera.phi);

    const drawW = this.offscreenCanvas.width;
    const drawH = this.offscreenCanvas.height;

    // Draw main volume image
    ctx.drawImage(this.offscreenCanvas, -drawW / 2, -drawH / 2, drawW, drawH);

    // 3. Render 3D Crosshair with color-coded axes (Red=X, Green=Y, Blue=Z)
    this.draw3DCrosshair(ctx, drawW, drawH);

    ctx.restore();

    // Render 3D orientation gizmo on widget canvas
    const gizmoCanvas = $("mpr-gizmo-canvas") as HTMLCanvasElement | null;
    if (gizmoCanvas) {
      this.renderGizmo(gizmoCanvas);
    }
  }

  /** Helper method to draw a high-contrast line with a 3px black outline. */
  private drawOutlinedLine(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
  ): void {
    // Outer black border (3px) for maximum contrast against bone (white) and air (black)
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Inner vibrant line (1.5px)
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  /** Render 3D Crosshair lines intersecting focal point (x, y, z). */
  private draw3DCrosshair(
    ctx: CanvasRenderingContext2D,
    drawW: number,
    drawH: number,
  ): void {
    if (!this.volume) return;
    const { depth, rows, cols } = this.volume;

    let focalX = 0;
    let focalY = 0;

    if (this.activeView === "axial") {
      focalX = this.crosshair.x - cols / 2;
      focalY = this.crosshair.y - rows / 2;

      // X Axis line (Red #ff4444) with black outline
      this.drawOutlinedLine(
        ctx,
        -drawW / 2,
        focalY,
        drawW / 2,
        focalY,
        "#ff4444",
      );

      // Y Axis line (Green #00e676) with black outline
      this.drawOutlinedLine(
        ctx,
        focalX,
        -drawH / 2,
        focalX,
        drawH / 2,
        "#00e676",
      );
    } else if (this.activeView === "coronal") {
      focalX = this.crosshair.x - cols / 2;
      focalY = this.crosshair.z - depth / 2;

      // X Axis line (Red #ff4444) with black outline
      this.drawOutlinedLine(
        ctx,
        -drawW / 2,
        focalY,
        drawW / 2,
        focalY,
        "#ff4444",
      );

      // Z Axis line (Blue #29b6f6) with black outline
      this.drawOutlinedLine(
        ctx,
        focalX,
        -drawH / 2,
        focalX,
        drawH / 2,
        "#29b6f6",
      );
    } else {
      // Sagittal
      focalX = this.crosshair.y - rows / 2;
      focalY = this.crosshair.z - depth / 2;

      // Y Axis line (Green #00e676) with black outline
      this.drawOutlinedLine(
        ctx,
        -drawW / 2,
        focalY,
        drawW / 2,
        focalY,
        "#00e676",
      );

      // Z Axis line (Blue #29b6f6) with black outline
      this.drawOutlinedLine(
        ctx,
        focalX,
        -drawH / 2,
        focalX,
        drawH / 2,
        "#29b6f6",
      );
    }

    // High-contrast focal point ring indicator
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(focalX, focalY, 4, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(focalX, focalY, 4, 0, 2 * Math.PI);
    ctx.stroke();
  }

  /** Render 3D Orientation Gizmo (bottom-right widget). */
  public renderGizmo(canvas: HTMLCanvasElement): void {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const len = 20;

    ctx.clearRect(0, 0, w, h);

    const cosT = Math.cos(this.camera.theta);
    const sinT = Math.sin(this.camera.theta);
    const cosP = Math.cos(this.camera.phi);
    const sinP = Math.sin(this.camera.phi);

    // Projected 3D axes
    const x2d = { x: len * cosP, y: len * sinP * sinT };
    const y2d = { x: -len * sinP, y: len * cosP * sinT };
    const z2d = { x: 0, y: -len * cosT };

    // X Axis (Red)
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + x2d.x, cy + x2d.y);
    ctx.stroke();
    ctx.fillStyle = "#ff4444";
    ctx.font = "bold 9px sans-serif";
    ctx.fillText("X", cx + x2d.x + (x2d.x >= 0 ? 3 : -8), cy + x2d.y + 3);

    // Y Axis (Green)
    ctx.strokeStyle = "#00e676";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + y2d.x, cy + y2d.y);
    ctx.stroke();
    ctx.fillStyle = "#00e676";
    ctx.fillText("Y", cx + y2d.x + (y2d.x >= 0 ? 3 : -8), cy + y2d.y + 3);

    // Z Axis (Blue)
    ctx.strokeStyle = "#29b6f6";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + z2d.x, cy + z2d.y);
    ctx.stroke();
    ctx.fillStyle = "#29b6f6";
    ctx.fillText("Z", cx + z2d.x + 3, cy + z2d.y - 2);
  }
}

export const mpr3DViewer = new MPR3DViewer();
