import { ParsedDicom } from "../dicom/dicom-parser-util.js";
import { dicomCache } from "./cache.js";
import { $, showLoading, showError } from "../shared/dom.js";
import { state, itemCount } from "./state.js";

/**
 * MPR 3D WebGL2 Volume Ray Marching Module
 * Features:
 *  - 3D Bounding Box Proxy Geometry
 *  - 3D Texture (gl.TEXTURE_3D) with Hardware Trilinear Filtering (gl.LINEAR)
 *  - Ray Marching with Front-to-Back Alpha Compositing & Early Ray Termination
 *  - Dynamic Window/Level (W/L) transfer function in GLSL
 *  - Interactive Orbit Camera Controls & Dynamic Clipping Plane Slicing
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
    if (!len) {
      x0 = 0;
      x1 = 0;
      x2 = 0;
    } else {
      len = 1 / len;
      x0 *= len;
      x1 *= len;
      x2 *= len;
    }

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

// ── WebGL2 MPR 3D Viewer Class ───────────────────────────────────────────────

export class MPR3DViewer {
  public volume: VoxelVolume | null = null;
  public camera: Camera3D = { theta: 0.3, phi: 0.8, zoom: 1, panX: 0, panY: 0 };
  public crosshair: Crosshair3D = { x: 0, y: 0, z: 0 };
  public activeView: "axial" | "coronal" | "sagittal" | "3d" = "3d";
  public isActive = false;

  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private volumeTexture: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vbo: WebGLBuffer | null = null;

  public async toggle3DMode(): Promise<boolean> {
    if (this.isActive) {
      this.isActive = false;
      state.is3DMode = false;
      const oldCanvas = document.getElementById(
        "dicom-canvas",
      ) as HTMLCanvasElement;
      if (oldCanvas && oldCanvas.parentNode) {
        const newCanvas = oldCanvas.cloneNode() as HTMLCanvasElement;
        oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
      }
      return false;
    }

    const totalSlices = itemCount();
    if (totalSlices <= 1) {
      /* cspell:disable */
      showError(
        "El estudio requiere al menos 2 cortes para la vista volumétrica 3D.",
      );
      /* cspell:enable */
      return false;
    }

    showLoading(true);
    try {
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
        theta: 0.3,
        phi: 0.8,
        zoom: fitZoom > 0 ? fitZoom : 1,
        panX: 0,
        panY: 0,
      };
      this.activeView = "3d";
      this.isActive = true;
      state.is3DMode = true;

      // Re-create canvas to unlock 2D / WebGL2 context
      let canvas = document.getElementById("dicom-canvas") as HTMLCanvasElement;
      if (canvas && canvas.parentNode) {
        const newCanvas = canvas.cloneNode() as HTMLCanvasElement;
        canvas.parentNode.replaceChild(newCanvas, canvas);
        canvas = newCanvas; // Update reference to newly created canvas

        this.initGL(canvas);
        this.uploadVolumeTexture();
      }

      return true;
    } catch (err: any) {
      // cspell:disable-next-line
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

  /** Initialize WebGL2 context, Shaders and 3D Bounding Box Geometry. */
  private initGL(canvas: HTMLCanvasElement): boolean {
    let gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;

    if (!gl) {
      console.warn("WebGL2 context unavailable.");
      return false;
    }
    this.gl = gl;

    // GLSL ES 3.00 Vertex Shader — 3D Cube Bounding Box Proxy Geometry
    const vsSource = `#version 300 es
in vec3 a_position;
in vec3 a_texCoord;

uniform mat4 u_mvp;

out vec3 v_texCoord;
out vec3 v_position;

void main() {
    v_texCoord = a_texCoord;
    v_position = a_position;
    gl_Position = u_mvp * vec4(a_position, 1.0);
}
`;

    // GLSL ES 3.00 Fragment Shader — Volume Ray Marching & Early Ray Termination
    const fsSource = `#version 300 es
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

out vec4 fragColor;

// Ray-Box Intersection
bool intersectBox(vec3 rayOrigin, vec3 rayDir, vec3 boxMin, vec3 boxMax, out float tNear, out float tFar) {
    vec3 invDir = 1.0 / rayDir;
    vec3 tMin = (boxMin - rayOrigin) * invDir;
    vec3 tMax = (boxMax - rayOrigin) * invDir;
    vec3 t1 = min(tMin, tMax);
    vec3 t2 = max(tMin, tMax);
    tNear = max(max(t1.x, t1.y), t1.z);
    tFar = min(min(t2.x, t2.y), t2.z);
    return tFar > max(tNear, 0.0);
}

void main() {
    vec3 rayDir = normalize(v_position - u_cameraPos);
    float tNear, tFar;
    if (!intersectBox(u_cameraPos, rayDir, u_boxMin, u_boxMax, tNear, tFar)) {
        discard;
    }

    tNear = max(tNear, 0.0);
    float minW = u_windowCenter - u_windowWidth * 0.5;

    // 2D Slice Plane Views (Axial, Coronal, Sagittal)
    if (u_activeView == 0) {
        float planeZ = mix(u_boxMin.z, u_boxMax.z, u_crosshair.z);
        if (abs(rayDir.z) < 1e-5) discard;
        float t = (planeZ - u_cameraPos.z) / rayDir.z;
        if (t < tNear || t > tFar) discard;
        vec3 p = u_cameraPos + rayDir * t;
        vec3 texCoord = (p - u_boxMin) / (u_boxMax - u_boxMin);
        float density = texture(u_volume, texCoord).r;
        float intensity = clamp((density - minW) / u_windowWidth, 0.0, 1.0);
        fragColor = vec4(vec3(intensity), 1.0);
        return;
    } else if (u_activeView == 1) {
        float planeY = mix(u_boxMin.y, u_boxMax.y, u_crosshair.y);
        if (abs(rayDir.y) < 1e-5) discard;
        float t = (planeY - u_cameraPos.y) / rayDir.y;
        if (t < tNear || t > tFar) discard;
        vec3 p = u_cameraPos + rayDir * t;
        vec3 texCoord = (p - u_boxMin) / (u_boxMax - u_boxMin);
        float density = texture(u_volume, texCoord).r;
        float intensity = clamp((density - minW) / u_windowWidth, 0.0, 1.0);
        fragColor = vec4(vec3(intensity), 1.0);
        return;
    } else if (u_activeView == 2) {
        float planeX = mix(u_boxMin.x, u_boxMax.x, u_crosshair.x);
        if (abs(rayDir.x) < 1e-5) discard;
        float t = (planeX - u_cameraPos.x) / rayDir.x;
        if (t < tNear || t > tFar) discard;
        vec3 p = u_cameraPos + rayDir * t;
        vec3 texCoord = (p - u_boxMin) / (u_boxMax - u_boxMin);
        float density = texture(u_volume, texCoord).r;
        float intensity = clamp((density - minW) / u_windowWidth, 0.0, 1.0);
        fragColor = vec4(vec3(intensity), 1.0);
        return;
    }

    // Volume Ray Marching Algorithm (3D Raycasting with Early Termination)
    const int STEPS = 160;
    float stepSize = (tFar - tNear) / float(STEPS);
    vec3 rayPos = u_cameraPos + rayDir * tNear;
    vec3 stepVec = rayDir * stepSize;

    vec4 accumColor = vec4(0.0);

    for (int i = 0; i < STEPS; i++) {
        vec3 texCoord = (rayPos - u_boxMin) / (u_boxMax - u_boxMin);

        if (texCoord.x >= 0.0 && texCoord.x <= 1.0 &&
            texCoord.y >= 0.0 && texCoord.y <= 1.0 &&
            texCoord.z >= 0.0 && texCoord.z <= 1.0) {

            // Dynamic depth clipping plane
            if (texCoord.z <= u_clipPlane) {
                float density = texture(u_volume, texCoord).r;
                float intensity = clamp((density - minW) / u_windowWidth, 0.0, 1.0);

                float thickness = 0.005;
                bool onPlaneX = abs(texCoord.x - u_crosshair.x) < thickness;
                bool onPlaneY = abs(texCoord.y - u_crosshair.y) < thickness;
                bool onPlaneZ = abs(texCoord.z - u_crosshair.z) < thickness;

                if (onPlaneX || onPlaneY || onPlaneZ) {
                    vec3 planeColor = vec3(intensity);

                    if (onPlaneX) planeColor *= vec3(1.0, 0.6, 0.6);      // Sagittal (Red)
                    else if (onPlaneY) planeColor *= vec3(0.6, 1.0, 0.6); // Coronal (Green)
                    else planeColor *= vec3(0.6, 0.8, 1.0);               // Axial (Blue)

                    float planeAlpha = 0.25;

                    accumColor.rgb += (1.0 - accumColor.a) * planeColor * planeAlpha;
                    accumColor.a += (1.0 - accumColor.a) * planeAlpha;

                    if (accumColor.a >= 0.98) {
                        accumColor.a = 1.0;
                        break;
                    }
                }
            }
        }
        rayPos += stepVec;
    }

    if (accumColor.a < 0.01) discard;
    fragColor = accumColor;
}
`;

    const program = this.createProgram(gl, vsSource, fsSource);
    if (!program) return false;
    this.program = program;

    this.initCubeGeometry(gl);
    return true;
  }

  private createProgram(
    gl: WebGL2RenderingContext,
    vsSource: string,
    fsSource: string,
  ): WebGLProgram | null {
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error("Vertex Shader Error:", gl.getShaderInfoLog(vs));
      return null;
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error("Fragment Shader Error:", gl.getShaderInfoLog(fs));
      return null;
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("Program Link Error:", gl.getProgramInfoLog(prog));
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
    if (!this.gl || !this.volume) return;
    const gl = this.gl;
    const { depth, rows, cols, data, rescaleSlope, rescaleIntercept } =
      this.volume;

    const totalVoxels = depth * rows * cols;
    const normalizedData = new Uint8Array(totalVoxels);

    for (let i = 0; i < totalVoxels; i++) {
      const raw = data[i];
      const hu = raw * rescaleSlope + rescaleIntercept;
      // Map HU [-1024..3071] into [0..255]
      const norm = Math.max(
        0,
        Math.min(255, Math.round(((hu + 1024) / 4095) * 255)),
      );
      normalizedData[i] = norm;
    }

    if (this.volumeTexture) {
      gl.deleteTexture(this.volumeTexture);
    }

    const tex = gl.createTexture();
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

    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    this.volumeTexture = tex;
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

  /** Render WebGL2 3D Volume Ray Marching. */
  public render(canvas: HTMLCanvasElement): void {
    if (!this.volume || !canvas) return;

    if (!this.gl || this.gl.canvas !== canvas) {
      this.initGL(canvas);
      this.uploadVolumeTexture();
    }
    const gl = this.gl;
    if (!gl || !this.program || !this.volumeTexture || !this.vao) return;

    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    gl.clearColor(0.05, 0.05, 0.08, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.program);

    // Calculate physical bounding box scale
    const { depth, rows, cols, pixelSpacing, sliceSpacing } = this.volume;
    const wMM = cols * pixelSpacing[1];
    const hMM = rows * pixelSpacing[0];
    const dMM = depth * sliceSpacing;
    const maxDim = Math.max(wMM, hMM, dMM) || 1;

    const scaleX = wMM / maxDim;
    const scaleY = hMM / maxDim;
    const scaleZ = dMM / maxDim;

    const boxMin = [-scaleX / 2, -scaleY / 2, -scaleZ / 2];
    const boxMax = [scaleX / 2, scaleY / 2, scaleZ / 2];

    // Compute Orbit Camera Matrices
    const dist = 2.0 / (this.camera.zoom * state.viewport.zoom);
    const eyeX = dist * Math.cos(this.camera.theta) * Math.sin(this.camera.phi);
    const eyeY = dist * Math.sin(this.camera.theta);
    const eyeZ = dist * Math.cos(this.camera.theta) * Math.cos(this.camera.phi);

    const aspect = width / height;
    const proj = Matrix4.perspective(Math.PI / 4, aspect, 0.1, 100.0);
    const view = Matrix4.lookAt(
      [
        eyeX - (this.camera.panX + state.viewport.panX) * 0.002,
        eyeY + (this.camera.panY + state.viewport.panY) * 0.002,
        eyeZ,
      ],
      [0, 0, 0],
      [0, 1, 0],
    );

    const mvp = Matrix4.multiply(proj, view);

    // Set Shader Uniforms
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this.program, "u_mvp"),
      false,
      mvp,
    );

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.volumeTexture);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_volume"), 0);

    gl.uniform3f(
      gl.getUniformLocation(this.program, "u_cameraPos"),
      eyeX,
      eyeY,
      eyeZ,
    );
    gl.uniform3f(
      gl.getUniformLocation(this.program, "u_boxMin"),
      boxMin[0],
      boxMin[1],
      boxMin[2],
    );
    gl.uniform3f(
      gl.getUniformLocation(this.program, "u_boxMax"),
      boxMax[0],
      boxMax[1],
      boxMax[2],
    );

    // Normalized Window/Level parameters
    const wcHU =
      state.viewport.windowWidth > 0
        ? state.viewport.windowCenter
        : this.volume.windowCenter;
    const wwHU =
      state.viewport.windowWidth > 0
        ? state.viewport.windowWidth
        : this.volume.windowWidth;

    const normCenter = (wcHU + 1024) / 4095;
    const normWidth = Math.max(0.001, wwHU / 4095);

    gl.uniform1f(
      gl.getUniformLocation(this.program, "u_windowCenter"),
      normCenter,
    );
    gl.uniform1f(
      gl.getUniformLocation(this.program, "u_windowWidth"),
      normWidth,
    );

    // Normalized crosshair position [0..1]
    const normNormX = this.crosshair.x / Math.max(1, cols - 1);
    const normNormY = this.crosshair.y / Math.max(1, rows - 1);
    const normNormZ = this.crosshair.z / Math.max(1, depth - 1);
    gl.uniform3f(
      gl.getUniformLocation(this.program, "u_crosshair"),
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
    gl.uniform1i(
      gl.getUniformLocation(this.program, "u_activeView"),
      viewModeInt,
    );

    // Dynamic clipping plane position from depth slider [0..1]
    const depthInfo = this.getDepthInfo();
    const clipPlaneRatio = depthInfo.current / Math.max(1, depthInfo.total - 1);
    gl.uniform1f(
      gl.getUniformLocation(this.program, "u_clipPlane"),
      clipPlaneRatio,
    );

    // Draw Volume Bounding Box Cube Geometry
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 36);

    // Render 3D orientation gizmo on widget canvas
    const gizmoCanvas = $("mpr-gizmo-canvas") as HTMLCanvasElement | null;
    if (gizmoCanvas) {
      this.renderGizmo(gizmoCanvas);
    }
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
