import { ParsedDicom, DicomMetadata } from "../dicom/dicom-parser-util.js";
import { dicomCache } from "./cache.js";
import { $, showLoading, showError } from "../shared/dom.js";
import { state, itemCount } from "./state.js";

/**
 * MPR (Multiplanar Reconstruction) Module
 * Generates 3D voxel volume (Z x Y x X) using TypedArrays and renders
 * synchronized Axial, Coronal, and Sagittal orthogonal views with an interactive crosshair.
 */

export interface VoxelVolume {
  depth: number; // Z dimension (slices)
  rows: number; // Y dimension (height)
  cols: number; // X dimension (width)
  data: Int16Array | Uint16Array;
  pixelSpacing: [number, number]; // [rowSpacing (dy), colSpacing (dx)] in mm
  sliceSpacing: number; // dz in mm
  rescaleSlope: number;
  rescaleIntercept: number;
  windowCenter: number;
  windowWidth: number;
}

export interface CrosshairPosition {
  x: number; // 0..cols-1
  y: number; // 0..rows-1
  z: number; // 0..depth-1
}

class MPRViewer {
  private volume: VoxelVolume | null = null;
  private crosshair: CrosshairPosition = { x: 0, y: 0, z: 0 };
  private activePlaneDrag: "axial" | "coronal" | "sagittal" | null = null;
  private isOpen = false;

  // Offscreen canvases for fast pixel rendering
  private offscreenAxial: HTMLCanvasElement = document.createElement("canvas");
  private offscreenCoronal: HTMLCanvasElement =
    document.createElement("canvas");
  private offscreenSagittal: HTMLCanvasElement =
    document.createElement("canvas");

  public async openMPR(): Promise<void> {
    showLoading(true);
    try {
      // 1. Fetch/ensure all slices in memory
      const totalSlices = itemCount();
      if (totalSlices <= 1) {
        showError("El estudio requiere al menos 2 cortes para la vista MPR.");
        return;
      }

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

      // 2. Build 3D volume using TypedArrays for performance
      this.volume = this.buildVolume(parsedSlices);

      // 3. Initialize crosshair to middle of volume
      this.crosshair = {
        x: Math.floor(this.volume.cols / 2),
        y: Math.floor(this.volume.rows / 2),
        z: Math.floor(this.volume.depth / 2),
      };

      // 4. Setup UI elements & event handlers
      this.setupUI();
      this.isOpen = true;
      this.renderAll();
      $("mpr-container").classList.remove("hidden");
    } catch (err: any) {
      showError(
        `Error al inicializar la reconstrucción MPR: ${err.message || err}`,
      );
    } finally {
      showLoading(false);
    }
  }

  public closeMPR(): void {
    this.isOpen = false;
    $("mpr-container").classList.add("hidden");
    this.volume = null;
  }

  /** Construct a contiguous 3D TypedArray buffer from 2D slices. */
  private buildVolume(slices: ParsedDicom[]): VoxelVolume {
    const depth = slices.length;
    const refMeta = slices[0].metadata;
    const rows = refMeta.rows;
    const cols = refMeta.columns;

    const rowSpacing = refMeta.pixelSpacing ? refMeta.pixelSpacing[0] : 1;
    const colSpacing = refMeta.pixelSpacing ? refMeta.pixelSpacing[1] : 1;

    // Calculate Z slice spacing from ImagePositionPatient
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
      const slicePixelData = slices[z].pixelData;
      if (slicePixelData) {
        data.set(slicePixelData, z * slicePixels);
      }
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

  private setupUI(): void {
    if (!this.volume) return;

    const { depth, rows, cols } = this.volume;

    // Set slider bounds
    const sliderAxial = $("mpr-slider-axial") as HTMLInputElement;
    sliderAxial.min = "0";
    sliderAxial.max = String(depth - 1);
    sliderAxial.value = String(this.crosshair.z);

    const sliderCoronal = $("mpr-slider-coronal") as HTMLInputElement;
    sliderCoronal.min = "0";
    sliderCoronal.max = String(rows - 1);
    sliderCoronal.value = String(this.crosshair.y);

    const sliderSagittal = $("mpr-slider-sagittal") as HTMLInputElement;
    sliderSagittal.min = "0";
    sliderSagittal.max = String(cols - 1);
    sliderSagittal.value = String(this.crosshair.x);

    // Bind slider input events
    sliderAxial.oninput = () => {
      this.crosshair.z = parseInt(sliderAxial.value, 10);
      this.renderAll();
    };
    sliderCoronal.oninput = () => {
      this.crosshair.y = parseInt(sliderCoronal.value, 10);
      this.renderAll();
    };
    sliderSagittal.oninput = () => {
      this.crosshair.x = parseInt(sliderSagittal.value, 10);
      this.renderAll();
    };

    // Close button
    $("mpr-close-btn").onclick = () => this.closeMPR();

    // Mouse interaction for Crosshair sync
    this.attachCanvasInteraction("mpr-canvas-axial", "axial");
    this.attachCanvasInteraction("mpr-canvas-coronal", "coronal");
    this.attachCanvasInteraction("mpr-canvas-sagittal", "sagittal");
  }

  private attachCanvasInteraction(
    canvasId: string,
    plane: "axial" | "coronal" | "sagittal",
  ): void {
    const canvas = $(canvasId) as HTMLCanvasElement;

    const handlePointer = (e: MouseEvent) => {
      if (!this.volume) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const normX = Math.max(0, Math.min(1, clickX / rect.width));
      const normY = Math.max(0, Math.min(1, clickY / rect.height));

      const { depth, rows, cols } = this.volume;

      if (plane === "axial") {
        // Axial: X -> cols, Y -> rows
        this.crosshair.x = Math.round(normX * (cols - 1));
        this.crosshair.y = Math.round(normY * (rows - 1));
      } else if (plane === "coronal") {
        // Coronal: X -> cols, Y -> depth (Z)
        this.crosshair.x = Math.round(normX * (cols - 1));
        this.crosshair.z = Math.round(normY * (depth - 1));
      } else if (plane === "sagittal") {
        // Sagittal: X -> rows, Y -> depth (Z)
        this.crosshair.y = Math.round(normX * (rows - 1));
        this.crosshair.z = Math.round(normY * (depth - 1));
      }

      this.renderAll();
    };

    canvas.onmousedown = (e: MouseEvent) => {
      this.activePlaneDrag = plane;
      handlePointer(e);
    };

    document.addEventListener("mousemove", (e: MouseEvent) => {
      if (this.activePlaneDrag === plane) {
        handlePointer(e);
      }
    });

    document.addEventListener("mouseup", () => {
      if (this.activePlaneDrag === plane) {
        this.activePlaneDrag = null;
      }
    });
  }

  /** Render all 3 views and update sliders/labels. */
  private renderAll(): void {
    if (!this.volume || !this.isOpen) return;

    this.renderAxial();
    this.renderCoronal();
    this.renderSagittal();

    // Update labels and sliders
    ($("mpr-slider-axial") as HTMLInputElement).value = String(
      this.crosshair.z,
    );
    $("mpr-val-axial").textContent =
      `${this.crosshair.z + 1} / ${this.volume.depth}`;

    ($("mpr-slider-coronal") as HTMLInputElement).value = String(
      this.crosshair.y,
    );
    $("mpr-val-coronal").textContent =
      `${this.crosshair.y + 1} / ${this.volume.rows}`;

    ($("mpr-slider-sagittal") as HTMLInputElement).value = String(
      this.crosshair.x,
    );
    $("mpr-val-sagittal").textContent =
      `${this.crosshair.x + 1} / ${this.volume.cols}`;
  }

  /** Axial View (XY at fixed Z) */
  private renderAxial(): void {
    if (!this.volume) return;
    const {
      depth,
      rows,
      cols,
      data,
      rescaleSlope,
      rescaleIntercept,
      windowCenter,
      windowWidth,
    } = this.volume;
    const z = Math.max(0, Math.min(depth - 1, this.crosshair.z));

    this.offscreenAxial.width = cols;
    this.offscreenAxial.height = rows;
    const ctxOff = this.offscreenAxial.getContext("2d")!;
    const imgData = ctxOff.createImageData(cols, rows);

    const sliceOffset = z * rows * cols;
    const minW = windowCenter - windowWidth / 2;

    for (let i = 0; i < rows * cols; i++) {
      const hu = data[sliceOffset + i] * rescaleSlope + rescaleIntercept;
      let val = 0;
      if (hu <= minW) val = 0;
      else if (hu >= windowCenter + windowWidth / 2) val = 255;
      else val = Math.round(((hu - minW) / windowWidth) * 255);

      const idx = i * 4;
      imgData.data[idx] = val;
      imgData.data[idx + 1] = val;
      imgData.data[idx + 2] = val;
      imgData.data[idx + 3] = 255;
    }
    ctxOff.putImageData(imgData, 0, 0);

    const displayCanvas = $("mpr-canvas-axial") as HTMLCanvasElement;
    displayCanvas.width = cols;
    displayCanvas.height = rows;
    const ctx = displayCanvas.getContext("2d")!;
    ctx.drawImage(this.offscreenAxial, 0, 0);

    // Crosshair (Cyan & Yellow)
    this.drawCrosshair(
      ctx,
      cols,
      rows,
      this.crosshair.x,
      this.crosshair.y,
      "#00c8ff",
      "#ffd700",
    );
  }

  /** Coronal View (XZ at fixed Y) */
  private renderCoronal(): void {
    if (!this.volume) return;
    const {
      depth,
      rows,
      cols,
      data,
      rescaleSlope,
      rescaleIntercept,
      windowCenter,
      windowWidth,
    } = this.volume;
    const y = Math.max(0, Math.min(rows - 1, this.crosshair.y));

    this.offscreenCoronal.width = cols;
    this.offscreenCoronal.height = depth;
    const ctxOff = this.offscreenCoronal.getContext("2d")!;
    const imgData = ctxOff.createImageData(cols, depth);

    const minW = windowCenter - windowWidth / 2;

    for (let z = 0; z < depth; z++) {
      const zRowOffset = z * rows * cols + y * cols;
      for (let x = 0; x < cols; x++) {
        const hu = data[zRowOffset + x] * rescaleSlope + rescaleIntercept;
        let val = 0;
        if (hu <= minW) val = 0;
        else if (hu >= windowCenter + windowWidth / 2) val = 255;
        else val = Math.round(((hu - minW) / windowWidth) * 255);

        const idx = (z * cols + x) * 4;
        imgData.data[idx] = val;
        imgData.data[idx + 1] = val;
        imgData.data[idx + 2] = val;
        imgData.data[idx + 3] = 255;
      }
    }
    ctxOff.putImageData(imgData, 0, 0);

    const displayCanvas = $("mpr-canvas-coronal") as HTMLCanvasElement;
    displayCanvas.width = cols;
    displayCanvas.height = depth;
    const ctx = displayCanvas.getContext("2d")!;
    ctx.drawImage(this.offscreenCoronal, 0, 0);

    // Crosshair (Cyan & Magenta)
    this.drawCrosshair(
      ctx,
      cols,
      depth,
      this.crosshair.x,
      this.crosshair.z,
      "#00c8ff",
      "#ff00ff",
    );
  }

  /** Sagittal View (YZ at fixed X) */
  private renderSagittal(): void {
    if (!this.volume) return;
    const {
      depth,
      rows,
      cols,
      data,
      rescaleSlope,
      rescaleIntercept,
      windowCenter,
      windowWidth,
    } = this.volume;
    const x = Math.max(0, Math.min(cols - 1, this.crosshair.x));

    this.offscreenSagittal.width = rows;
    this.offscreenSagittal.height = depth;
    const ctxOff = this.offscreenSagittal.getContext("2d")!;
    const imgData = ctxOff.createImageData(rows, depth);

    const minW = windowCenter - windowWidth / 2;

    for (let z = 0; z < depth; z++) {
      const zOffset = z * rows * cols + x;
      for (let y = 0; y < rows; y++) {
        const hu = data[zOffset + y * cols] * rescaleSlope + rescaleIntercept;
        let val = 0;
        if (hu <= minW) val = 0;
        else if (hu >= windowCenter + windowWidth / 2) val = 255;
        else val = Math.round(((hu - minW) / windowWidth) * 255);

        const idx = (z * rows + y) * 4;
        imgData.data[idx] = val;
        imgData.data[idx + 1] = val;
        imgData.data[idx + 2] = val;
        imgData.data[idx + 3] = 255;
      }
    }
    ctxOff.putImageData(imgData, 0, 0);

    const displayCanvas = $("mpr-canvas-sagittal") as HTMLCanvasElement;
    displayCanvas.width = rows;
    displayCanvas.height = depth;
    const ctx = displayCanvas.getContext("2d")!;
    ctx.drawImage(this.offscreenSagittal, 0, 0);

    // Crosshair (Yellow & Magenta)
    this.drawCrosshair(
      ctx,
      rows,
      depth,
      this.crosshair.y,
      this.crosshair.z,
      "#ffd700",
      "#ff00ff",
    );
  }

  private drawCrosshair(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    cx: number,
    cy: number,
    colorVert: string,
    colorHoriz: string,
  ): void {
    ctx.lineWidth = 1;

    // Vertical crosshair line
    ctx.strokeStyle = colorVert;
    ctx.beginPath();
    ctx.moveTo(cx + 0.5, 0);
    ctx.lineTo(cx + 0.5, height);
    ctx.stroke();

    // Horizontal crosshair line
    ctx.strokeStyle = colorHoriz;
    ctx.beginPath();
    ctx.moveTo(0, cy + 0.5);
    ctx.lineTo(width, cy + 0.5);
    ctx.stroke();
  }
}

export const mprViewer = new MPRViewer();
