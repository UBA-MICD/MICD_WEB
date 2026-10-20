/**
 * mpr-coordinator.ts — Centralized State Manager for Synchronized 2x2 MPR Grid (US-50 Phase 1).
 *
 * Responsibilities:
 *  - Single source of truth for the 3D focal crosshair position C = [x, y, z].
 *  - Bi-directional synchronization between the 3 orthogonal slice cameras
 *    (Axial, Coronal, Sagittal in MPREngine) and the 3D volumetric raymarcher (View3DViewer).
 *  - Maximization state and 1x1 toggle logic for multi-viewport quadrants.
 */

import { Matrix3, mprEngine, type MPRPlane } from "./mpr-engine.js";
import {
  applyPitchYawDeltaQuat,
  matrix3ToQuat,
  matrixToPitchYaw,
  orthonormalize,
  quatToMatrix3,
  type Quat,
} from "./mpr-rotation.js";
import { view3DViewer } from "./view-3d.js";
import { getViewportManager } from "./viewport-registry.js";

export interface Crosshair3D {
  x: number; // 0..cols-1 (Sagittal cut coordinate / Left-Right)
  y: number; // 0..rows-1 (Coronal cut coordinate / Anterior-Posterior)
  z: number; // 0..depth-1 (Axial cut coordinate / Inferior-Superior)
}

export type QuadrantType = "axial" | "sagittal" | "coronal" | "3d";

export class MPRGridCoordinator {
  public crosshair: Crosshair3D = { x: 0, y: 0, z: 0 };
  public rotation: Float32Array = Matrix3.identity();
  public dimensions: { cols: number; rows: number; depth: number } = {
    cols: 1,
    rows: 1,
    depth: 1,
  };
  public maximizedQuadrant: string | null = null;
  private listeners: Array<(c: Crosshair3D) => void> = [];
  private rotationListeners: Array<(r: Float32Array) => void> = [];
  /**
   * Unit-quaternion mirror of `rotation` (spec 007). The trackball accumulates
   * here to avoid Float32 matrix drift; every other writer of `rotation` re-syncs it.
   */
  private rotationQuat: Quat = [1, 0, 0, 0];

  /**
   * Initializes the crosshair at the geometric center of the volume.
   */
  public initFromVolume(cols: number, rows: number, depth: number): void {
    this.dimensions = {
      cols: Math.max(1, cols),
      rows: Math.max(1, rows),
      depth: Math.max(1, depth),
    };
    this.crosshair = {
      x: Math.floor(cols / 2),
      y: Math.floor(rows / 2),
      z: Math.floor(depth / 2),
    };
    this.syncEngines();
  }

  /**
   * Sets the 3D crosshair position in voxel indices [0..dim-1] and synchronizes all engines.
   */
  public setCrosshair(x: number, y: number, z: number): void {
    const dims = this.getDimensions();
    this.crosshair.x = Math.max(0, Math.min(dims.cols - 1, Math.round(x)));
    this.crosshair.y = Math.max(0, Math.min(dims.rows - 1, Math.round(y)));
    this.crosshair.z = Math.max(0, Math.min(dims.depth - 1, Math.round(z)));
    this.syncEngines();
    this.notifyListeners();
  }

  /**
   * Updates normalized crosshair coordinates [0..1]^3.
   */
  public setCrosshairFromNormalized(nx: number, ny: number, nz: number): void {
    const dims = this.getDimensions();
    this.setCrosshair(
      nx * Math.max(1, dims.cols - 1),
      ny * Math.max(1, dims.rows - 1),
      nz * Math.max(1, dims.depth - 1),
    );
  }

  /**
   * Updates the slice position for a specific plane (Axial: Z, Coronal: Y, Sagittal: X).
   */
  public setSliceIndex(plane: MPRPlane | "3d", index: number): void {
    const dims = this.getDimensions();
    if (plane === "axial" || plane === "3d") {
      this.crosshair.z = Math.max(
        0,
        Math.min(dims.depth - 1, Math.round(index)),
      );
    } else if (plane === "coronal") {
      this.crosshair.y = Math.max(
        0,
        Math.min(dims.rows - 1, Math.round(index)),
      );
    } else if (plane === "sagittal") {
      this.crosshair.x = Math.max(
        0,
        Math.min(dims.cols - 1, Math.round(index)),
      );
    }
    this.syncEngines();
    this.notifyListeners();
  }

  /**
   * Gets current slice index for a given plane.
   */
  public getSliceIndex(plane: MPRPlane | "3d"): number {
    if (plane === "axial" || plane === "3d") {
      return this.crosshair.z;
    } else if (plane === "coronal") {
      return this.crosshair.y;
    } else {
      return this.crosshair.x;
    }
  }

  /**
   * Updates a single crosshair axis coordinate without altering the other two.
   *  - "x" or "sagittal" -> updates crosshair.x (cols)
   *  - "y" or "coronal"  -> updates crosshair.y (rows)
   *  - "z" or "axial"    -> updates crosshair.z (depth)
   */
  public updateCrosshairAxis(
    axis: "x" | "y" | "z" | "sagittal" | "coronal" | "axial",
    value: number,
  ): void {
    const dims = this.getDimensions();
    const val = Math.round(value);
    if (axis === "x" || axis === "sagittal") {
      this.crosshair.x = Math.max(0, Math.min(dims.cols - 1, val));
    } else if (axis === "y" || axis === "coronal") {
      this.crosshair.y = Math.max(0, Math.min(dims.rows - 1, val));
    } else if (axis === "z" || axis === "axial") {
      this.crosshair.z = Math.max(0, Math.min(dims.depth - 1, val));
    }
    this.syncEngines();
    this.notifyListeners();
  }

  /**
   * Sets the 3x3 rotation matrix for oblique slicing and synchronizes engines.
   */
  public setRotation(r: Float32Array): void {
    this.rotation = new Float32Array(r);
    this.rotationQuat = matrix3ToQuat(this.rotation);
    mprEngine.setRotation(this.rotation);
    this.syncEngines();
    this.notifyRotationListeners();
    this.notifyListeners();
  }

  /**
   * Applies an incremental rotation around an arbitrary 3D axis vector.
   */
  public rotateAroundAxis(axis: [number, number, number], rad: number): void {
    const rot = Matrix3.fromRotationAxis(axis, rad);
    this.rotation = Matrix3.multiply(rot, this.rotation);
    this.rotationQuat = matrix3ToQuat(this.rotation);
    mprEngine.setRotation(this.rotation);
    this.syncEngines();
    this.notifyRotationListeners();
    this.notifyListeners();
  }

  /**
   * Resets rotation back to canonical Cartesian axes.
   */
  public resetRotation(): void {
    this.rotation = Matrix3.identity();
    this.rotationQuat = [1, 0, 0, 0];
    mprEngine.resetRotation();
    this.syncEngines();
    this.notifyRotationListeners();
    this.notifyListeners();
  }

  /**
   * Trackball rotation (spec 007): turns the whole orthogonal triad by `dPitch`
   * around the horizontal screen axis and `dYaw` around the vertical screen axis
   * of `activePlane`, both in radians and in volume space. A zero or non-finite
   * delta is a no-op (no listener churn).
   */
  public rotatePitchYaw(
    dPitch: number,
    dYaw: number,
    activePlane: MPRPlane,
  ): void {
    if (!Number.isFinite(dPitch) || !Number.isFinite(dYaw)) return;
    if (dPitch === 0 && dYaw === 0) return;

    const camera = mprEngine.getCamera(activePlane);
    // Right-handed vertical axis for screen yaw: turns normal towards uAxis (screen right).
    const yawAxis: [number, number, number] = [
      camera.normal[1] * camera.uAxis[2] - camera.normal[2] * camera.uAxis[1],
      camera.normal[2] * camera.uAxis[0] - camera.normal[0] * camera.uAxis[2],
      camera.normal[0] * camera.uAxis[1] - camera.normal[1] * camera.uAxis[0],
    ];

    this.rotationQuat = applyPitchYawDeltaQuat(
      this.rotationQuat,
      camera.uAxis,
      yawAxis,
      dPitch,
      dYaw,
    );

    let next = quatToMatrix3(this.rotationQuat);
    if (!Matrix3.isOrthonormal(next, 1e-4)) {
      next = orthonormalize(next);
      this.rotationQuat = matrix3ToQuat(next);
    }

    // A fresh array each time: listeners may hold the previous rotation.
    this.rotation = next;
    mprEngine.setRotation(this.rotation);
    this.syncEngines();
    this.notifyRotationListeners();
    this.notifyListeners();
  }

  /**
   * Pitch/Yaw read-out of the accumulated rotation, in degrees rounded to 0.1.
   * Derived from the matrix (display only), so it never drifts out of sync.
   */
  public getPitchYawDegrees(): { pitch: number; yaw: number } {
    const { pitch, yaw } = matrixToPitchYaw(this.rotation);
    const toDegrees = (rad: number): number =>
      Math.round(((rad * 180) / Math.PI) * 10) / 10 || 0; // `|| 0` folds −0 into 0
    return { pitch: toDegrees(pitch), yaw: toDegrees(yaw) };
  }

  /**
   * Back to the orthogonal anatomical planes (Axial/Coronal/Sagittal). Only the
   * rotation changes: crosshair position, zoom and pan are kept, and rotation
   * listeners fire once.
   */
  public resetToOrthogonal(): void {
    this.resetRotation();
  }

  /**
   * Subscribes to rotation changes.
   */
  public onRotationChange(cb: (r: Float32Array) => void): () => void {
    this.rotationListeners.push(cb);
    return () => {
      this.rotationListeners = this.rotationListeners.filter((l) => l !== cb);
    };
  }

  private notifyRotationListeners(): void {
    for (const cb of this.rotationListeners) {
      cb(this.rotation);
    }
  }

  /**
   * Synchronizes crosshair coordinates to both MPREngine and View3DViewer instances.
   */
  public syncEngines(): void {
    const dims = this.getDimensions();
    const nx = dims.cols > 1 ? this.crosshair.x / (dims.cols - 1) : 0.5;
    const ny = dims.rows > 1 ? this.crosshair.y / (dims.rows - 1) : 0.5;
    const nz = dims.depth > 1 ? this.crosshair.z / (dims.depth - 1) : 0.5;

    // Sync MPREngine slice cameras, rotation & normalized crosshair
    mprEngine.setRotation(this.rotation);
    if (mprEngine.volume) {
      mprEngine.crosshairNormalized = [nx, ny, nz];
      mprEngine.setSliceIndex("axial", this.crosshair.z);
      mprEngine.setSliceIndex("coronal", this.crosshair.y);
      mprEngine.setSliceIndex("sagittal", this.crosshair.x);
    }

    // Sync View3DViewer crosshair
    view3DViewer.crosshair.x = this.crosshair.x;
    view3DViewer.crosshair.y = this.crosshair.y;
    view3DViewer.crosshair.z = this.crosshair.z;
  }

  /**
   * Toggles maximization (1x1 fullscreen mode) on a specific quadrant.
   */
  public toggleMaximize(quadrantId: string): void {
    if (this.maximizedQuadrant === quadrantId) {
      this.maximizedQuadrant = null;
    } else {
      this.maximizedQuadrant = quadrantId;
    }
    this.applyMaximizationUI();
  }

  /**
   * Applies fullscreen CSS classes to the maximized quadrant and hides siblings.
   */
  public applyMaximizationUI(): void {
    const container = document.querySelector(
      ".mpr-grid-container, #viewport-container",
    );
    if (!container) return;

    const cells = container.querySelectorAll(".viewport-cell");
    cells.forEach((cell) => {
      const el = cell as HTMLElement;
      const isTarget =
        el.id === this.maximizedQuadrant ||
        el.dataset.viewportId === this.maximizedQuadrant;
      if (this.maximizedQuadrant) {
        el.classList.toggle("is-maximized", isTarget);
        el.classList.toggle("is-hidden-by-maximize", !isTarget);
      } else {
        el.classList.remove("is-maximized", "is-hidden-by-maximize");
      }
    });

    container.classList.toggle(
      "mpr-has-maximized",
      Boolean(this.maximizedQuadrant),
    );

    // Re-render viewports after layout resize
    const manager = getViewportManager();
    if (manager) {
      manager.getAllViewports().forEach((vp) => vp.render());
    }
  }

  /**
   * Returns volume dimensions [cols, rows, depth].
   */
  public getDimensions(): { cols: number; rows: number; depth: number } {
    if (mprEngine.volume) {
      return {
        cols: mprEngine.volume.data.cols || 1,
        rows: mprEngine.volume.data.rows || 1,
        depth: mprEngine.volume.data.depth || 1,
      };
    }
    if (view3DViewer.volume) {
      return {
        cols: view3DViewer.volume.cols || 1,
        rows: view3DViewer.volume.rows || 1,
        depth: view3DViewer.volume.depth || 1,
      };
    }
    return this.dimensions;
  }

  /**
   * Subscribes to crosshair update events.
   */
  public onCrosshairChange(cb: (c: Crosshair3D) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notifyListeners(): void {
    for (const cb of this.listeners) {
      cb(this.crosshair);
    }
  }
}

export const mprCoordinator = new MPRGridCoordinator();
