# Tasks: Herramientas de medición (longitud y área)

> **Spec:** `specs/002-measurement-tools/spec.md` · **Plan:** `specs/002-measurement-tools/plan.md` · **Ticket:** TK-26

Lista ordenada y ejecutable de tareas. Las tareas marcadas con `[P]` representan componentes o infraestructuras paralelizables (sin dependencia secuencial estricta).

---

## Phase 0 — Setup & Especificación

- [x] T001 Inicializar rama de trabajo `feat/length-tool` (o `feat/tk-26-measurement-tools`).
- [x] T002 Registrar el ticket `[002] TK-26` en el índice de [`specs/README.md`](../README.md).
- [x] T003 Redactar y aprobar [`spec.md`](spec.md) y [`plan.md`](plan.md).

---

## Phase 1 — Tests & Criterios de Aceptación Primero

- [x] T010 Formalizar escenarios BDD en [`002-measurement-tools.feature`](002-measurement-tools.feature).
- [x] T011 [P] Crear suite de pruebas unitarias para cálculos geométricos y HU en `src/viewer/measurements/measurement-math.test.ts` y `annotation-state.test.ts`:
  - Test de distancia euclidiana en píxeles (sin calibración).
  - Test de distancia calibrada anisotrópica con `PixelSpacing` ($rowSpacing \neq colSpacing$).
  - Test de área de elipse calibrada y no calibrada.
  - Test de conversiones de coordenadas Screen-Space ↔ World-Space con zoom y pan.
  - Test de muestreo iterativo de elipse y cálculo de Unidades Hounsfield ($\overline{HU} \pm SD$, min, max) con buffer sintético y rescale slope/intercept.
  - Test de protección contra desbordamiento de límites de imagen (bounding box clamping).
  - Test de persistencia y aislamiento de anotaciones indexadas por SOPInstanceUID.

---

## Phase 2 — Implementación

- [x] T020 [P] **Infraestructura de Estado (`src/viewer/state.ts` y `annotation-state.ts`):**
  - Extender `ViewerTool` para incluir `"length" | "ellipse"`.
  - Definir interfaces `Point2D`, `LengthAnnotation`, `EllipseAnnotation`, `Annotation`.
  - Agregar `annotations: Record<string, Annotation[]>` en `AppState`.
  - Dispatchers `addAnnotation`, `updateAnnotation`, `deleteAnnotation`, `getAnnotationsForSlice`, `clearAnnotations`.
- [x] T021 [P] **Capa Matemática Pura (`src/viewer/measurements/measurement-math.ts`):**
  - Implementar `screenToWorld` y `worldToScreen`.
  - Implementar `calculateDistance` y `calculateEllipseArea`.
  - Implementar `calculateEllipseHUStats` (muestreo acotado por bounding box + pertenencia cuadrática + cálculo estadístico de pase único).
- [x] T022 [P] **Internacionalización (`src/i18n/locales/es.ts` y `en.ts`):**
  - Claves para tooltips (`viewer.tool.lengthTitle`, `viewer.tool.ellipseTitle`).
  - Claves para métricas y advertencia (`annotations.length`, `annotations.area`, `annotations.mean`, `annotations.stdDev`, `annotations.uncalibrated`).
  - Validado con `npm test` (`i18n.test.ts`).
- [ ] T023 **Capa de Renderizado Overlay (`src/viewer/measurements/measurement-overlay.ts`):**
  - Crear e inicializar `<canvas id="annotation-overlay">` superpuesto en `index.html`.
  - Implementar dibujado de líneas de regla, cursores de anclaje, elipses y badges semitransparentes con textos de medidas y advertencias.
  - Sincronizar el redibujado en `src/viewer/rendering.ts` ante eventos de render, zoom, pan y cambio de corte.
- [ ] T024 **Interacción y Manejo de Eventos (`src/viewer/interaction.ts`):**
  - Registrar handlers de mouse (`mousedown`, `mousemove`, `mouseup`) para iniciar, arrastrar y consolidar mediciones lineales y elípticas.
  - Atajos de teclado para selección rápida (`L` para regla, `E` para elipse) y cancelación (`Escape`).
  - Soporte para eliminación de anotación seleccionada (`Delete` / `Backspace`).
  - Anuncio accesible en región aria-live al consolidar una medición.
- [ ] T025 **Estilos y Maquetación (`src/styles.css`):**
  - Posicionamiento absoluto y dimensiones reactivas para `#annotation-overlay`.
  - Reglas de cursor de precisión para herramientas de medición (`cursor-crosshair`).
  - Estilos de alto contraste y legibilidad para badges y advertencias de no-calibración.

---

## Phase 3 — Paridad con Desktop (`MICD_APP`)

- [ ] T030 Ejecutar `make sync-web` en el repositorio hermano `desktop/`.
- [ ] T031 Ejecutar `make parity` en `desktop/` (verificar salida limpia/cero diferencias).
- [ ] T032 Correr `npm run build && npm test` en `desktop/`.

---

## Phase 4 — Verificación y Entrega

- [ ] T040 Validar compilación limpia sin errores de tipos: `npm run build`.
- [ ] T041 Validar pase total de la suite de tests: `npm test`.
- [ ] T042 Ejecutar detector mecánico de calidad visual:
  ```bash
  .github/skills/impeccable/scripts/impeccable detect --json src/index.html src/styles.css
  ```
- [ ] T043 Ejecutar `pre-commit run --all-files`.
- [ ] T044 Crear commit con convención del proyecto (`feat(viewer): measurement tools for length and ellipse area (TK-26)`).
