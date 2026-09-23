// ── Máscara binaria → polígono editable (US-45) ──────────────────────────────
//
// SAM3 (y el mock actual) entregan una MÁSCARA binaria (RLE). Para poder
// mostrarla y editarla como los polígonos del visor, la convertimos a UN
// contorno cerrado, simple (sin autointersecciones) y con pocos vértices:
//
//   1. Se elige la componente conexa más grande (SAM3 da un objeto por máscara;
//      así se ignoran motas sueltas).
//   2. Se traza su borde exterior con Moore-neighbor tracing (Jacob's stopping
//      criterion) → una poligonal cerrada, en orden, sin cruces.
//   3. Se simplifica con Douglas-Peucker hasta ~maxVertices, subiendo la
//      tolerancia si hace falta.
//
// Módulo sin DOM: sólo geometría, testeable bajo Node.

import type { Point2D } from "../measurements/types.js";

export interface MaskToPolygonOptions {
  /** Tolerancia inicial de simplificación, en píxeles. */
  tolerance?: number;
  /** Cota superior de vértices; se sube la tolerancia hasta cumplirla. */
  maxVertices?: number;
}

/**
 * Convierte una máscara binaria row-major (`1` = dentro) en un polígono cerrado
 * y simplificado en coordenadas de píxel de imagen. Devuelve `[]` si la máscara
 * está vacía o es demasiado chica para un polígono (menos de 3 vértices).
 */
export function maskToPolygon(
  mask: Uint8Array | number[],
  width: number,
  height: number,
  options: MaskToPolygonOptions = {},
): Point2D[] {
  const tolerance = options.tolerance ?? 1.5;
  const maxVertices = options.maxVertices ?? 60;
  if (width <= 0 || height <= 0 || mask.length < width * height) return [];

  const component = largestComponent(mask, width, height);
  if (!component) return [];

  const boundary = traceBoundary(component, width, height);
  if (boundary.length < 3) return [];

  // Simplifica; si aún quedan demasiados vértices, sube la tolerancia.
  let simplified = simplifyClosed(boundary, tolerance);
  let tol = tolerance;
  let guard = 0;
  while (simplified.length > maxVertices && guard < 12) {
    tol *= 1.6;
    simplified = simplifyClosed(boundary, tol);
    guard++;
  }
  return simplified.length >= 3 ? simplified : boundary;
}

// ── Componente conexa más grande (8-conectividad) ────────────────────────────

function largestComponent(
  mask: Uint8Array | number[],
  width: number,
  height: number,
): Uint8Array | null {
  const seen = new Uint8Array(width * height);
  const best = new Uint8Array(width * height);
  let bestSize = 0;
  const stack: number[] = [];

  for (let start = 0; start < width * height; start++) {
    if (!mask[start] || seen[start]) continue;
    // BFS/DFS flood fill of this component.
    const cells: number[] = [];
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const idx = stack.pop() as number;
      cells.push(idx);
      const x = idx % width;
      const y = (idx / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (mask[nIdx] && !seen[nIdx]) {
            seen[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }
    }
    if (cells.length > bestSize) {
      bestSize = cells.length;
      best.fill(0);
      for (const c of cells) best[c] = 1;
    }
  }
  return bestSize > 0 ? best : null;
}

// ── Moore-neighbor boundary tracing ──────────────────────────────────────────

const at = (
  m: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]);

/**
 * Traza el borde exterior de una componente (un solo blob). Devuelve los
 * centros de los píxeles de borde en orden horario, como una poligonal cerrada.
 */
function traceBoundary(
  m: Uint8Array,
  width: number,
  height: number,
): Point2D[] {
  // Píxel de arranque: el primero (row-major) que esté encendido.
  let startX = -1;
  let startY = -1;
  for (let i = 0; i < width * height && startX < 0; i++) {
    if (m[i]) {
      startX = i % width;
      startY = (i / width) | 0;
    }
  }
  if (startX < 0) return [];

  // 8 vecinos en orden horario empezando arriba-izquierda.
  const nbr = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
  ];

  const boundary: Point2D[] = [];
  let cx = startX;
  let cy = startY;
  // Dirección desde la que "entramos" al píxel inicial (venimos de la izquierda).
  let backtrack = 7; // índice en nbr del vecino previo (-1,0)
  const maxSteps = width * height * 8;
  let steps = 0;

  do {
    boundary.push({ x: cx, y: cy });
    // Buscar el próximo vecino encendido, girando desde el backtrack.
    let found = false;
    for (let k = 0; k < 8; k++) {
      const dir = (backtrack + 1 + k) % 8;
      const nx = cx + nbr[dir][0];
      const ny = cy + nbr[dir][1];
      if (at(m, width, height, nx, ny)) {
        // El nuevo backtrack apunta de vuelta hacia el píxel actual.
        backtrack = (dir + 4) % 8;
        cx = nx;
        cy = ny;
        found = true;
        break;
      }
    }
    if (!found) break; // píxel aislado
    steps++;
  } while ((cx !== startX || cy !== startY) && steps < maxSteps);

  return boundary;
}

// ── Douglas-Peucker sobre una poligonal cerrada ──────────────────────────────

function simplifyClosed(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length < 4) return points.slice();
  // Para un anillo cerrado, anclamos en dos puntos "opuestos" y simplificamos
  // las dos mitades, así el resultado no depende de dónde arrancó el trazado.
  const n = points.length;
  const half = Math.floor(n / 2);
  const first = rdp(points.slice(0, half + 1), tolerance);
  const second = rdp(points.slice(half), tolerance);
  // Concatenar sin duplicar los puntos de unión.
  const merged = first.slice(0, -1).concat(second.slice(0, -1));
  return merged.length >= 3 ? merged : points.slice();
}

function rdp(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length < 3) return points.slice();
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > tolerance) {
    const left = rdp(points.slice(0, index + 1), tolerance);
    const right = rdp(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[end]];
}

function perpendicularDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // |cross product| / |base|
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}
