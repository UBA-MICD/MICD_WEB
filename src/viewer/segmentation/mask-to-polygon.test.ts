/**
 * mask-to-polygon.test.ts — trazado y simplificación de la máscara de la IA
 * (SAM3 / mock) a un polígono editable único (US-45).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { maskToPolygon } from "./mask-to-polygon.js";
import { rasterizePolygon } from "./segmentation-correction.js";
import type { Point2D } from "../measurements/types.js";

/** Máscara rectangular llena en [x0,x1)×[y0,y1). */
function rectMask(
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Uint8Array {
  const m = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) m[y * w + x] = 1;
  }
  return m;
}

/** Regla par-impar: ¿el punto está dentro del polígono? */
function pointInPolygon(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** ¿Algún par de aristas no adyacentes se cruza? (detección de autointersección) */
function hasSelfIntersection(poly: Point2D[]): boolean {
  const n = poly.length;
  const seg = (i: number): [Point2D, Point2D] => [poly[i], poly[(i + 1) % n]];
  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const intersect = (
    p1: Point2D,
    p2: Point2D,
    p3: Point2D,
    p4: Point2D,
  ): boolean => {
    const d1 = cross(p3, p4, p1);
    const d2 = cross(p3, p4, p2);
    const d3 = cross(p1, p2, p3);
    const d4 = cross(p1, p2, p4);
    return d1 * d2 < 0 && d3 * d4 < 0; // cruce propio (estricto)
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Saltar aristas adyacentes (comparten vértice) y el par que cierra.
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
      const [a, b] = seg(i);
      const [c, d] = seg(j);
      if (intersect(a, b, c, d)) return true;
    }
  }
  return false;
}

test("maskToPolygon returns one closed simple polygon for a rectangle", () => {
  const w = 20;
  const h = 20;
  const mask = rectMask(w, h, 5, 5, 15, 15);
  const poly = maskToPolygon(mask, w, h);

  assert.ok(poly.length >= 3, "at least a triangle");
  assert.ok(!hasSelfIntersection(poly), "no self-intersections");
  // El centro del rectángulo cae dentro; una esquina lejana, fuera.
  assert.ok(pointInPolygon({ x: 10, y: 10 }, poly), "center inside");
  assert.ok(!pointInPolygon({ x: 1, y: 1 }, poly), "far corner outside");
});

test("maskToPolygon keeps the largest blob and ignores specks", () => {
  const w = 30;
  const h = 30;
  const mask = rectMask(w, h, 10, 10, 22, 22); // blob grande
  mask[0] = 1; // mota suelta en (0,0)
  mask[1] = 1;
  const poly = maskToPolygon(mask, w, h);

  // El polígono rodea el blob grande, no la mota.
  assert.ok(pointInPolygon({ x: 16, y: 16 }, poly), "big blob inside");
  assert.ok(!pointInPolygon({ x: 0, y: 0 }, poly), "speck ignored");
});

test("maskToPolygon caps the vertex count", () => {
  // Círculo → muchos píxeles de borde; debe simplificarse a <= maxVertices.
  const w = 60;
  const h = 60;
  const cx = 30;
  const cy = 30;
  const r = 20;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) mask[y * w + x] = 1;
    }
  }
  const poly = maskToPolygon(mask, w, h, { maxVertices: 40 });
  assert.ok(poly.length <= 40, `got ${poly.length} vertices`);
  assert.ok(poly.length >= 8, "still round enough");
  assert.ok(!hasSelfIntersection(poly), "no self-intersections");
});

test("maskToPolygon → rasterize round-trips to roughly the same area", () => {
  const w = 40;
  const h = 40;
  const mask = rectMask(w, h, 8, 8, 32, 32);
  const poly = maskToPolygon(mask, w, h);
  const raster = rasterizePolygon(poly, w, h);

  const areaMask = mask.reduce((a, b) => a + b, 0);
  const areaRaster = raster.reduce((a, b) => a + b, 0);
  // Tolerancia amplia: el borde de 1px y la simplificación mueven el área un poco.
  const ratio = areaRaster / areaMask;
  assert.ok(ratio > 0.85 && ratio < 1.15, `area ratio ${ratio.toFixed(3)}`);
});

test("maskToPolygon returns [] for an empty mask", () => {
  assert.deepEqual(maskToPolygon(new Uint8Array(100), 10, 10), []);
});
