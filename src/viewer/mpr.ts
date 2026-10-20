/**
 * mpr.ts — Re-export shim for backwards compatibility.
 * The 3D volumetric orthogonal cut-plane view has been isolated and renamed
 * to View3DViewer in view-3d.ts for ticket UI-7 (Phase 1).
 * Phase 2 will introduce the true 2D Multiplanar Reconstruction engine here.
 */

export {
  type VoxelVolume,
  type Camera3D,
  type Crosshair3D,
  Matrix4,
  View3DViewer,
  view3DViewer,
  MPR3DViewer,
  mpr3DViewer,
} from "./view-3d.js";
