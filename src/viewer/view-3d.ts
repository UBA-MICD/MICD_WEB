import { ParsedDicom } from "../dicom/dicom-parser-util.js";
import { getCanonicalFlip } from "../dicom/spatial-math.js";
import { dicomCache } from "./cache.js";
import { $, showLoading, showError } from "../shared/dom.js";
import { state, itemCount } from "./state.js";
import { t } from "../i18n/i18n.js";
import { mprEngine } from "./mpr-engine.js";

/**
 * 3D View (WebGL2 Volume Ray Marching Module)
 * Isolates the volumetric 3D orthogonal cut-plane representation from 2D MPR.
 * Features:
 *  - 3D Bounding Box Proxy Geometry
 *  - 3D Texture (gl.TEXTURE_3D) with Hardware Trilinear Filtering (gl.LINEAR)
 *  - Ray Marching with Front-to-Back Alpha Compositing & Early Ray Termination
 *  - Dynamic Window/Level (W/L) transfer function in GLSL
 *  - Interactive Orbit Camera Controls & Dynamic Clipping Plane Slicing
 *  - High-contrast clinical anatomical orientation gizmo
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
  imageOrientationPatient?: [number, number, number, number, number, number];
  flipX?: boolean;
  flipY?: boolean;
}

export interface Camera3D {
  theta: number; // Pitch angle in radians
  phi: number; // Yaw angle in radians
  zoom: number;
  panX: number;
  panY: number;
}

export interface Crosshair3D {
  x: number; // 0..cols-1
  y: number; // 0..rows-1
  z: number; // 0..depth-1
}

// ── Lightweight Matrix4 Math Helper ──────────────────────────────────────────

export class Matrix4 {
  public static create(): Float32Array {
    const out = new Float32Array(16);
    out[0] = 1;
    out[5] = 1;
    out[10] = 1;
    out[15] = 1;
    return out;
  }

  public static identity(): Float32Array {
    return Matrix4.create();
  }

  public static scale(
    m: Float32Array,
    v: [number, number, number],
  ): Float32Array {
    const s = new Float32Array([
      v[0],
      0,
      0,
      0,
      0,
      v[1],
      0,
      0,
      0,
      0,
      v[2],
      0,
      0,
      0,
      0,
      1,
    ]);
    return Matrix4.multiply(m, s);
  }

  public static perspective(
    fovy: number,
    aspect: number,
    near: number,
    far: number,
  ): Float32Array {
    const f = 1.0 / Math.tan(fovy / 2);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  }

  public static lookAt(
    eye: number[],
    center: number[],
    up: number[],
  ): Float32Array {
    let z0 = eye[0] - center[0];
    let z1 = eye[1] - center[1];
    let z2 = eye[2] - center[2];
    let len = 1 / (Math.hypot(z0, z1, z2) || 1);
    z0 *= len;
    z1 *= len;
    z2 *= len;

    let x0 = up[1] * z2 - up[2] * z1;
    let x1 = up[2] * z0 - up[0] * z2;
    let x2 = up[0] * z1 - up[1] * z0;
    len = Math.hypot(x0, x1, x2);
    if (len < 1e-5) {
      const altUp = Math.abs(z1) > 0.9 ? [0, 0, 1] : [0, 1, 0];
      x0 = altUp[1] * z2 - altUp[2] * z1;
      x1 = altUp[2] * z0 - altUp[0] * z2;
      x2 = altUp[0] * z1 - altUp[1] * z0;
      len = Math.hypot(x0, x1, x2);
    }
    len = 1 / (len || 1);
    x0 *= len;
    x1 *= len;
    x2 *= len;

    let y0 = z1 * x2 - z2 * x1;
    let y1 = z2 * x0 - z0 * x2;
    let y2 = z0 * x1 - z1 * x0;

    const out = new Float32Array(16);
    out[0] = x0;
    out[1] = y0;
    out[2] = z0;
    out[3] = 0;
    out[4] = x1;
    out[5] = y1;
    out[6] = z1;
    out[7] = 0;
    out[8] = x2;
    out[9] = y2;
    out[10] = z2;
    out[11] = 0;
    out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    out[15] = 1;
    return out;
  }

  public static multiply(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        out[j * 4 + i] =
          a[i] * b[j * 4] +
          a[i + 4] * b[j * 4 + 1] +
          a[i + 8] * b[j * 4 + 2] +
          a[i + 12] * b[j * 4 + 3];
      }
    }
    return out;
  }
}

// ── WebGL2 3D View Static Shader Sources ─────────────────────────────────────

export const VIEW_3D_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_texCoord;

uniform mat4 u_mvp;
uniform vec3 u_boxMin;
uniform vec3 u_boxMax;

out vec3 v_texCoord;
out vec3 v_position;

void main() {
    v_texCoord = a_texCoord;
    vec3 scaledPos = mix(u_boxMin, u_boxMax, a_position + vec3(0.5));
    v_position = scaledPos;
    gl_Position = u_mvp * vec4(scaledPos, 1.0);
}
`;

export const VIEW_3D_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec3 v_texCoord;
in vec3 v_position;

uniform sampler3D u_volume;
uniform vec3 u_cameraPos;       // Camera position in object space
uniform vec3 u_boxMin;         // Bounding box min (-scale/2)
uniform vec3 u_boxMax;         // Bounding box max (+scale/2)
uniform float u_windowCenter;  // Window center normalized [0, 1]
uniform float u_windowWidth;   // Window width normalized (0, 1]
uniform vec3 u_crosshair;      // Normalized crosshair position [0, 1]^3
uniform int u_activeView;      // 0: Axial, 1: Coronal, 2: Sagittal, 3: Full 3D Volume
uniform float u_clipPlane;     // Clipping plane ratio [0..1]
uniform int u_debugAABB;       // Debug flag: 1 = flat red debug color
uniform bool u_flipY;          // IOP canonical flip Y flag
uniform int u_presetMode;      // 0: Linear W/L, 1: Bone, 2: Soft Tissue, 3: MIP
uniform vec3 u_voxelStep;      // 1.0 / volumeDimensions in texture space

out vec4 fragColor;

// Safe Slab Method Ray-Box Intersection (avoids division by zero / NaNs)
bool intersectBox(vec3 rayOrigin, vec3 rayDir, vec3 boxMin, vec3 boxMax, out float tNear, out float tFar) {
    vec3 s = sign(rayDir);
    vec3 dirSign = mix(s, vec3(1.0), equal(s, vec3(0.0)));
    vec3 safeDir = dirSign * max(abs(rayDir), vec3(1e-6));
    vec3 invDir = 1.0 / safeDir;
    vec3 tMin = (boxMin - rayOrigin) * invDir;
    vec3 tMax = (boxMax - rayOrigin) * invDir;
    vec3 t1 = min(tMin, tMax);
    vec3 t2 = max(tMin, tMax);
    tNear = max(max(t1.x, t1.y), t1.z);
    tFar = min(min(t2.x, t2.y), t2.z);
    return tFar >= max(tNear, 0.0);
}

vec3 getTexCoord(vec3 p) {
    vec3 tc = (p - u_boxMin) / (u_boxMax - u_boxMin);
    if (!u_flipY) {
        tc.y = 1.0 - tc.y;
    }
    return tc;
}

// Finite differences gradient computation (6 neighbor samples)
vec3 computeGradient(sampler3D vol, vec3 tc, vec3 step) {
    float dx = texture(vol, tc + vec3(step.x, 0.0, 0.0)).r - texture(vol, tc - vec3(step.x, 0.0, 0.0)).r;
    float dy = texture(vol, tc + vec3(0.0, step.y, 0.0)).r - texture(vol, tc - vec3(0.0, step.y, 0.0)).r;
    float dz = texture(vol, tc + vec3(0.0, 0.0, step.z)).r - texture(vol, tc - vec3(0.0, 0.0, step.z)).r;
    return vec3(dx, dy, dz) * 0.5;
}

// Blinn-Phong diffuse and specular shading based on density gradient
vec3 applyLighting(vec3 baseCol, vec3 tc, vec3 rayDir) {
    vec3 grad = computeGradient(u_volume, tc, u_voxelStep);
    float gradLen = length(grad);
    if (gradLen > 0.005) {
        vec3 N = -normalize(grad);
        vec3 L = normalize(-rayDir + vec3(0.2, 0.3, 0.1));
        vec3 V = -rayDir;
        vec3 H = normalize(L + V);
        float diff = max(dot(N, L), 0.0);
        float spec = pow(max(dot(N, H), 0.0), 32.0);
        return baseCol * (0.35 + 0.65 * diff) + vec3(0.35) * spec;
    }
    return baseCol;
}

void samplePreset(float d, float minW, out vec3 col, out float alpha) {
    if (u_presetMode == 1) {
        // Preset 1: Bone (Dense structures: cortical/trabecular bone, teeth)
        float t = clamp((d - 0.28) / 0.32, 0.0, 1.0);
        col = mix(vec3(0.92, 0.85, 0.72), vec3(1.0, 0.98, 0.92), t);
        alpha = t * t * 0.22;
    } else if (u_presetMode == 2) {
        // Preset 2: Soft Tissue (Organs, muscle, brain: ~ -50 to 150 HU)
        float t = clamp((d - 0.21) / 0.14, 0.0, 1.0);
        col = mix(vec3(0.82, 0.38, 0.32), vec3(0.96, 0.76, 0.65), t);
        alpha = t * 0.12;
    } else {
        // Preset 0: Linear Window/Level
        float val = clamp((d - minW) / u_windowWidth, 0.0, 1.0);
        col = mix(vec3(0.85, 0.55, 0.35), vec3(1.0, 0.98, 0.92), smoothstep(0.25, 0.75, val)) * val;
        alpha = (val > 0.08) ? (val - 0.08) * 0.09 : 0.0;
    }
}

void main() {
    vec3 rayDir = normalize(v_position - u_cameraPos);
    float tNear, tFar;
    if (!intersectBox(u_cameraPos, rayDir, u_boxMin, u_boxMax, tNear, tFar)) {
        discard;
    }

    // Flat red visual debug when requested
    if (u_debugAABB == 1) {
        fragColor = vec4(1.0, 0.0, 0.0, 1.0);
        return;
    }

    tNear = max(tNear, 0.0);
    float minW = u_windowCenter - u_windowWidth * 0.5;

    // 2D Slice Plane Views (Axial, Coronal, Sagittal)
    if (u_activeView == 0) {
        float planeZ = mix(u_boxMin.z, u_boxMax.z, u_crosshair.z);
        if (abs(rayDir.z) < 1e-6) discard;
        float t = (planeZ - u_cameraPos.z) / rayDir.z;
        if (t < tNear - 1e-3 || t > tFar + 1e-3) discard;
        vec3 p = u_cameraPos + rayDir * t;
        vec3 texCoord = getTexCoord(p);
        float density = texture(u_volume, clamp(texCoord, 0.0, 1.0)).r;
        float intensity = clamp((density - minW) / u_windowWidth, 0.0, 1.0);
        fragColor = vec4(vec3(intensity), 1.0);
        return;
    } else if (u_activeView == 1) {
        float planeY = mix(u_boxMin.y, u_boxMax.y, u_crosshair.y);
        if (abs(rayDir.y) < 1e-6) discard;
        float t = (planeY - u_cameraPos.y) / rayDir.y;
        if (t < tNear - 1e-3 || t > tFar + 1e-3) discard;
        vec3 p = u_cameraPos + rayDir * t;
        vec3 texCoord = getTexCoord(p);
        float density = texture(u_volume, clamp(texCoord, 0.0, 1.0)).r;
        float intensity = clamp((density - minW) / u_windowWidth, 0.0, 1.0);
        fragColor = vec4(vec3(intensity), 1.0);
        return;
    } else if (u_activeView == 2) {
        float planeX = mix(u_boxMin.x, u_boxMax.x, u_crosshair.x);
        if (abs(rayDir.x) < 1e-6) discard;
        float t = (planeX - u_cameraPos.x) / rayDir.x;
        if (t < tNear - 1e-3 || t > tFar + 1e-3) discard;
        vec3 p = u_cameraPos + rayDir * t;
        vec3 texCoord = getTexCoord(p);
        float density = texture(u_volume, clamp(texCoord, 0.0, 1.0)).r;
        float intensity = clamp((density - minW) / u_windowWidth, 0.0, 1.0);
        fragColor = vec4(vec3(intensity), 1.0);
        return;
    }

    // ── Mode 3: 3D Volumetric Ray Marching & Presets ──
    vec4 accumColor = vec4(0.0);

    // Preset 3: Maximum Intensity Projection (MIP)
    if (u_presetMode == 3) {
        const int MIP_STEPS = 120;
        float stepSize = (tFar - tNear) / float(MIP_STEPS);
        vec3 rayPos = u_cameraPos + rayDir * (tNear + stepSize * 0.5);
        vec3 stepVec = rayDir * stepSize;
        float maxVal = 0.0;
        for (int i = 0; i < MIP_STEPS; i++) {
            vec3 tc = getTexCoord(rayPos);
            if (tc.x >= 0.0 && tc.x <= 1.0 && tc.y >= 0.0 && tc.y <= 1.0 && tc.z >= 0.0 && tc.z <= 1.0) {
                float d = texture(u_volume, tc).r;
                if (d > maxVal) maxVal = d;
            }
            rayPos += stepVec;
        }
        float intensity = clamp((maxVal - minW) / u_windowWidth, 0.0, 1.0);
        fragColor = vec4(vec3(intensity), 1.0);
        return;
    }

    // Preset 1 (Bone) or Preset 2 (Soft Tissue): Full Volume Ray Marching with Blinn-Phong
    if (u_presetMode == 1 || u_presetMode == 2) {
        const int VOL_STEPS = 100;
        float stepSize = (tFar - tNear) / float(VOL_STEPS);
        vec3 rayPos = u_cameraPos + rayDir * (tNear + stepSize * 0.5);
        vec3 stepVec = rayDir * stepSize;
        for (int i = 0; i < VOL_STEPS; i++) {
            vec3 tc = getTexCoord(rayPos);
            if (tc.x >= 0.0 && tc.x <= 1.0 && tc.y >= 0.0 && tc.y <= 1.0 && tc.z >= 0.0 && tc.z <= 1.0) {
                float d = texture(u_volume, tc).r;
                vec3 col;
                float a;
                samplePreset(d, minW, col, a);
                if (a > 0.005) {
                    vec3 litCol = applyLighting(col, tc, rayDir);
                    accumColor.rgb += (1.0 - accumColor.a) * litCol * a;
                    accumColor.a += (1.0 - accumColor.a) * a;
                    if (accumColor.a >= 0.95) break;
                }
            }
            rayPos += stepVec;
        }
        if (accumColor.a < 0.01) discard;
        fragColor = vec4(accumColor.rgb / max(accumColor.a, 0.0001), min(accumColor.a, 1.0));
        return;
    }

    // Preset 0 (Linear W/L): Triplanar Intersecting Orthogonal Planes + Volume Fallback
    // Analytical plane intersections for the 3 orthogonal planes
    float planeX = mix(u_boxMin.x, u_boxMax.x, u_crosshair.x);
    float planeY = mix(u_boxMin.y, u_boxMax.y, u_crosshair.y);
    float planeZ = mix(u_boxMin.z, u_boxMax.z, u_crosshair.z);

    float tX = abs(rayDir.x) > 1e-6 ? (planeX - u_cameraPos.x) / rayDir.x : -1.0;
    float tY = abs(rayDir.y) > 1e-6 ? (planeY - u_cameraPos.y) / rayDir.y : -1.0;
    float tZ = abs(rayDir.z) > 1e-6 ? (planeZ - u_cameraPos.z) / rayDir.z : -1.0;

    float hitT[3];
    vec4 hitColor[3];
    int hitCount = 0;

    // Sagittal Plane (X cut)
    if (tX >= tNear - 1e-3 && tX <= tFar + 1e-3) {
        vec3 p = u_cameraPos + rayDir * tX;
        vec3 tc = getTexCoord(p);
        if (tc.y >= -1e-3 && tc.y <= 1.001 && tc.z >= -1e-3 && tc.z <= 1.001) {
            float d = texture(u_volume, clamp(tc, 0.0, 1.0)).r;
            float val = clamp((d - minW) / u_windowWidth, 0.0, 1.0);
            bool isBorder = (tc.y < 0.015 || tc.y > 0.985 || tc.z < 0.015 || tc.z > 0.985);
            vec3 col = isBorder ? vec3(0.95, 0.35, 0.35) : vec3(val * 1.0, val * 0.8, val * 0.8);
            float a = isBorder ? 0.95 : mix(0.12, 0.85, val);
            hitT[hitCount] = tX;
            hitColor[hitCount] = vec4(col, a);
            hitCount++;
        }
    }

    // Coronal Plane (Y cut)
    if (tY >= tNear - 1e-3 && tY <= tFar + 1e-3) {
        vec3 p = u_cameraPos + rayDir * tY;
        vec3 tc = getTexCoord(p);
        if (tc.x >= -1e-3 && tc.x <= 1.001 && tc.z >= -1e-3 && tc.z <= 1.001) {
            float d = texture(u_volume, clamp(tc, 0.0, 1.0)).r;
            float val = clamp((d - minW) / u_windowWidth, 0.0, 1.0);
            bool isBorder = (tc.x < 0.015 || tc.x > 0.985 || tc.z < 0.015 || tc.z > 0.985);
            vec3 col = isBorder ? vec3(0.35, 0.95, 0.5) : vec3(val * 0.8, val * 1.0, val * 0.8);
            float a = isBorder ? 0.95 : mix(0.12, 0.85, val);
            hitT[hitCount] = tY;
            hitColor[hitCount] = vec4(col, a);
            hitCount++;
        }
    }

    // Axial Plane (Z cut)
    if (tZ >= tNear - 1e-3 && tZ <= tFar + 1e-3) {
        vec3 p = u_cameraPos + rayDir * tZ;
        vec3 tc = getTexCoord(p);
        if (tc.x >= -1e-3 && tc.x <= 1.001 && tc.y >= -1e-3 && tc.y <= 1.001) {
            float d = texture(u_volume, clamp(tc, 0.0, 1.0)).r;
            float val = clamp((d - minW) / u_windowWidth, 0.0, 1.0);
            bool isBorder = (tc.x < 0.015 || tc.x > 0.985 || tc.y < 0.015 || tc.y > 0.985);
            vec3 col = isBorder ? vec3(0.35, 0.65, 1.0) : vec3(val * 0.8, val * 0.85, val * 1.0);
            float a = isBorder ? 0.95 : mix(0.12, 0.85, val);
            hitT[hitCount] = tZ;
            hitColor[hitCount] = vec4(col, a);
            hitCount++;
        }
    }

    // Sort hits front-to-back
    for (int i = 0; i < 2; i++) {
        for (int j = i + 1; j < 3; j++) {
            if (j < hitCount && hitT[j] < hitT[i]) {
                float tmpT = hitT[i];
                hitT[i] = hitT[j];
                hitT[j] = tmpT;
                vec4 tmpCol = hitColor[i];
                hitColor[i] = hitColor[j];
                hitColor[j] = tmpCol;
            }
        }
    }

    // Composite orthogonal plane cuts
    for (int i = 0; i < 3; i++) {
        if (i >= hitCount) break;
        vec3 rgb = hitColor[i].rgb;
        float alpha = hitColor[i].a;
        accumColor.rgb += (1.0 - accumColor.a) * rgb * alpha;
        accumColor.a += (1.0 - accumColor.a) * alpha;
        if (accumColor.a >= 0.98) break;
    }

    // Fallback volume ray march if planes don't fully occlude ray
    if (accumColor.a < 0.95) {
        const int STEPS = 80;
        float stepSize = (tFar - tNear) / float(STEPS);
        vec3 rayPos = u_cameraPos + rayDir * (tNear + stepSize * 0.5);
        vec3 stepVec = rayDir * stepSize;
        for (int i = 0; i < STEPS; i++) {
            vec3 tc = getTexCoord(rayPos);
            if (tc.x >= 0.0 && tc.x <= 1.0 && tc.y >= 0.0 && tc.y <= 1.0 && tc.z >= 0.0 && tc.z <= 1.0) {
                float d = texture(u_volume, tc).r;
                float val = clamp((d - minW) / u_windowWidth, 0.0, 1.0);
                if (val > 0.1) {
                    float a = (val - 0.1) * 0.08;
                    vec3 sampleColor = mix(vec3(0.85, 0.55, 0.35), vec3(1.0, 0.98, 0.92), smoothstep(0.25, 0.75, val)) * val;
                    vec3 litColor = applyLighting(sampleColor, tc, rayDir);
                    accumColor.rgb += (1.0 - accumColor.a) * litColor * a;
                    accumColor.a += (1.0 - accumColor.a) * a;
                    if (accumColor.a >= 0.95) break;
                }
            }
            rayPos += stepVec;
        }
    }

    if (accumColor.a < 0.01) discard;
    fragColor = vec4(accumColor.rgb / max(accumColor.a, 0.0001), min(accumColor.a, 1.0));
}
`;

// ── WebGL2 3D View Viewer Class ──────────────────────────────────────────────

export class View3DViewer {
  public volume: VoxelVolume | null = null;
  public camera: Camera3D = { theta: 0.3, phi: 0.8, zoom: 1, panX: 0, panY: 0 };
  public crosshair: Crosshair3D = { x: 0, y: 0, z: 0 };
  public activeView: "axial" | "coronal" | "sagittal" | "3d" = "3d";
  public isActive = false;
  public windowCenter = 0;
  public windowWidth = 0;
  public debugAABB = false;
  public presetMode = 0; // 0: Linear W/L, 1: Bone, 2: Soft Tissue, 3: MIP

  public setPresetMode(mode: number): void {
    this.presetMode = Math.max(0, Math.min(3, Math.round(mode)));
  }

  public resetCamera(): void {
    this.camera = { theta: 0.3, phi: 0.8, zoom: 1, panX: 0, panY: 0 };
    this.renderEpoch++;
  }

  public rotatePitchYaw(deltaTheta: number, deltaPhi: number): void {
    this.camera.phi += deltaPhi;
    this.camera.theta = Math.max(
      -Math.PI / 2 + 0.1,
      Math.min(Math.PI / 2 - 0.1, this.camera.theta + deltaTheta),
    );
    this.renderEpoch++;
  }

  public getPitchYawDegrees(): { pitch: number; yaw: number } {
    const pitch = this.camera.theta * (180 / Math.PI);
    let yaw = (this.camera.phi * (180 / Math.PI)) % 360;
    if (yaw > 180) yaw -= 360;
    if (yaw < -180) yaw += 360;
    return { pitch, yaw };
  }

  public setVolume(vol: VoxelVolume): void {
    if (this.volume !== vol) {
      if (this.volumeTexture && this.gl && this.textureContextId === this.gl) {
        this.gl.deleteTexture(this.volumeTexture);
      }
      this.volumeTexture = null;
      this.textureContextId = null;
    }
    this.volume = vol;
    this.renderEpoch++;
    this.windowCenter =
      vol.windowCenter ||
      (state.viewport?.windowCenter ? state.viewport.windowCenter : 40);
    this.windowWidth =
      vol.windowWidth > 0
        ? vol.windowWidth
        : state.viewport?.windowWidth > 0
          ? state.viewport.windowWidth
          : 400;
    this.crosshair = {
      x: Math.floor(vol.cols / 2),
      y: Math.floor(vol.rows / 2),
      z: Math.floor(vol.depth / 2),
    };
    if (this.gl) {
      this.uploadVolumeTexture();
    }
  }

  public setWindowLevel(center: number, width: number): void {
    this.windowCenter = center;
    this.windowWidth = width;
  }

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private volumeTexture: WebGLTexture | null = null;
  private textureContextId: WebGL2RenderingContext | null = null;
  private isUploadingTexture: boolean = false;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;
  private animationFrameId: number | null = null;
  private uniformLocations: Record<string, WebGLUniformLocation | null> = {};
  // Render-on-demand: the loop only draws when the scene actually changed since
  // the last frame. `lastRenderSig` is the signature of everything render()
  // depends on; `renderEpoch` is bumped for changes that aren't captured by
  // that signature (a new volume), so loading a different study still repaints.
  private lastRenderSig = "";
  private renderEpoch = 0;

  /** Signature of everything render() reads, so the loop can skip redundant
   *  frames. Any change — camera, window/level, preset, active view, crosshair,
   *  canvas size, or a new volume (renderEpoch) — flips it and triggers exactly
   *  one redraw, no matter which call site made the change. */
  private renderSignature(canvas: HTMLCanvasElement): string {
    const c = this.camera;
    const x = this.crosshair;
    const w = canvas.clientWidth || canvas.width || 0;
    const h = canvas.clientHeight || canvas.height || 0;
    return [
      this.renderEpoch,
      c.theta,
      c.phi,
      c.zoom,
      c.panX,
      c.panY,
      this.windowCenter,
      this.windowWidth,
      this.presetMode,
      this.activeView,
      x.x,
      x.y,
      x.z,
      this.debugAABB ? 1 : 0,
      w,
      h,
    ].join("|");
  }

  public startRenderLoop(canvas?: HTMLCanvasElement): void {
    this.stopRenderLoop();
    this.isActive = true;
    // Force the first frame after (re)starting to draw, whatever the scene is.
    this.lastRenderSig = "";
    const getTargetCanvas = (): HTMLCanvasElement | null =>
      canvas ||
      (typeof document !== "undefined"
        ? ((document.getElementById("view-3d-canvas") ||
            document.getElementById(
              "dicom-canvas",
            )) as HTMLCanvasElement | null)
        : null);

    // Render on demand. The volume ray-marcher is expensive and the context
    // uses preserveDrawingBuffer:true (so PNG export can read the canvas), which
    // makes every drawn frame cost a GPU readback/stall. Redrawing 60×/s while
    // the scene sits still stalled the whole page; instead the loop keeps
    // spinning but only calls render() when the signature changed, so an idle 3D
    // view does no GPU work while a drag or the camera animation (which mutate
    // the signature every frame) still animate smoothly.
    const loop = () => {
      if (!this.isActive) {
        this.animationFrameId = null;
        return;
      }
      if (state.isLayoutTransitioning) {
        // Keep the loop active across transitions, deferring draw until layout stabilizes
        if (typeof requestAnimationFrame !== "undefined") {
          this.animationFrameId = requestAnimationFrame(loop);
        }
        return;
      }
      const target = getTargetCanvas();
      if (
        target &&
        (typeof target.isConnected !== "boolean" || target.isConnected)
      ) {
        const sig = this.renderSignature(target);
        if (sig !== this.lastRenderSig) {
          const drawn = this.render(target);
          if (drawn !== false) {
            this.lastRenderSig = sig;
          }
        }
      }
      if (typeof requestAnimationFrame !== "undefined") {
        this.animationFrameId = requestAnimationFrame(loop);
      }
    };

    if (typeof requestAnimationFrame !== "undefined") {
      this.animationFrameId = requestAnimationFrame(loop);
    }
  }

  public stopRenderLoop(): void {
    if (this.animationFrameId !== null) {
      if (typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(this.animationFrameId);
      }
      this.animationFrameId = null;
    }
    if (this.cameraAnimFrameId !== null) {
      if (typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(this.cameraAnimFrameId);
      }
      this.cameraAnimFrameId = null;
    }
  }

  public releaseContext(): void {
    this.stopRenderLoop();
    if (this.gl) {
      try {
        const loseContext =
          typeof this.gl.getExtension === "function"
            ? this.gl.getExtension("WEBGL_lose_context")
            : null;
        if (loseContext) {
          loseContext.loseContext();
        }
      } catch {
        // Safe context release
      }
      this.gl = null;
      this.program = null;
      this.volumeTexture = null;
      this.textureContextId = null;
      this.isUploadingTexture = false;
      this.vao = null;
      this.vbo = null;
      this.uniformLocations = {};
      this.lastRenderSig = "";
    }
  }

  public async toggle3DMode(): Promise<boolean> {
    if (this.isActive) {
      this.isActive = false;
      this.stopRenderLoop();
      state.is3DMode = false;
      return false;
    }

    const totalSlices = itemCount();
    if (totalSlices <= 1 && !this.volume) {
      showError(
        t("viewer.view3d.needTwoSlices") || t("viewer.mpr.needTwoSlices"),
      );
      return false;
    }

    showLoading(true);
    try {
      if (!this.volume) {
        const parsedSlices: ParsedDicom[] = [];
        for (let i = 0; i < totalSlices; i++) {
          const parsed = await dicomCache.getOrFetch(i);
          if (!parsed || !parsed.pixelData) {
            throw new Error(`Failed to get pixel data for slice ${i + 1}`);
          }
          parsedSlices.push(parsed);
        }

        // Sort slices by Z coordinate (imagePositionPatient[2]) or instanceNumber
        parsedSlices.sort((a, b) => {
          const posA = a.metadata.imagePositionPatient;
          const posB = b.metadata.imagePositionPatient;
          if (posA && posB && posA.length >= 3 && posB.length >= 3) {
            return posA[2] - posB[2];
          }
          // Fallback if imagePositionPatient is absent
          const instA = Number(a.metadata.instanceNumber) || 0;
          const instB = Number(b.metadata.instanceNumber) || 0;
          return instA - instB;
        });

        this.setVolume(this.buildVolume(parsedSlices));
      }

      if (this.volume) {
        this.windowCenter = this.volume.windowCenter;
        this.windowWidth = this.volume.windowWidth;
      }

      const container =
        document.getElementById("view-3d-container") ||
        document.getElementById("viewport-container");
      let fitZoom = 1;
      if (
        this.volume &&
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
        theta: 0.3,
        phi: 0.8,
        zoom: fitZoom > 0 ? fitZoom : 1,
        panX: 0,
        panY: 0,
      };
      this.activeView = "3d";
      this.isActive = true;
      state.is3DMode = true;

      const canvas =
        (document.getElementById("view-3d-canvas") as HTMLCanvasElement) ||
        (document.getElementById("dicom-canvas") as HTMLCanvasElement);
      if (canvas) {
        this.initGL(canvas);
        if (this.volume) {
          this.uploadVolumeTexture();
        }
        this.render(canvas);
        this.startRenderLoop(canvas);
      }

      return true;
    } catch (err: any) {
      showError(
        t("viewer.view3d.volumeLoadError", { message: err.message || err }) ||
          t("viewer.mpr.volumeLoadError", { message: err.message || err }),
      );
      return false;
    } finally {
      showLoading(false);
    }
  }

  public buildVolume(slices: ParsedDicom[]): VoxelVolume {
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

    let windowCenter = refMeta.windowCenter ?? 40;
    let windowWidth = refMeta.windowWidth ?? 400;
    if (
      (windowWidth <= 0 || isNaN(windowWidth)) &&
      state.viewport.windowWidth > 0
    ) {
      windowCenter = state.viewport.windowCenter;
      windowWidth = state.viewport.windowWidth;
    }
    if (windowWidth <= 0 || isNaN(windowWidth)) {
      windowCenter = 40;
      windowWidth = 400;
    }

    const rawIop = refMeta.imageOrientationPatient;
    const imageOrientationPatient:
      [number, number, number, number, number, number] | undefined =
      rawIop && rawIop.length >= 6
        ? [rawIop[0], rawIop[1], rawIop[2], rawIop[3], rawIop[4], rawIop[5]]
        : undefined;
    const { flipX, flipY } = getCanonicalFlip(imageOrientationPatient);

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
      imageOrientationPatient,
      flipX,
      flipY,
    };
  }

  /** Initialize WebGL2 context, Shaders and 3D Bounding Box Geometry. */
  public initGL(canvas: HTMLCanvasElement): boolean {
    // Context attributes configured for stability during rapid transitions and buffer retention:
    // alpha: false, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true
    let gl = canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;

    if (!gl) {
      console.warn("WebGL2 context unavailable.");
      return false;
    }

    if (typeof gl.isContextLost === "function" && gl.isContextLost()) {
      const loseExt =
        typeof gl.getExtension === "function"
          ? gl.getExtension("WEBGL_lose_context")
          : null;
      if (loseExt && typeof loseExt.restoreContext === "function") {
        loseExt.restoreContext();
      }
    }

    // getContext() on the same canvas hands back the same context, and the
    // shader program and unit-cube geometry are volume-independent — so build
    // them once and reuse them. Re-running the whole init on every 3D entry
    // recompiled the shaders and allocated a fresh program/VAO/VBO each time
    // while orphaning the previous ones on the GPU; entering and leaving 3D
    // repeatedly then piled up leaked GPU resources until the whole page
    // degraded. (The context itself is not recreated here — only these were
    // leaking. The volume texture is uploaded separately, in
    // uploadVolumeTexture(), so loading a different study still refreshes it.)
    if (this.gl === gl && this.program) {
      return true;
    }
    this.gl = gl;

    const program = this.createProgram(
      gl,
      VIEW_3D_VERTEX_SHADER,
      VIEW_3D_FRAGMENT_SHADER,
    );
    if (!program) return false;
    this.program = program;

    gl.useProgram(this.program);
    const uniformNames = [
      "u_mvp",
      "u_volume",
      "u_flipY",
      "u_cameraPos",
      "u_boxMin",
      "u_boxMax",
      "u_windowCenter",
      "u_windowWidth",
      "u_crosshair",
      "u_activeView",
      "u_clipPlane",
      "u_debugAABB",
      "u_voxelStep",
      "u_presetMode",
    ];
    this.uniformLocations = {};
    for (const name of uniformNames) {
      this.uniformLocations[name] = gl.getUniformLocation(this.program, name);
    }

    this.initCubeGeometry(gl);
    return true;
  }

  public createProgram(
    gl: WebGL2RenderingContext,
    vsSource: string = VIEW_3D_VERTEX_SHADER,
    fsSource: string = VIEW_3D_FRAGMENT_SHADER,
  ): WebGLProgram | null {
    if (typeof gl.isContextLost === "function" && gl.isContextLost()) {
      console.warn(
        "[View3D] WebGL context is lost; aborting shader compilation.",
      );
      return null;
    }

    const sourceVS = vsSource || VIEW_3D_VERTEX_SHADER;
    const sourceFS = fsSource || VIEW_3D_FRAGMENT_SHADER;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    if (!vs) {
      console.error("[View3D] gl.createShader(VERTEX_SHADER) failed.");
      return null;
    }
    gl.shaderSource(vs, sourceVS);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      const vsLog = gl.getShaderInfoLog(vs);
      console.error("Vertex Shader Error (GLSL compile failed):", vsLog);
      gl.deleteShader(vs);
      return null;
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fs) {
      console.error("[View3D] gl.createShader(FRAGMENT_SHADER) failed.");
      gl.deleteShader(vs);
      return null;
    }
    gl.shaderSource(fs, sourceFS);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const fsLog = gl.getShaderInfoLog(fs);
      console.error("Fragment Shader Error (GLSL compile failed):", fsLog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }

    const prog = gl.createProgram();
    if (!prog) {
      console.error("[View3D] gl.createProgram() failed.");
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const progLog = gl.getProgramInfoLog(prog);
      console.error("Program Link Error:", progLog);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    return prog;
  }

  /** Create bounding box 3D cube geometry VBO/VAO. */
  private initCubeGeometry(gl: WebGL2RenderingContext): void {
    const vertices = new Float32Array([
      // Front face
      -0.5, -0.5, 0.5, 0.0, 0.0, 1.0, 0.5, -0.5, 0.5, 1.0, 0.0, 1.0, 0.5, 0.5,
      0.5, 1.0, 1.0, 1.0, -0.5, -0.5, 0.5, 0.0, 0.0, 1.0, 0.5, 0.5, 0.5, 1.0,
      1.0, 1.0, -0.5, 0.5, 0.5, 0.0, 1.0, 1.0,
      // Back face
      -0.5, -0.5, -0.5, 0.0, 0.0, 0.0, -0.5, 0.5, -0.5, 0.0, 1.0, 0.0, 0.5, 0.5,
      -0.5, 1.0, 1.0, 0.0, -0.5, -0.5, -0.5, 0.0, 0.0, 0.0, 0.5, 0.5, -0.5, 1.0,
      1.0, 0.0, 0.5, -0.5, -0.5, 1.0, 0.0, 0.0,
      // Top face
      -0.5, 0.5, -0.5, 0.0, 1.0, 0.0, -0.5, 0.5, 0.5, 0.0, 1.0, 1.0, 0.5, 0.5,
      0.5, 1.0, 1.0, 1.0, -0.5, 0.5, -0.5, 0.0, 1.0, 0.0, 0.5, 0.5, 0.5, 1.0,
      1.0, 1.0, 0.5, 0.5, -0.5, 1.0, 1.0, 0.0,
      // Bottom face
      -0.5, -0.5, -0.5, 0.0, 0.0, 0.0, 0.5, -0.5, -0.5, 1.0, 0.0, 0.0, 0.5,
      -0.5, 0.5, 1.0, 0.0, 1.0, -0.5, -0.5, -0.5, 0.0, 0.0, 0.0, 0.5, -0.5, 0.5,
      1.0, 0.0, 1.0, -0.5, -0.5, 0.5, 0.0, 0.0, 1.0,
      // Right face
      0.5, -0.5, -0.5, 1.0, 0.0, 0.0, 0.5, 0.5, -0.5, 1.0, 1.0, 0.0, 0.5, 0.5,
      0.5, 1.0, 1.0, 1.0, 0.5, -0.5, -0.5, 1.0, 0.0, 0.0, 0.5, 0.5, 0.5, 1.0,
      1.0, 1.0, 0.5, -0.5, 0.5, 1.0, 0.0, 1.0,
      // Left face
      -0.5, -0.5, -0.5, 0.0, 0.0, 0.0, -0.5, -0.5, 0.5, 0.0, 0.0, 1.0, -0.5,
      0.5, 0.5, 0.0, 1.0, 1.0, -0.5, -0.5, -0.5, 0.0, 0.0, 0.0, -0.5, 0.5, 0.5,
      0.0, 1.0, 1.0, -0.5, 0.5, -0.5, 0.0, 1.0, 0.0,
    ]);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(0); // position
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(1); // texCoord
    gl.vertexAttribPointer(
      1,
      3,
      gl.FLOAT,
      false,
      stride,
      3 * Float32Array.BYTES_PER_ELEMENT,
    );
  }

  /** Upload VoxelVolume data into WebGL 3D Texture (gl.TEXTURE_3D). */
  private uploadVolumeTexture(): void {
    if (!this.gl || !this.volume) {
      console.warn(
        "[View3D] uploadVolumeTexture skipped: gl or volume missing",
        {
          hasGL: !!this.gl,
          hasVolume: !!this.volume,
        },
      );
      return;
    }

    if (this.isUploadingTexture) {
      return;
    }

    // Invalidate and force re-upload if context changed across viewports/canvases
    if (this.volumeTexture && this.textureContextId !== this.gl) {
      this.volumeTexture = null;
    }

    // Reuse existing 3D texture only if already uploaded for this exact native context
    if (this.volumeTexture !== null && this.textureContextId === this.gl) {
      return;
    }

    const gl = this.gl;
    if (typeof gl.isContextLost === "function" && gl.isContextLost()) {
      return;
    }

    this.isUploadingTexture = true;
    try {
      const { depth, rows, cols, data, rescaleSlope, rescaleIntercept } =
        this.volume;

      const totalVoxels = depth * rows * cols;
      if (!data || data.length === 0) {
        console.error(
          "[View3D] uploadVolumeTexture error: volume data is null or empty!",
          {
            depth,
            rows,
            cols,
            totalVoxels,
            dataLength: data ? data.length : 0,
          },
        );
        return;
      }

      // Diagnostic statistical audit across volume voxels
      let minVal = Infinity;
      let maxVal = -Infinity;
      let nonZeroCount = 0;
      const sampleStep = Math.max(1, Math.floor(data.length / 500));
      let sampledCount = 0;
      for (let i = 0; i < data.length; i += sampleStep) {
        const v = data[i];
        sampledCount++;
        if (v !== 0) nonZeroCount++;
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }

      console.log("[View3D] Uploading 3D Texture Audit:", {
        dimensions: `${cols}x${rows}x${depth}`,
        totalVoxels,
        dataLength: data.length,
        dataType: data.constructor?.name,
        sampleMin: minVal,
        sampleMax: maxVal,
        nonZeroRatio:
          sampledCount > 0 ? (nonZeroCount / sampledCount).toFixed(3) : "0",
        rescaleSlope: rescaleSlope ?? 1,
        rescaleIntercept: rescaleIntercept ?? 0,
        windowCenter: this.windowCenter,
        windowWidth: this.windowWidth,
      });

      const normalizedData = new Uint8Array(totalVoxels);
      const slope = rescaleSlope ?? 1;
      const intercept = rescaleIntercept ?? 0;
      const limit = Math.min(totalVoxels, data.length);

      for (let i = 0; i < limit; i++) {
        const raw = data[i];
        const hu = raw * slope + intercept;
        // Map HU [-1024..3071] into [0..255]
        const norm = Math.max(
          0,
          Math.min(255, Math.round(((hu + 1024) / 4095) * 255)),
        );
        normalizedData[i] = norm;
      }

      if (typeof gl.getError === "function") {
        const errBefore = gl.getError();
        if (errBefore !== 0) {
          console.warn(
            "[View3D] WebGL error before texture upload:",
            errBefore,
          );
        }
      }

      // If an old texture existed on THIS context, release it before allocating a new one
      if (this.volumeTexture && this.textureContextId === gl) {
        gl.deleteTexture(this.volumeTexture);
      }
      this.volumeTexture = null;
      this.textureContextId = null;

      const tex = gl.createTexture();
      if (!tex) {
        console.error("[View3D] Failed to create WebGL3D texture");
        return;
      }

      gl.bindTexture(gl.TEXTURE_3D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.R8,
        cols,
        rows,
        depth,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        normalizedData,
      );

      if (typeof gl.getError === "function") {
        const errAfter = gl.getError();
        if (errAfter !== 0) {
          console.error("[View3D] WebGL error during texImage3D:", errAfter);
        }
      }

      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

      this.volumeTexture = tex;
      this.textureContextId = gl;
    } finally {
      this.isUploadingTexture = false;
    }
  }

  /** Set quick view orientation: Axial, Coronal, Sagittal, 3D. */
  public setOrientation(view: "axial" | "coronal" | "sagittal" | "3d"): void {
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
    } else if (view === "3d") {
      this.camera.theta = 0.3;
      this.camera.phi = 0.8;
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

    // Decoupled from 2D state.viewport
    const centerCanvasX = canvasW / 2 + this.camera.panX;
    const centerCanvasY = canvasH / 2 + this.camera.panY;

    const totalZoom = this.camera.zoom;
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
    } else if (this.activeView === "sagittal") {
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

  /** Get current slice depth index and total count for active view. */
  public getDepthInfo(): { current: number; total: number } {
    if (!this.volume) return { current: 0, total: 1 };
    if (this.activeView === "axial" || this.activeView === "3d") {
      return { current: this.crosshair.z, total: this.volume.depth };
    } else if (this.activeView === "coronal") {
      return { current: this.crosshair.y, total: this.volume.rows };
    } else {
      return { current: this.crosshair.x, total: this.volume.cols };
    }
  }

  /** Set slice index for active view from depth slider. */
  public setDepthIndex(index: number): void {
    if (!this.volume) return;
    const { depth, rows, cols } = this.volume;
    if (this.activeView === "axial" || this.activeView === "3d") {
      this.crosshair.z = Math.max(0, Math.min(depth - 1, index));
    } else if (this.activeView === "coronal") {
      this.crosshair.y = Math.max(0, Math.min(rows - 1, index));
    } else {
      this.crosshair.x = Math.max(0, Math.min(cols - 1, index));
    }
  }

  /** Render WebGL2 3D Volume Ray Marching. Returns true if frame was drawn. */
  public render(canvas: HTMLCanvasElement): boolean {
    if (!canvas) return false;
    if (typeof canvas.isConnected === "boolean" && !canvas.isConnected)
      return false;

    if (!this.gl || this.gl.canvas !== canvas) {
      if (this.gl) {
        this.releaseContext();
      }
      this.initGL(canvas);
      if (this.volume) {
        this.uploadVolumeTexture();
      }
    }
    const gl = this.gl;
    if (!gl) return false;

    const isJsdom =
      typeof navigator !== "undefined" &&
      Boolean(navigator.userAgent && navigator.userAgent.includes("jsdom"));

    // In a real browser, if connected canvas has not completed DOM reflow, wait for layout
    if (
      !isJsdom &&
      typeof canvas.isConnected === "boolean" &&
      canvas.isConnected &&
      (canvas.clientWidth <= 0 || canvas.clientHeight <= 0)
    ) {
      return false;
    }

    const width = canvas.clientWidth || canvas.width || 512;
    const height = canvas.clientHeight || canvas.height || 512;
    if (width <= 0 || height <= 0) {
      return false;
    }

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    gl.clearColor(0.04, 0.04, 0.06, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Always render 3D Anatomical Reference Cube (Gizmo)
    const gizmoCanvas =
      typeof document !== "undefined"
        ? ((document.getElementById("view-3d-reference-cube") ||
            document.getElementById(
              "mpr-reference-cube",
            )) as HTMLCanvasElement | null)
        : null;
    if (gizmoCanvas) {
      this.renderGizmo(gizmoCanvas);
    }

    if (
      this.volume &&
      (!this.volumeTexture ||
        (this.textureContextId !== null && this.textureContextId !== this.gl))
    ) {
      this.uploadVolumeTexture();
    }

    if (
      !this.volume ||
      !this.program ||
      !this.volumeTexture ||
      (this.textureContextId !== null && this.textureContextId !== this.gl) ||
      !this.vao
    )
      return false;

    // WebGL pipeline state: Disable culling so orbiting close or inside proxy geometry
    // never discards back-face fragments; disable depth test for alpha blending pass.
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.program);

    // Calculate physical bounding box scale safely
    const { depth, rows, cols, pixelSpacing, sliceSpacing } = this.volume;
    const psRow = (pixelSpacing && pixelSpacing[0]) || 1;
    const psCol = (pixelSpacing && pixelSpacing[1]) || 1;
    const ss = sliceSpacing || 1;
    const wMM = (cols || 1) * psCol;
    const hMM = (rows || 1) * psRow;
    const dMM = (depth || 1) * ss;
    const maxDim = Math.max(wMM, hMM, dMM) || 1;

    const scaleX = wMM / maxDim;
    const scaleY = hMM / maxDim;
    const scaleZ = dMM / maxDim;

    const boxMin = [-scaleX / 2, -scaleY / 2, -scaleZ / 2];
    const boxMax = [scaleX / 2, scaleY / 2, scaleZ / 2];

    // Compute Orbit Camera & Dynamic Clipping Range (fully isolated from 2D state)
    const totalZoom = Math.max(0.1, Math.min(10, this.camera.zoom));

    // Bounding sphere radius to guarantee camera stays outside geometry
    const maxBoxDim = Math.sqrt(
      scaleX * scaleX + scaleY * scaleY + scaleZ * scaleZ,
    );
    const boundingRadius = maxBoxDim * 0.5;
    const minSafeDist = boundingRadius + 0.2;
    const distBase = Math.max(2.5, minSafeDist * 1.5);

    const targetDist = distBase / totalZoom;
    const dist = Math.max(minSafeDist, targetDist);

    // Extra zoom beyond minSafeDist is handled by adjusting camera view angle (FOV)
    const extraZoom = targetDist < minSafeDist ? minSafeDist / targetDist : 1.0;
    const baseFov = Math.PI / 4;
    const fov = 2.0 * Math.atan(Math.tan(baseFov / 2.0) / extraZoom);

    // Recalculate dynamic clipping range (near/far) so camera never clips planes
    const near = Math.max(0.01, dist - boundingRadius);
    const far = dist + boundingRadius + 2.0;

    const panOffsetX = -this.camera.panX * 0.002;
    const panOffsetY = this.camera.panY * 0.002;

    const eyeX =
      dist * Math.cos(this.camera.theta) * Math.sin(this.camera.phi) +
      panOffsetX;
    const eyeY = dist * Math.sin(this.camera.theta) + panOffsetY;
    const eyeZ = dist * Math.cos(this.camera.theta) * Math.cos(this.camera.phi);

    const aspect = width / height;
    const proj = Matrix4.perspective(fov, aspect, near, far);
    const view = Matrix4.lookAt(
      [eyeX, eyeY, eyeZ],
      [panOffsetX, panOffsetY, 0],
      [0, 1, 0],
    );

    const mvp = Matrix4.multiply(proj, view);

    // Set Shader Uniforms
    gl.uniformMatrix4fv(this.uniformLocations["u_mvp"], false, mvp);

    // Texture Binding: Active unit 0 & volume texture bound every frame
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture);
    gl.uniform1i(this.uniformLocations["u_volume"], 0);

    const flipY = this.volume.flipY ?? false;
    gl.uniform1i(this.uniformLocations["u_flipY"], flipY ? 1 : 0);

    gl.uniform3f(this.uniformLocations["u_cameraPos"], eyeX, eyeY, eyeZ);
    gl.uniform3f(
      this.uniformLocations["u_boxMin"],
      boxMin[0],
      boxMin[1],
      boxMin[2],
    );
    gl.uniform3f(
      this.uniformLocations["u_boxMax"],
      boxMax[0],
      boxMax[1],
      boxMax[2],
    );

    // Normalized Window/Level parameters (isolated in View3DViewer with robust fallback)
    let wcHU = this.windowWidth > 0 ? this.windowCenter : 0;
    let wwHU = this.windowWidth > 0 ? this.windowWidth : 0;

    if (wwHU <= 0 || isNaN(wwHU)) {
      if (state.viewport && state.viewport.windowWidth > 0) {
        wcHU = state.viewport.windowCenter;
        wwHU = state.viewport.windowWidth;
      } else if (this.volume && this.volume.windowWidth > 0) {
        wcHU = this.volume.windowCenter;
        wwHU = this.volume.windowWidth;
      } else {
        wcHU = 40;
        wwHU = 400;
      }
    }
    if (isNaN(wcHU)) {
      wcHU = 40;
    }

    const normCenter = (wcHU + 1024) / 4095;
    const normWidth = Math.max(0.001, wwHU / 4095);

    gl.uniform1f(this.uniformLocations["u_windowCenter"], normCenter);
    gl.uniform1f(this.uniformLocations["u_windowWidth"], normWidth);

    // Normalized crosshair position [0..1]
    let normNormX = this.crosshair.x / Math.max(1, cols - 1);
    let normNormY = this.crosshair.y / Math.max(1, rows - 1);
    let normNormZ = this.crosshair.z / Math.max(1, depth - 1);

    if (normNormX === 0 && normNormY === 0 && normNormZ === 0) {
      if (mprEngine && mprEngine.volume) {
        const [mx, my, mz] = mprEngine.getCrosshairNormalized();
        normNormX = mx;
        normNormY = my;
        normNormZ = mz;
      } else {
        normNormX = 0.5;
        normNormY = 0.5;
        normNormZ = 0.5;
      }
    }
    gl.uniform3f(
      this.uniformLocations["u_crosshair"],
      normNormX,
      normNormY,
      normNormZ,
    );

    const viewModeInt =
      this.activeView === "axial"
        ? 0
        : this.activeView === "coronal"
          ? 1
          : this.activeView === "sagittal"
            ? 2
            : 3;
    gl.uniform1i(this.uniformLocations["u_activeView"], viewModeInt);

    // Dynamic clipping plane position from depth slider [0..1]
    const depthInfo = this.getDepthInfo();
    const clipPlaneRatio = depthInfo.current / Math.max(1, depthInfo.total - 1);
    gl.uniform1f(this.uniformLocations["u_clipPlane"], clipPlaneRatio);

    // Flat color visual debug uniform
    gl.uniform1i(this.uniformLocations["u_debugAABB"], this.debugAABB ? 1 : 0);

    // Voxel step in normalized 3D texture space for finite differences gradient
    gl.uniform3f(
      this.uniformLocations["u_voxelStep"],
      1.0 / Math.max(1, cols),
      1.0 / Math.max(1, rows),
      1.0 / Math.max(1, depth),
    );

    // Transfer function preset mode (0: W/L, 1: Bone, 2: Soft Tissue, 3: MIP)
    gl.uniform1i(this.uniformLocations["u_presetMode"], this.presetMode);

    // Diagnostic logging of uniforms and matrices before drawArrays
    console.log("[View3D] Render Frame Uniforms & Matrices:", {
      u_windowCenter: normCenter,
      u_windowWidth: normWidth,
      boxMin,
      boxMax,
      eye: [eyeX, eyeY, eyeZ],
      cameraTheta: this.camera.theta,
      cameraPhi: this.camera.phi,
      cameraZoom: this.camera.zoom,
      activeView: this.activeView,
      debugAABB: this.debugAABB,
      isMVPValid: !Array.from(mvp).some(isNaN),
      isViewValid: !Array.from(view).some(isNaN),
      isProjValid: !Array.from(proj).some(isNaN),
      mvpSample: [mvp[0], mvp[5], mvp[10], mvp[15]],
    });

    // Draw Volume Bounding Box Cube Geometry
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
    return true;
  }

  /** Render 3D Anatomical Reference Cube (delegates to renderGizmo). */
  public renderReferenceCube(canvas: HTMLCanvasElement): void {
    this.renderGizmo(canvas);
  }

  /**
   * Render 3D Anatomical Reference Cube with Cut Plane (Orthographic 3D -> 2D).
   * Clinical UX optimizations:
   *  - Optimal contrast anatomical text with outline halo
   *  - Clinical PACS palette: Emerald (A/P), Coral (R/L), Sky Blue (S/I)
   *  - High-visibility cutting plane
   */
  public renderGizmo(canvas: HTMLCanvasElement): void {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    const cosT = Math.cos(this.camera.theta);
    const sinT = Math.sin(this.camera.theta);
    const cosP = Math.cos(this.camera.phi);
    const sinP = Math.sin(this.camera.phi);

    const s = Math.min(w, h) * 0.28; // Half extent of the cube

    // 8 vertices in 3D: [x, y, z]
    const rawVertices = [
      [-s, -s, -s], // 0: L I P
      [s, -s, -s], // 1: R I P
      [s, s, -s], // 2: R S P
      [-s, s, -s], // 3: L S P
      [-s, -s, s], // 4: L I A
      [s, -s, s], // 5: R I A
      [s, s, s], // 6: R S A
      [-s, s, s], // 7: L S A
    ];

    // Project 3D vector -> 2D Screen point
    const project = (x: number, y: number, z: number) => {
      // Yaw around Y
      const x1 = x * cosP + z * sinP;
      const y1 = y;
      const z1 = -x * sinP + z * cosP;

      // Pitch around X
      const x2 = x1;
      const y2 = y1 * cosT - z1 * sinT;
      const z2 = y1 * sinT + z1 * cosT;

      return {
        x: cx + x2,
        y: cy - y2, // Invert Y for canvas screen space
        z: z2,
      };
    };

    const projVertices = rawVertices.map((v) => project(v[0], v[1], v[2]));

    // 6 Anatomical Faces: High-contrast clinical medical colors
    const faces = [
      {
        indices: [4, 5, 6, 7],
        label: "A",
        color: "#34d399", // Anterior (+Z) — Emerald
        center: [0, 0, s],
      },
      {
        indices: [1, 0, 3, 2],
        label: "P",
        color: "#34d399", // Posterior (-Z) — Emerald
        center: [0, 0, -s],
      },
      {
        indices: [5, 1, 2, 6],
        label: "R",
        color: "#f87171", // Right (+X) — Coral Red
        center: [s, 0, 0],
      },
      {
        indices: [0, 4, 7, 3],
        label: "L",
        color: "#f87171", // Left (-X) — Coral Red
        center: [-s, 0, 0],
      },
      {
        indices: [7, 6, 2, 3],
        label: "S",
        color: "#38bdf8", // Superior (+Y) — Sky Blue
        center: [0, s, 0],
      },
      {
        indices: [0, 1, 5, 4],
        label: "I",
        color: "#38bdf8", // Inferior (-Y) — Sky Blue
        center: [0, -s, 0],
      },
    ];

    const testedFaces = faces.map((face) => {
      const p0 = projVertices[face.indices[0]];
      const p1 = projVertices[face.indices[1]];
      const p2 = projVertices[face.indices[2]];
      const p3 = projVertices[face.indices[3]];

      const avgZ = (p0.z + p1.z + p2.z + p3.z) / 4;
      const cross =
        (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);

      return {
        ...face,
        avgZ,
        isFront: cross < 0,
        pts: [p0, p1, p2, p3],
      };
    });

    // 12 Edges
    const allEdges: [number, number][] = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0], // Back loop (-Z)
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4], // Front loop (+Z)
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7], // Connecting edges
    ];

    // Classify edges: front if belonging to at least one front-facing face
    const frontFaces = testedFaces.filter((f) => f.isFront);
    const frontEdgeKeys = new Set<string>();
    frontFaces.forEach((f) => {
      for (let i = 0; i < 4; i++) {
        const a = f.indices[i];
        const b = f.indices[(i + 1) % 4];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        frontEdgeKeys.add(key);
      }
    });

    const backEdges: [number, number][] = [];
    const frontEdges: [number, number][] = [];

    allEdges.forEach(([i, j]) => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (frontEdgeKeys.has(key)) {
        frontEdges.push([i, j]);
      } else {
        backEdges.push([i, j]);
      }
    });

    // Back edges (WCAG 1.4.11 compliant contrast: >= 0.40 opacity)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 1.25;
    backEdges.forEach(([i, j]) => {
      ctx.beginPath();
      ctx.moveTo(projVertices[i].x, projVertices[i].y);
      ctx.lineTo(projVertices[j].x, projVertices[j].y);
      ctx.stroke();
    });

    // Cutting Plane (Active slice plane indicator)
    ctx.save();
    const planeSize = s * 1.35;
    ctx.fillStyle = "rgba(16, 185, 129, 0.3)";
    ctx.strokeStyle = "rgba(52, 211, 153, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(cx - planeSize, cy - planeSize, planeSize * 2, planeSize * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Front edges (Crisp clinical white lines >= 0.95 opacity)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.98)";
    ctx.lineWidth = 2.0;
    frontEdges.forEach(([i, j]) => {
      ctx.beginPath();
      ctx.moveTo(projVertices[i].x, projVertices[i].y);
      ctx.lineTo(projVertices[j].x, projVertices[j].y);
      ctx.stroke();
    });

    // Anatomical labels on front-facing face centers with high-contrast outline
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 12px var(--font-mono, monospace)";

    testedFaces
      .filter((f) => f.isFront)
      .sort((a, b) => b.avgZ - a.avgZ)
      .forEach((face) => {
        const cp = project(face.center[0], face.center[1], face.center[2]);
        // Black outline halo (WCAG 1.4.11) for maximum clinical readability
        if (typeof ctx.strokeText === "function") {
          ctx.strokeStyle = "rgba(0, 0, 0, 0.98)";
          ctx.lineWidth = 3.5;
          ctx.strokeText(face.label, cp.x, cp.y);
        }

        // Vibrant colored text
        ctx.fillStyle = face.color;
        ctx.fillText(face.label, cp.x, cp.y);
      });
  }

  /**
   * Performs 2D polygon hit-testing on the front-facing faces of the reference cube.
   * Returns face label ("A" | "P" | "R" | "L" | "S" | "I") or null.
   */
  public hitTestGizmoFace(
    clickX: number,
    clickY: number,
    canvas: HTMLCanvasElement,
  ): string | null {
    if (!canvas) return null;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const s = Math.min(w, h) * 0.28;

    const cosT = Math.cos(this.camera.theta);
    const sinT = Math.sin(this.camera.theta);
    const cosP = Math.cos(this.camera.phi);
    const sinP = Math.sin(this.camera.phi);

    const project = (x: number, y: number, z: number) => {
      const x1 = x * cosP + z * sinP;
      const y1 = y;
      const z1 = -x * sinP + z * cosP;

      const x2 = x1;
      const y2 = y1 * cosT - z1 * sinT;
      const z2 = y1 * sinT + z1 * cosT;

      return {
        x: cx + x2,
        y: cy - y2,
        z: z2,
      };
    };

    const rawVertices = [
      [-s, -s, -s],
      [s, -s, -s],
      [s, s, -s],
      [-s, s, -s],
      [-s, -s, s],
      [s, -s, s],
      [s, s, s],
      [-s, s, s],
    ];
    const projVertices = rawVertices.map((v) => project(v[0], v[1], v[2]));

    const faces = [
      { indices: [4, 5, 6, 7], label: "A" },
      { indices: [1, 0, 3, 2], label: "P" },
      { indices: [5, 1, 2, 6], label: "R" },
      { indices: [0, 4, 7, 3], label: "L" },
      { indices: [7, 6, 2, 3], label: "S" },
      { indices: [0, 1, 5, 4], label: "I" },
    ];

    const isPointInQuad = (
      px: number,
      py: number,
      pts: Array<{ x: number; y: number }>,
    ) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x,
          yi = pts[i].y;
        const xj = pts[j].x,
          yj = pts[j].y;
        const intersect =
          yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    const frontFaces = faces
      .map((face) => {
        const p0 = projVertices[face.indices[0]];
        const p1 = projVertices[face.indices[1]];
        const p2 = projVertices[face.indices[2]];
        const p3 = projVertices[face.indices[3]];
        const avgZ = (p0.z + p1.z + p2.z + p3.z) / 4;
        const cross =
          (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
        return {
          ...face,
          avgZ,
          isFront: cross < 0,
          pts: [p0, p1, p2, p3],
        };
      })
      .filter((f) => f.isFront)
      .sort((a, b) => b.avgZ - a.avgZ);

    for (const f of frontFaces) {
      if (isPointInQuad(clickX, clickY, f.pts)) {
        return f.label;
      }
    }
    return null;
  }

  /**
   * Returns canonical orbit angles { theta, phi } for a given anatomical face.
   */
  public getTargetAnglesForFace(
    faceLabel: string,
  ): { theta: number; phi: number } | null {
    switch (faceLabel) {
      case "A":
        return { theta: 0, phi: 0 };
      case "P":
        return { theta: 0, phi: Math.PI };
      case "R":
        return { theta: 0, phi: Math.PI / 2 };
      case "L":
        return { theta: 0, phi: -Math.PI / 2 };
      case "S":
        return { theta: Math.PI / 2 - 0.001, phi: 0 };
      case "I":
        return { theta: -Math.PI / 2 + 0.001, phi: 0 };
      default:
        return null;
    }
  }

  private cameraAnimFrameId: number | null = null;

  /**
   * Smoothly animates the orbital camera angles to the target orientation.
   */
  public animateCameraTo(
    targetTheta: number,
    targetPhi: number,
    durationMs = 280,
    renderCanvas?: HTMLCanvasElement,
  ): void {
    if (
      this.cameraAnimFrameId !== null &&
      typeof cancelAnimationFrame !== "undefined"
    ) {
      cancelAnimationFrame(this.cameraAnimFrameId);
      this.cameraAnimFrameId = null;
    }

    const startTheta = this.camera.theta;
    const startPhi = this.camera.phi;

    // Shortest angular distance for yaw
    let dPhi = targetPhi - startPhi;
    dPhi = Math.atan2(Math.sin(dPhi), Math.cos(dPhi));
    const finalPhi = startPhi + dPhi;

    const startTime =
      typeof performance !== "undefined" ? performance.now() : Date.now();

    const step = (now: number) => {
      if (state.isLayoutTransitioning) {
        this.cameraAnimFrameId = null;
        return;
      }
      const elapsed = now - startTime;
      const progress = Math.min(1.0, elapsed / durationMs);
      const ease = 1 - Math.pow(1 - progress, 3); // Cubic ease-out

      this.camera.theta = startTheta + (targetTheta - startTheta) * ease;
      this.camera.phi = startPhi + (finalPhi - startPhi) * ease;

      if (
        renderCanvas &&
        (typeof renderCanvas.isConnected !== "boolean" ||
          renderCanvas.isConnected)
      ) {
        this.render(renderCanvas);
      }

      if (progress < 1.0) {
        if (typeof requestAnimationFrame !== "undefined") {
          this.cameraAnimFrameId = requestAnimationFrame(step);
        }
      } else {
        this.camera.theta = targetTheta;
        this.camera.phi = targetPhi;
        this.cameraAnimFrameId = null;
        if (
          renderCanvas &&
          (typeof renderCanvas.isConnected !== "boolean" ||
            renderCanvas.isConnected)
        ) {
          this.render(renderCanvas);
        }
      }
    };

    if (typeof requestAnimationFrame !== "undefined") {
      this.cameraAnimFrameId = requestAnimationFrame(step);
    } else {
      this.camera.theta = targetTheta;
      this.camera.phi = targetPhi;
      if (renderCanvas) this.render(renderCanvas);
    }
  }

  /** Set axial slice index (Z dimension). */
  public setAxialIndex(index: number): void {
    if (!this.volume) return;
    this.crosshair.z = Math.max(0, Math.min(this.volume.depth - 1, index));
  }

  /** Set coronal slice index (Y dimension). */
  public setCoronalIndex(index: number): void {
    if (!this.volume) return;
    this.crosshair.y = Math.max(0, Math.min(this.volume.rows - 1, index));
  }

  /** Set sagittal slice index (X dimension). */
  public setSagittalIndex(index: number): void {
    if (!this.volume) return;
    this.crosshair.x = Math.max(0, Math.min(this.volume.cols - 1, index));
  }

  /** Get volume dimension bounds (Z, Y, X). */
  public getVolumeDimensions(): {
    depth: number;
    rows: number;
    cols: number;
  } | null {
    if (!this.volume) return null;
    return {
      depth: this.volume.depth,
      rows: this.volume.rows,
      cols: this.volume.cols,
    };
  }

  /** Get current slice indices across the 3 planes. */
  public getCurrentIndices(): { x: number; y: number; z: number } {
    return {
      x: this.crosshair.x,
      y: this.crosshair.y,
      z: this.crosshair.z,
    };
  }

  /** Recalculate WebGL viewport and canvas dimensions */
  public resize(canvas?: HTMLCanvasElement): void {
    const target =
      canvas ||
      (this.gl?.canvas as HTMLCanvasElement) ||
      (document.getElementById("dicom-canvas") as HTMLCanvasElement);
    if (!target) return;
    const width = target.clientWidth || target.width;
    const height = target.clientHeight || target.height;
    if (width > 0 && height > 0) {
      target.width = width;
      target.height = height;
    }
    if (this.gl) {
      this.gl.viewport(0, 0, target.width, target.height);
    }
  }
}

export const view3DViewer = new View3DViewer();
// Backward-compatibility export alias for MPR
export { View3DViewer as MPR3DViewer, view3DViewer as mpr3DViewer };

/** Builds a VoxelVolume from cached DICOM slices if multiple slices are available. */
export async function buildVolumeFromCache(): Promise<VoxelVolume | null> {
  const count = itemCount();
  if (count <= 1) return null;

  const slices: ParsedDicom[] = [];
  for (let i = 0; i < count; i++) {
    const parsed = await dicomCache.getOrFetch(i);
    if (!parsed || !parsed.pixelData) return null;
    slices.push(parsed);
  }

  // Slices from dicomCache are already strictly sorted by 3D spatial projection (StudyBuilder)
  return view3DViewer.buildVolume(slices);
}
