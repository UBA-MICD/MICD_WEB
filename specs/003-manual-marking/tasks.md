# Tasks: Marcado manual ad hoc en visor DICOM (Regiones Poligonales)

> **Spec:** `specs/003-manual-marking/spec.md` · **Plan:** `specs/003-manual-marking/plan.md` · **Ticket:** US-48

Tareas ordenadas y verificables para la implementación del marcado manual de regiones y edición de nodos.
`[P]` indica tareas que pueden ejecutarse en paralelo sin dependencias de ordenamiento.

---

## Phase 0 — Setup

- [ ] T001 Crear rama de trabajo a partir de `dev`: `feat/us-48-manual-marking`.

---

## Phase 1 — Tests / Acceptance first

- [ ] T010 [P] Escribir suite de pruebas unitarias de geometría en `src/viewer/measurements/measurement-math.test.ts`:
  - Cálculo de área por fórmula de Shoelace (polígonos convexos y cóncavos, calibrados y no calibrados).
  - Cálculo de perímetro poligonal.
  - Algoritmo de punto en polígono (Ray Casting / Even-Odd rule).
  - Hit-testing de vértices por radio euclidiano y detección de bordes.
- [ ] T011 [P] Escribir suite de pruebas unitarias para exportación JSON en `src/viewer/measurements/export-annotation.test.ts`:
  - Generación de estructura y schema del payload JSON.
  - Formateo y sanitización del nombre de archivo (`"<file> - segmentacion hecha.json"`).
- [ ] T012 [P] Escribir pruebas de integración de hit-testing en `src/viewer/measurements/measurement-overlay.test.ts`.

---

## Phase 2 — Implementation

### 1) Modelos y Estado

- [ ] T020 Extender `src/viewer/measurements/types.ts`:
  - Añadir `"polygon"` a `MeasurementType`.
  - Definir la interfaz `PolygonAnnotation` extendiendo `BaseAnnotation`.
  - Actualizar la unión `Annotation = LengthAnnotation | EllipseAnnotation | PolygonAnnotation`.
- [ ] T021 Extender `src/viewer/state.ts`:
  - Añadir `"polygon"` a la unión `ViewerTool`.
  - Agregar campos para el seguimiento de la edición (`dragMode: { kind: "vertex" | "shape"; ... }`).
- [ ] T022 Verificar compatibilidad en `src/viewer/measurements/annotation-state.ts`:
  - Asegurar que `addAnnotation`, `updateAnnotation`, `deleteAnnotation` y `getAnnotationsForSlice` manejen `PolygonAnnotation` sin modificaciones invasivas.

### 2) Interacción de Dibujo (Pointer Events)

- [ ] T023 Implementar funciones matemáticas puras en `src/viewer/measurements/measurement-math.ts`:
  - `calculatePolygonArea(points, pixelSpacing)`.
  - `calculatePolygonPerimeter(points, pixelSpacing)`.
  - `isPointInPolygon(point, polygon)`.
- [ ] T024 Configurar evento de inicio de trazado en `src/viewer/interaction.ts`:
  - Manejo de clics sucesivos cuando `state.activeTool === "polygon"` para acumular vértices en `activeDrawing`.
  - Trazado de línea elástica guía en `mousemove` desde el último vértice al cursor actual.
- [ ] T025 Implementar condición de cierre de polígono en `src/viewer/interaction.ts`:
  - Detección de proximidad al primer vértice ($\le 10$ px de pantalla) o acción explícita (doble clic / tecla `Enter`).
  - Creación de `PolygonAnnotation` definitiva con cálculo de área/perímetro y despacho a `addAnnotation`.
  - Anuncio accesible en `#measure-announce`.

### 3) Lógica de Edición de Nodos (Hit-testing y Arrastre)

- [ ] T026 Implementar hit-testing discriminativo en `src/viewer/measurements/measurement-math.ts` y `measurement-overlay.ts`:
  - `hitTestPolygonVertices`: detección de toque en manija de vértice individual ($R \le 8$ px).
  - `hitTestPolygonEdgeOrInterior`: detección de toque en contorno ($\le 6$ px) o interior.
- [ ] T027 Conectar lógica de arrastre en `src/viewer/interaction.ts`:
  - En `pointerdown`: diferenciar entre `dragMode: "vertex"` (edición de nodo) y `dragMode: "shape"` (traslación global).
  - En `pointermove`:
    - Si `"vertex"`: actualizar exclusivamente `ann.points[k]` con la proyección `screenToWorld` y recalcular métricas.
    - Si `"shape"`: desplazar todos los puntos uniformemente por el vector $\vec{\Delta}$.
  - En `pointerup`: persistir los cambios mediante `updateAnnotation` y restaurar cursor.
- [ ] T028 Soportar eliminación de región seleccionada en `src/viewer/interaction.ts`:
  - Escuchar teclas `Delete` y `Backspace` para remover la región activa mediante `deleteAnnotation`.

### 4) Renderizado y Exportación

- [ ] T029 Implementar renderizado de polígonos en `src/viewer/measurements/measurement-overlay.ts`:
  - Dibujo de contorno continuo con relleno semitransparente.
  - Dibujo de manijas circulares interactivas ("handles") sobre los vértices cuando la región está en estado `selected`.
  - Badge flotante con área, perímetro e indicador de calibración.
- [ ] T030 Crear módulo de exportación `src/viewer/measurements/export-annotation.ts`:
  - Construcción del objeto JSON enriquecido con metadatos del estudio y coordenadas del polígono.
  - Disparador de descarga client-side vía `Blob` y enlace virtual `<a download>`.
  - Asignación estricta del nombre `"<nombre del file> - segmentacion hecha.json"`.
- [ ] T031 Incorporar controles UI en `src/index.html` y estilos en `src/styles.css`:
  - Botón `#tool-polygon` en la barra de herramientas `#toolbar-tools`.
  - Botón `#btn-export-segmentation` en el panel de acciones.
  - Estilos para cursor de precisión y manijas interactivas.
- [ ] T032 Paridad de internacionalización (i18n):
  - Agregar claves en `src/i18n/locales/es.ts` y `src/i18n/locales/en.ts` (labels de botón, tooltips, anuncios de voz).

---

## Phase 3 — Desktop parity

- [ ] T033 Ejecutar `make sync-web` en el repositorio `desktop/`.
- [ ] T034 Ejecutar `make parity` en `desktop/` para confirmar sincronización 1:1 sin diferencias.
- [ ] T035 Ejecutar `npm run build && npm test` en `desktop/` verificando compilación limpia.

---

## Phase 4 — Verify & deliver

- [ ] T036 Ejecutar suite completa en `web/`: `npm run build && npm test` (tests de matemáticas, overlay e i18n en verde).
- [ ] T037 Validación manual de los escenarios BDD definidos en `specs/003-manual-marking/003-manual-marking.feature`.
- [ ] T038 Commit estructurado con trailers obligatorios y apertura del Pull Request hacia `dev`.
