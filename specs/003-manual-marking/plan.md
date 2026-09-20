# Plan: Marcado manual ad hoc en visor DICOM (Regiones Poligonales)

> **Spec:** `specs/003-manual-marking/spec.md` · **Ticket:** US-48 · **Date:** 2026-09-20

## Summary

Implementar la herramienta de **Marcado Manual de Regiones (`polygon`)** en el visor DICOM de MICD, permitiendo delimitar lesiones y contornos anatómicos irregulares de forma totalmente independiente de algoritmos de Inteligencia Artificial. La solución reutiliza la infraestructura modular de la TK-26 (Canvas 2D overlay, proyecciones Screen ↔ World en `measurement-math.ts` y persistencia en `annotation-state.ts`), extendiendo los modelos para soportar polígonos con arreglos de vértices `Point2D[]`, cálculo de área por fórmula de Shoelace (Gauss), un subsistema robusto de hit-testing para alternar entre edición de vértices individuales y traslación rígida de la forma, y un exportador client-side que genera archivos `"<nombre del file> - segmentacion hecha.json"` mediante la API estándar de Blobs del navegador.

---

## Constitution check

- **I. Local viewing is free:** El trazado de regiones, su edición y su exportación residen 100% en el cliente web/desktop; funcionan sin conexión a internet ni dependencia de servicios de backend o autenticación. ✅
- **II. Plain platform / no new dependencies:** Se emplean exclusivamente APIs nativas (`CanvasRenderingContext2D`, `Blob`, `URL.createObjectURL`) y algoritmos matemáticos en TypeScript puro (Shoelace para área, Ray Casting para inclusión). Cero dependencias externas agregadas. ✅
- **III. Desktop parity by vendoring:** El código se escribe íntegramente en `src/` de `MICD_WEB`. Al ejecutarse `make sync-web`, se replica verbatim en `desktop/` sin bifurcaciones condicionales. ✅
- **IV. Bilingual by construction:** Nuevas claves para la herramienta, tooltips y mensajes de exportación incorporadas en sincronía exacta en `src/i18n/locales/es.ts` y `src/i18n/locales/en.ts`. Verificado por `i18n.test.ts`. ✅
- **V. Accessibility (WCAG 2.2 AA):**
  - Botón `#tool-polygon` integrado a la botonera con `roving.ts` (un único tab stop para el grupo de herramientas).
  - Estado activo señalado con `aria-pressed="true"`.
  - Anuncio audible mediante `#measure-announce` (`aria-live="polite"`) al cerrar un polígono, modificar un nodo o descargar la segmentación.
  - Vértices y contornos renderizados con contraste superior a 4.5:1 sobre la escala de grises médica. ✅
- **VI. Security:** Sanitización estricta de nombres de archivo mediante expresiones regulares al exportar; serialización JSON controlada sin ejecución de scripts ni acceso a rutas de disco arbitrarias. ✅
- **VII. Tests where it counts:** Cálculos geométricos (Shoelace, Ray Casting, distancias de hit-testing) y generador de JSON testeados en aislamiento DOM-free con `tsx --test`. ✅

---

## Existing code to reuse

- `src/viewer/measurements/types.ts` — Tipos base `Point2D`, `BaseAnnotation`, `MeasurementType`.
- `src/viewer/measurements/annotation-state.ts` — Métodos de despacho y gestión de colecciones por corte (`addAnnotation`, `updateAnnotation`, `deleteAnnotation`, `getAnnotationsForSlice`, `clearAnnotations`).
- `src/viewer/measurements/measurement-math.ts` — Transformaciones espaciales `screenToWorld`, `worldToScreen`, `distToSegment` y extractor de calibración DICOM `extractCalibration`.
- `src/viewer/measurements/measurement-overlay.ts` — Ciclo de vida del `<canvas id="annotation-overlay">`, lógica de repintado coordinada con `requestAnimationFrame` y base para el hit-testing vectorial.
- `src/viewer/interaction.ts` — Despacho de puntero (`mousedown`, `mousemove`, `mouseup`), shortcuts de teclado (`Delete`, `Escape`) y manejo de herramientas activas.
- `src/shared/roving.ts` — Gestión accesible del foco en la barra de herramientas.
- `src/shared/dom.ts` — `$`, `escapeHtml` para formateo seguro de texto.
- `src/i18n/i18n.ts` — Servicio de localización `t()`.

---

## Design

### 1. Arquitectura de Datos (`src/viewer/measurements/types.ts`)

Se extiende la definición de tipos de anotación para incluir la variante `"polygon"`:

```ts
export type MeasurementType = "length" | "ellipse" | "polygon";

export interface PolygonAnnotation extends BaseAnnotation {
  type: "polygon";
  points: Point2D[]; // Coordenadas en espacio de imagen (World-Space, píxeles DICOM)
  isClosed: boolean;
  area: number; // en mm² si isCalibrated, sino en px²
  perimeter: number; // en mm si isCalibrated, sino en px
  meanHu?: number;
  stdDevHu?: number;
}

export type Annotation =
  LengthAnnotation | EllipseAnnotation | PolygonAnnotation;
```

Las regiones se indexan de forma idéntica a las medidas existentes bajo el `sopInstanceUid` del corte en `state.annotations`.

### 2. Capa Matemática (`src/viewer/measurements/measurement-math.ts`)

#### A. Cálculo de Área: Algoritmo de Shoelace (Fórmula del Agrimensor / Gauss)

Para un polígono cerrado con $N$ vértices $(x_0, y_0), \dots, (x_{N-1}, y_{N-1})$ en coordenadas de imagen:

$$\text{Area}_{\text{px}^2} = \frac{1}{2} \left| \sum_{i=0}^{N-1} (x_i y_{i+1} - x_{i+1} y_i) \right| \quad (\text{donde } x_N = x_0, y_N = y_0)$$

- **Calibración milimétrica:**
  Si el estudio posee `PixelSpacing = [rowSpacing, colSpacing]`:
  $$\text{Area}_{\text{mm}^2} = \text{Area}_{\text{px}^2} \cdot (rowSpacing \cdot colSpacing)$$
- Si carece de calibración espacial:
  $$\text{Area} = \text{Area}_{\text{px}^2} \quad (\text{unidad } px^2)$$

#### B. Cálculo de Perímetro

Suma euclidiana de las longitudes de los $N$ segmentos:

$$\text{Perimeter} = \sum_{i=0}^{N-1} d(P_i, P_{i+1})$$

donde $d(P_i, P_{i+1})$ se calcula mediante la función calibrada `calculateDistance(P_i, P_{i+1}, pixelSpacing)`.

#### C. Inclusión de Punto en Polígono: Ray-Casting (Even-Odd Rule)

Para determinar si un clic en coordenadas $(x, y)$ cae en el interior de la región: se traza un rayo horizontal semi-infinito desde $(x, y)$ hacia la derecha y se cuenta la cantidad de intersecciones con los bordes del polígono. Si el número es impar, el punto es interior.

---

### 3. Interacción y Estrategia de Edición de Nodos (`interaction.ts`)

El desafío central de la US-48 es permitir al usuario:

1. Crear polígonos mediante clics sucesivos.
2. Editar vértices específicos arrastrándolos.
3. Trasladar la forma completa si se arrastra desde un borde o su interior.

Para resolver esto de forma determinista y sin ambigüedades, se establece una máquina de estados de interacción en tres capas:

```mermaid
flowchart TD
    MDown[Pointer Down] --> HitCheck{Evaluar Hit-Testing}
    HitCheck -->|Distancia a vértice <= 8px| DragVertex[Modo: Dragging Vertex]
    HitCheck -->|Distancia a borde <= 6px o Interior| DragShape[Modo: Dragging Shape]
    HitCheck -->|Clic fuera de anotaciones| DrawMode[Modo: Drawing Polygon]

    DragVertex --> MMoveV[Pointer Move: desplazar ann.points[k]]
    DragShape --> MMoveS[Pointer Move: trasladar todos los puntos por delta]
    DrawMode --> MMoveD[Pointer Move: línea guía elástica al cursor]

    MMoveV --> MUp[Pointer Up: commit en annotation-state]
    MMoveS --> MUp
    MMoveD --> ClickClose{¿Clic cerca de punto inicial?}
    ClickClose -->|Sí <= 10px| ClosePoly[Cerrar polígono y calcular métricas]
    ClickClose -->|No| AddNode[Agregar nuevo vértice al trazo activo]
```

#### A. Algoritmo de Hit-Testing de Dos Fases

Cuando se produce un `pointerdown` con coordenadas de pantalla $(x_s, y_s)$:

1. **Fase 1 — Hit en Vértice (`hitTestPolygonVertex`):**
   - Si la anotación actualmente seleccionada es un `PolygonAnnotation`:
     - Se proyecta cada vértice a Screen-Space: $(vx_s^i, vy_s^i) = \text{worldToScreen}(P_i)$.
     - Se evalúa la distancia euclidiana al clic:
       $$d_i = \sqrt{(x_s - vx_s^i)^2 + (y_s - vy_s^i)^2}$$
     - Si $\min(d_i) \le R_{\text{handle}}$ (radio de captura: **8 píxeles**):
       - Se activa el modo de edición de vértice:
         ```ts
         dragMode = {
           kind: "vertex",
           annotationId: selectedAnnotation.id,
           vertexIndex: i,
         };
         ```
       - El cursor cambia inmediatamente a `crosshair` o `grabbing`.
       - Se omite la Fase 2 y se cancela la creación de nuevos puntos.

2. **Fase 2 — Hit en Borde o Interior (`hitTestPolygonEdgeOrInterior`):**
   - Si no se tocó ningún vértice:
     - Se verifica si el punto cae sobre cualquiera de los segmentos del polígono:
       $$\min_{i} \text{distToSegment}(x_s, y_s, vx_s^i, vy_s^i, vx_s^{i+1}, vy_s^{i+1}) \le 6\text{ px}$$
     - O si el punto cae dentro del área cerrada del polígono mediante `isPointInPolygon(worldPt, ann.points)`.
     - Si hay acierto:
       - Se marca la anotación como seleccionada: `setSelectedAnnotationId(ann.id)`.
       - Se activa el modo de traslación rígida:
         ```ts
         dragMode = {
           kind: "shape",
           annotationId: ann.id,
           startWorld: screenToWorld(x_s, y_s),
           initialPoints: ann.points.map((p) => ({ ...p })),
         };
         ```
       - El cursor cambia a `move`.

3. **Fase 3 — Trazado de Nuevo Polígono (Fallback):**
   - Si no hubo acierto en vértices ni en formas existentes:
     - Si no hay un trazado en progreso: se inicializa `activeDrawing = { type: "polygon", points: [worldPt], isClosed: false }`.
     - Si ya había un trazado en progreso:
       - Si el nuevo clic cae a menos de $10$ píxeles de pantalla de `points[0]` (o se presiona `Enter` / doble clic):
         - Se cierra el polígono (`isClosed = true`).
         - Se calculan el área (Shoelace) y el perímetro.
         - Se despacha `addAnnotation(newPolygon)` y se limpia `activeDrawing`.
       - Si no: se añade el punto: `points.push(worldPt)`.

#### B. Ejecución en `pointermove` y `pointerup`

- **En `pointermove`:**
  - Si `dragMode.kind === "vertex"`:
    - Se recalcula `ann.points[dragMode.vertexIndex] = screenToWorld(currX, currY)`.
    - Se recalculan dinámicamente área y perímetro.
    - Se repinta el Canvas 2D (`activeVp.renderOverlay()`).
  - Si `dragMode.kind === "shape"`:
    - Se calcula el desplazamiento vectorial en espacio de imagen:
      $$\vec{\Delta} = \text{screenToWorld}(currX, currY) - \text{dragMode.startWorld}$$
    - Para cada vértice: $P_i = \text{initialPoints}_i + \vec{\Delta}$.
    - Se repinta el Canvas 2D.
- **En `pointerup`:**
  - Se ejecuta `updateAnnotation(ann)` para persistir el cambio en el estado inmutable de anotaciones.
  - Se resetea `dragMode = null`.
  - Se emite el anuncio de accesibilidad en `#measure-announce` con el nuevo valor de área y perímetro.

---

### 4. Mecanismo de Guardado y Exportación Local

Para cumplir con el requerimiento de guardado local sin depender de backend ni red:

#### A. Convención de Nomenclatura del Archivo

- El nombre del archivo se deriva del archivo DICOM activo en el visor:
  ```ts
  const rawName = state.fileList[state.currentIndex]?.name || "estudio";
  const baseName = rawName.replace(/\.[^/.]+$/, ""); // Remueve extensión .dcm
  const exportFileName = `${baseName} - segmentacion hecha.json`;
  ```

#### B. Estructura del Archivo JSON Exportado

```json
{
  "version": "1.0",
  "generatedBy": "MICD Viewer (US-48)",
  "createdAt": "2026-09-20T21:55:00.000Z",
  "source": {
    "fileName": "estudio_001.dcm",
    "sopInstanceUid": "1.2.840.10008.5.1.4.1.1.2.12345",
    "seriesInstanceUid": "1.2.840.10008.5.1.4.1.1.2.67890",
    "sliceIndex": 4,
    "imageDimensions": {
      "columns": 512,
      "rows": 512
    }
  },
  "calibration": {
    "isCalibrated": true,
    "pixelSpacing": [0.703125, 0.703125],
    "unit": "mm"
  },
  "segmentation": {
    "type": "polygon",
    "isClosed": true,
    "area": 314.16,
    "perimeter": 62.83,
    "unitArea": "mm²",
    "unitPerimeter": "mm",
    "pointsCount": 16,
    "points": [
      { "x": 210.5, "y": 180.25 },
      { "x": 225.0, "y": 185.0 },
      { "x": 230.2, "y": 200.1 }
    ]
  }
}
```

#### C. Disparador de Descarga (Client-Side)

Se implementa una función pura y aislada `downloadSegmentationJson()`:

```ts
export function triggerJsonDownload(data: object, fileName: string): void {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
```

Este mecanismo funciona de forma idéntica en navegadores modernos y bajo el entorno Electron de `desktop/` sin requerir APIs propietarias.

---

### 5. Renderizado en Canvas 2D (`measurement-overlay.ts`)

- **Trazado de Contorno:** Se dibuja un `ctx.beginPath()` conectando los vértices en Screen-Space con estilo punteado o continuo de 2px de ancho.
- **Relleno Translúcido:** `ctx.fillStyle = "rgba(0, 230, 118, 0.15)"` para resaltar el área segmentada sin tapar la anatomía subyacente.
- **Manijas de Vértices (Handles):**
  - Cuando `selectedAnnotationId === ann.id`:
    - Para cada vértice se dibuja un círculo de radio 4px con borde blanco y relleno temático (`rgba(0, 230, 118, 0.9)`), lo que brinda un blanco visual inequívoco para el arrastre.
- **Badge Informativo:** Tarjeta semitransparente con tipografía monoespaciada legible indicando el área y perímetro calculados.

---

## Affected files

- `src/viewer/measurements/types.ts`:
  - Agregar `PolygonAnnotation` y extender `MeasurementType` y la unión `Annotation`.
- `src/viewer/measurements/measurement-math.ts`:
  - Incorporar funciones puras: `calculatePolygonArea`, `calculatePolygonPerimeter`, `isPointInPolygon`, `hitTestPolygonVertices`, `hitTestPolygonEdgeOrInterior`.
- `src/viewer/measurements/measurement-math.test.ts`:
  - Pruebas unitarias de cálculo de área de polígonos convexos y cóncavos, algoritmos de pertenencia (Ray-Casting) y precisión del hit-testing de vértices.
- `src/viewer/measurements/measurement-overlay.ts`:
  - Renderizado de polígonos cerrados, trazado elástico durante la creación y dibujo de manijas de vértices en regiones seleccionadas.
- `src/viewer/measurements/export-annotation.ts` (Nuevo archivo):
  - Lógica de construcción del payload JSON de la segmentación y despacho de descarga client-side.
- `src/viewer/measurements/export-annotation.test.ts` (Nuevo archivo):
  - Validación unitaria de la estructura JSON generada y sanitización del nombre del archivo.
- `src/viewer/interaction.ts`:
  - Integración de la herramienta `"polygon"`.
  - Implementación de la máquina de estados de edición (`dragMode`: `"vertex"` vs `"shape"`).
  - Manejo de atajos de teclado y clics para cerrar polígonos.
- `src/index.html`:
  - Botón `#tool-polygon` en la barra de herramientas y botón `#btn-export-segmentation` en el panel de acciones/exportación.
- `src/styles.css`:
  - Clases de cursor (`cursor: crosshair`, `cursor: move`) y estilos visuales para los controles de polígonos.
- `src/i18n/locales/es.ts` & `src/i18n/locales/en.ts`:
  - Claves para tooltips de polígono, confirmaciones de guardado y mensajes de accesibilidad.

---

## Testing strategy

1. **Unit tests (`tsx --test` / `node:test`):**
   - `calculatePolygonArea`: Polígono cuadrado de $10 \times 10$ px $\to 100\text{ px}^2$; calibrado con spacing $0.5 \to 25\text{ mm}^2$.
   - Polígonos cóncavos (ej. forma de "L"): verificar que el algoritmo de Shoelace computa el área exacta independientemente del orden de los vértices (horario vs antihorario).
   - `isPointInPolygon`: Puntos interiores, exteriores y en bordes.
   - `hitTestPolygonVertices`: Verificación de captura dentro del umbral de radio y descarte fuera del radio.
   - `export-annotation`: Validación de schema JSON y generación de nombre correcto `"<file> - segmentacion hecha.json"`.
2. **Paridad i18n:**
   - `npm test` para asegurar igualdad estricta de claves entre español e inglés.
3. **Validación BDD:**
   - Ejecución de los escenarios descriptos en `specs/003-manual-marking/003-manual-marking.feature`.

---

## Desktop parity steps

1. Completar la implementación y suite de tests en `MICD_WEB/src`.
2. En el repositorio hermano `desktop/`:
   - Ejecutar `make sync-web`.
   - Ejecutar `make parity` (debe retornar 0 diferencias).
   - Ejecutar `npm run build && npm test`.

---

## Rollout / delivery

- **Rama sugerida:** `feat/us-48-manual-marking` (desprendida de `dev`).
- **Commits estructurados:** Separados por fases (Modelos/Math $\to$ Render $\to$ Interacción/Edición $\to$ Exportación).
- **Verificación:** `npm run build && npm test` en verde antes de solicitar code review.
