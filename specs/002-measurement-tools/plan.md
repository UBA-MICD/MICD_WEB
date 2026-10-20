# Plan: Herramientas de medición (longitud y área)

> **Spec:** `specs/002-measurement-tools/spec.md` · **Ticket:** TK-26 · **Date:** 2026-09-11

## Summary

Implementar dos herramientas de medición cuantitativa en el visor DICOM: **Regla (`length`)** y **ROI Elíptica (`ellipse`)**. La arquitectura se basa en una capa de renderizado vectorial sobre Canvas 2D desacoplada del renderizador WebGL, almacenamiento de anotaciones en `state.ts` indexadas por corte (`sopInstanceUid` / `sliceIndex`), una capa matemática pura para conversión Screen-Space ↔ World-Space y cálculo de distancias/áreas calibradas, y un algoritmo de muestreo iterativo para el cálculo de densidad tisular en Unidades Hounsfield (HU) con fallback visible a píxeles cuando no existe `PixelSpacing`.

---

## Constitution check

- **I. Local viewing is free:** Las herramientas de medición funcionan íntegramente del lado cliente sobre el visor local sin requerir sesión ni conexión de backend. ✅
- **II. Plain platform / no new dependencies:** Se utiliza Canvas 2D API nativo del navegador para el overlay y funciones matemáticas estándar (`Math.hypot`, `Math.PI`). Cero librerías externas agregadas. ✅
- **III. Desktop parity by vendoring:** Todo el código se escribe en `src/` de `MICD_WEB` y se replica sin bifurcaciones en `MICD_APP` mediante `make sync-web`. ✅
- **IV. Bilingual by construction:** Nuevas claves añadidas en estricta sincronía a `es.ts` y `en.ts`. Validadas por `i18n.test.ts`. ✅
- **V. Accessibility (WCAG 2.2 AA):**
  - Los botones de regla y elipse se integran al toolbar con `roving.ts` (un único tab stop).
  - Estado activo gestionado con `aria-pressed="true"`.
  - Badges de texto de medidas con contraste superior a 4.5:1 sobre fondo semitransparente oscuro (`--bg-base`).
  - Anuncio en `#measure-announce` (aria-live polite) al fijar una medida. ✅
- **VI. Security (escape & bounds):** Todo texto renderizado pasa por `escapeHtml` / `escapeAttr`. El acceso al buffer de píxeles para cálculo de HU está estrictamente acotado (clamped) a las dimensiones $[0, cols-1] \times [0, rows-1]$ del estudio. ✅
- **VII. Tests where it counts:** Lógica matemática, proyecciones de coordenadas y estadísticas HU aisladas en módulos libres de DOM testeados con `tsx --test`. ✅

---

## Existing code to reuse

- `src/viewer/state.ts` — `AppState`: extender `activeTool` y agregar colecciones de anotaciones.
- `src/viewer/interaction.ts` — control de eventos del mouse/puntero (`mousedown`, `mousemove`, `mouseup`), shortcuts de teclado y ciclo de vida de herramientas.
- `src/viewer/rendering.ts` — integración del hook de redibujado cuando cambian el corte, zoom o pan.
- `src/shared/roving.ts` — navegación accesible por teclado en los nuevos botones de la barra de herramientas.
- `src/shared/dom.ts` — `escapeHtml` para sanitizar etiquetas flotantes y valores.
- `src/i18n/i18n.ts` — función `t()` y directivas `data-i18n` / `data-i18n-attr`.

---

## Design

### 1. Capa de Renderizado (Overlay Canvas 2D)

Se superpone un elemento `<canvas id="annotation-overlay">` posicionado de manera absoluta sobre `#viewer-canvas`.

- **Justificación sobre SVG o WebGL:** Canvas 2D ofrece alto rendimiento en el trazado continuo de líneas guía mientras el usuario arrastra el mouse, no sobrecarga el árbol DOM con elementos SVG y mantiene el contexto WebGL subyacente completamente aislado e inalterado.
- El canvas de anotaciones escucha eventos de redibujado disparados en `rendering.ts`: cuando el usuario hace pan, zoom o navega entre cortes, el overlay se borra y repinta en el mismo frame (`requestAnimationFrame`).

### 2. Capa de Estado (`src/viewer/state.ts`)

```ts
export type ViewerTool =
  "wl" | "zoom" | "pan" | "crosshair" | "length" | "ellipse";

export interface Point2D {
  x: number; // Coordenadas en espacio de imagen (World-Space, píxeles DICOM)
  y: number;
}

export interface BaseAnnotation {
  id: string;
  sopInstanceUid?: string;
  sliceIndex: number;
  isCalibrated: boolean;
  unit: "mm" | "px" | "mm²" | "px²";
}

export interface LengthAnnotation extends BaseAnnotation {
  type: "length";
  start: Point2D;
  end: Point2D;
  distance: number;
}

export interface EllipseAnnotation extends BaseAnnotation {
  type: "ellipse";
  center: Point2D;
  radiusX: number; // En píxeles de imagen
  radiusY: number;
  area: number;
  meanHu?: number;
  stdDevHu?: number;
  minHu?: number;
  maxHu?: number;
}

export type Annotation = LengthAnnotation | EllipseAnnotation;
```

Las anotaciones se almacenan en `state.annotations: Map<string, Annotation[]>` indexadas por `sliceIndex` (o `sopInstanceUid`).

### 3. Capa Matemática (`src/viewer/measurements/measurement-math.ts`)

#### A. Conversión Screen-Space ↔ World-Space (Image-Space)

Sea el viewport con dimensiones de pantalla $W, H$, offset de paneo $(pan.x, pan.y)$, factor de zoom $zoom$, escala base de ajuste $s_0$ y dimensiones del DICOM $cols, rows$:
$$\text{scale} = s_0 \cdot zoom$$

- **Screen-Space $(x_s, y_s)$ a World-Space $(x_w, y_w)$:**
  $$x_w = \frac{x_s - \frac{W}{2} - pan.x}{\text{scale}} + \frac{cols}{2}$$
  $$y_w = \frac{y_s - \frac{H}{2} - pan.y}{\text{scale}} + \frac{rows}{2}$$

- **World-Space $(x_w, y_w)$ a Screen-Space $(x_s, y_s)$:**
  $$x_s = \frac{W}{2} + pan.x + \left(x_w - \frac{cols}{2}\right) \cdot \text{scale}$$
  $$y_s = \frac{H}{2} + pan.y + \left(y_w - \frac{rows}{2}\right) \cdot \text{scale}$$

#### B. Distancia Lineal Calibrada y Fallback

Sea $\Delta x = |end.x - start.x|$ y $\Delta y = |end.y - start.y|$ en coordenadas de imagen (World-Space):

- **Con `PixelSpacing = [rowSpacing, colSpacing]` válido:**
  $$d_{\text{mm}} = \sqrt{(\Delta x \cdot colSpacing)^2 + (\Delta y \cdot rowSpacing)^2}$$
- **Sin `PixelSpacing` (Fallback):**
  $$d_{\text{px}} = \sqrt{\Delta x^2 + \Delta y^2}$$

#### C. Área de Elipse Calibrada y Fallback

Sean $r_x, r_y$ los semiejes de la elipse en coordenadas de imagen:

- **Con `PixelSpacing` válido:**
  $$Area_{\text{mm}^2} = \pi \cdot (r_x \cdot colSpacing) \cdot (r_y \cdot rowSpacing)$$
- **Sin `PixelSpacing` (Fallback):**
  $$Area_{\text{px}^2} = \pi \cdot r_x \cdot r_y$$

#### D. Muestreo Iterativo y Cálculo Estadístico de Unidades Hounsfield (HU)

Para una elipse sobre un corte de TC:

1. **Bounding Box Clamping:**
   Se calcula la caja delimitadora entera en el espacio de imagen:
   $$i_{\min} = \max(0, \lfloor center.x - r_x \rfloor), \quad i_{\max} = \min(cols - 1, \lceil center.x + r_x \rceil)$$
   $$j_{\min} = \max(0, \lfloor center.y - r_y \rfloor), \quad j_{\max} = \min(rows - 1, \lceil center.y + r_y \rceil)$$
2. **Evaluación de Pertenencia (Inclusión Cuadrática):**
   Para cada pixel discreto $(i, j) \in [i_{\min}, i_{\max}] \times [j_{\min}, j_{\max}]$:
   $$\text{inside} = \left(\frac{(i - center.x)^2}{r_x^2} + \frac{(j - center.y)^2}{r_y^2} \le 1\right)$$
3. **Transformación a Unidades Hounsfield:**
   Para cada píxel interior, se lee el valor crudo $PV = \text{pixelData}[j \cdot cols + i]$ y se aplica:
   $$HU = PV \cdot \text{RescaleSlope} + \text{RescaleIntercept}$$
4. **Agregación Estadística:**
   Se acumulan en un solo pase:
   - Contador de píxeles: $N = \sum 1$
   - Suma lineal: $\sum HU$
   - Suma cuadrática: $\sum HU^2$
   - Extremos: $\min(HU)$, $\max(HU)$

   $$\overline{HU} = \frac{\sum HU}{N}, \quad SD = \sqrt{\frac{\sum HU^2 - \frac{(\sum HU)^2}{N}}{N - 1}}$$
   El tiempo de ejecución para una elipse clínica típica ($r \approx 30$ px, $\approx 2800$ evaluaciones) es menor a $0.3\text{ ms}$, garantizando fluidez total en el hilo principal.

---

## Affected files

- `src/viewer/state.ts`:
  - Extender unión `activeTool` con `"length" | "ellipse"`.
  - Agregar interfaz `Annotation`, `LengthAnnotation`, `EllipseAnnotation` y `state.annotations`.
- `src/viewer/measurements/measurement-math.ts` (Nuevo archivo):
  - Funciones puras: `screenToWorld`, `worldToScreen`, `calculateDistance`, `calculateEllipseArea`, `calculateEllipseHUStats`.
- `src/viewer/measurements/measurement-math.test.ts` (Nuevo archivo):
  - Cobertura unitaria exhaustiva de cálculos de distancia, área, conversiones espaciales y algoritmo de muestreo HU con matrices simuladas.
- `src/viewer/measurements/measurement-overlay.ts` (Nuevo archivo):
  - Lógica de renderizado Canvas 2D (trazado de líneas, cruces de anclaje, elipses, badges con texto e iconos de advertencia).
- `src/viewer/interaction.ts`:
  - Manejo de clics y arrastre cuando `state.activeTool` es `"length"` o `"ellipse"`.
  - Teclas de acceso directo (`L` para regla, `E` para elipse, `Escape` para cancelar trazado, `Delete`/`Backspace` para borrar seleccionada).
- `src/viewer/rendering.ts`:
  - Integración para llamar a `renderMeasurementOverlay()` sincronizado con el ciclo de repintado del visor.
- `src/index.html`:
  - Incorporación de botones de regla (`#tool-length`) y elipse (`#tool-ellipse`) en la botonera `#toolbar-tools`, y canvas `#annotation-overlay`.
- `src/styles.css`:
  - Posicionamiento absolute y `pointer-events` para `#annotation-overlay`, clases de cursor crosshair de precisión, y estilos para badges.
- `src/i18n/locales/es.ts` & `src/i18n/locales/en.ts`:
  - Claves para tooltips, etiquetas, advertencias de calibración y unidades.

---

## Testing strategy

1. **Unit tests (`tsx --test`):**
   - Validación geométrica de `calculateDistance`:
     - Caso anisotrópico: $rowSpacing \neq colSpacing$.
     - Caso fallback: sin calibración espacial ($colSpacing = rowSpacing = 1$).
   - Validación de `calculateEllipseArea`:
     - Círculo ($r_x = r_y$) y elipse asimétrica.
   - Validación de `calculateEllipseHUStats`:
     - Matriz con valores sintéticos constantes (verificar $\overline{HU}$ exacto y $SD = 0$).
     - Matriz con gradientes conocidos.
     - Bounding box en bordes de imagen (verificar que no haya lecturas fuera de límites).
2. **DOM & Paridad i18n:**
   - `npm test` ejecutando `i18n.test.ts` para asegurar que las nuevas claves coincidan al 100% entre español e inglés.
3. **Manual / BDD:**
   - Validación con escenarios de [`002-measurement-tools.feature`](002-measurement-tools.feature).

---

## Desktop parity steps

1. Completar la implementación y tests en `MICD_WEB/src`.
2. En el repositorio `desktop/`:
   - Ejecutar `make sync-web`.
   - Ejecutar `make parity` (debe retornar match exacto sin diferencias).
   - Ejecutar `npm run build && npm test` en `desktop`.

---

## Rollout / delivery

- **Rama:** `feat/length-tool` (o `feat/tk-26-measurement-tools`).
- **Verificación:** `npm run build && npm test` en verde antes de solicitar review de PR.
