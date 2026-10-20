# Spec: [US-50] Mejoras 3D y MPR Oblicuo con Grilla 2x2 y Calidad Clínica

> **Number:** 006 · **Slug:** `006-mpr-oblique-ux` · **Ticket:** US-50 / 3D & Oblique MPR Clinical Overhaul
> **Status:** Draft · **Author:** MICD Architecture & Clinical UX Team · **Date:** 2026-10-04
> **Repos affected:** `web` (authored) · `desktop` (via vendoring en `src/renderer/`)

---

## Why (problem & motivation)

La auditoría UX/UI y el relevamiento técnico del módulo actual de visualización 3D y Multiplanar (MPR) revelaron brechas críticas que impiden su adopción en entornos de diagnóstico clínico real (Hospital de Clínicas):

1. **Ausencia de un Verdadero MPR Ortogonal (Modelo Mental Roto):**
   Actualmente, el visor opera bajo un esquema de "viewport único" donde el usuario debe alternar secuencialmente entre Axial, Sagital, Coronal y 3D. En la práctica radiológica estándar (OHIF, Horos, OsiriX), el MPR exige una **grilla simultánea 2×2** donde los tres planos ortogonales y la vista volumétrica se inspeccionan coordinadamente.
2. **Incapacidad de Cortes Oblicuos / Diagonales:**
   Las reconstrucciones están fijadas a los ejes canónicos cartesianos del volumen. Lesiones complejas (ej. seguimiento del trayecto vascular coronario, fémur, conducto biliar o anomalías neurológicas) exigen cortes en planos inclinados (_Oblique MPR_) rotando interactivamente los ejes de corte sobre un punto focal común.
3. **Calidad Visual Plana en Raymarching (Sin Iluminación):**
   El shader volumétrico actual realiza composición alpha de densidades sin calcular normales de superficie ni aplicar modelos de iluminación difusa (_Phong/Blinn-Phong_). Esto hace que las estructuras óseas y parenquimatosas se perciban como nubes semitransparentes sin relieve, oclusión ni profundidad anatómica.
4. **Gizmo Anatómico Pasivo y No Accesible:**
   El cubo de referencia `#mpr-reference-cube` es meramente ilustrativo (`pointer-events: none;`) y no permite hacer clic sobre sus caras para alinear la cámara rápidamente a proyecciones diagnósticas estándar. Sus líneas traseras no alcanzan el ratio 3:1 de contraste no textual de WCAG 1.4.11.
5. **Ergonomía de Mouse Anticlínica y Bloqueo de Pan:**
   La herramienta de traslación (_Pan_) está deshabilitada artificialmente en modo 3D. El uso de clic izquierdo compite entre la órbita de cámara y el ajuste de Window/Level, generando continuos desajustes involuntarios.
6. **Controles Flotantes Intrusivos y Falta de Feedback de Carga:**
   El slider de profundidad vertical tapa el HUD clínico superior derecho, y series con más de 200 cortes dejan la pantalla congelada con un spinner indefinido sin indicar progreso real de descarga y decodificación.

---

## Who (users & roles)

- **Médico Radiólogo / Especialista en Diagnóstico por Imágenes:** Requiere cortes oblicuos multi-eje sincronizados en tiempo real y una vista 3D con sombreado de superficie para discernir fracturas complejas o patologías vasculares.
- **Cirujano / Planificador Quirúrgico:** Utiliza el volumen 3D con iluminación Phong y presets tisulares (Hueso vs Tejido blando) para entender la relación espacial entre tumores y estructuras críticas antes de ingresar a quirófano.
- **Investigador / Usuario Académico (FIUBA / TPP):** Requiere que el visor funcione en navegadores web estándar sin plugins ni dependencias externas propietarias, con soporte bilingüe (ES/EN) y accesibilidad WCAG 2.2 AA.

---

## What (user stories)

- Como **radiólogo**, quiero ver simultáneamente los planos Axial, Sagital, Coronal y la reconstrucción 3D en una grilla de 2×2 con crosshairs coordinados, para evaluar una estructura anatómica en los tres planos espaciales de forma inmediata.
- Como **especialista**, quiero rotar interactivamente las líneas del crosshair en cualquiera de los planos para generar un corte oblicuo instantáneo a 60 FPS, permitiendo seguir estructuras anatómicas tortuosas que no coinciden con los ejes canónicos.
- Como **cirujano**, quiero que el renderizado 3D incluya iluminación y relieve anatómico realista (sombreado Phong) junto con presets tisulares rápidos (_Hueso_, _Tejido Blando_, _MIP_), para distinguir bordes corticales óseos y vasculares nítidamente.
- Como **usuario**, quiero hacer clic en las caras del cubo anatómico (A, P, L, R, S, I) para que la vista volumétrica rote y se oriente de frente a esa proyección automáticamente.
- Como **radiólogo**, quiero usar los tres botones del ratón según la convención clínica internacional (Izquierdo: Órbita/Crosshair, Derecho: Window/Level dinámico, Central: Pan en todos los modos), sin bloqueos artificiales ni cambios modales continuos.
- Como **usuario**, quiero ver una barra de progreso que indique la cantidad de cortes decodificados (`X / N cortes`) al construir el volumen 3D, para tener certidumbre de los tiempos de espera en series densas.

---

## Functional Requirements (FR)

### FR-01: Grilla Multi-Viewport 2×2 Sincronizada

- **FR-01.1:** El modo MPR debe estructurar el área de trabajo en una grilla regular 2×2:
  - Cuadrante Superior Izquierdo: Plano Axial (indicador de borde turquesa/cyan).
  - Cuadrante Superior Derecho: Plano Sagital (indicador de borde rojo/coral).
  - Cuadrante Inferior Izquierdo: Plano Coronal (indicador de borde verde/esmeralda).
  - Cuadrante Inferior Derecho: Vista 3D Volumétrica con Gizmo (indicador de borde ámbar/dorado).
- **FR-01.2:** Cada viewport debe poseer su propio canvas WebGL2 / 2D y etiquetas cardinales de orientación anatómica en sus 4 extremos.
- **FR-01.3:** Doble clic (o botón dedicado en el encabezado del cuadrante) debe maximizar el cuadrante seleccionado a 1×1 y permitir retornar a 2×2 sin perder transformaciones ni posición de corte.
- **FR-01.4:** El Crosshair 3D debe proyectar líneas de referencia cruzadas en los tres cuadrantes 2D, con colores normalizados coincidentes con los bordes de cada plano.

### FR-02: Reconstrucción Multiplanar Oblicua (Oblique MPR)

- **FR-02.1:** Cada plano de corte debe estar parametrizado por un punto focal $\mathbf{C} \in \mathbb{R}^3$ y dos vectores ortonormales en el plano $\mathbf{u}, \mathbf{v} \in \mathbb{R}^3$, con vector normal $\mathbf{n} = \mathbf{u} \times \mathbf{v}$.
- **FR-02.2:** Al hacer clic y arrastrar sobre el cuerpo de una línea del crosshair en cualquier plano, se debe desplazar el plano perpendicular correspondiente.
- **FR-02.3:** Al hacer clic y arrastrar sobre el extremo de una línea del crosshair (zona de manipulación angular), se debe aplicar una matriz de rotación tridimensional $\mathbf{R}$ alrededor del centro $\mathbf{C}$, recalculando los vectores base y extrayendo el corte oblicuo en WebGL2 a 60 FPS.
- **FR-02.4:** Un botón rápido "Reset Oblicuo" debe re-alinear instantáneamente los tres planos a la ortogonalidad canónica cartesiana.

### FR-03: Shaders WebGL2 con Iluminación Phong y Transfer Functions

- **FR-03.1:** El Fragment Shader de Raymarching debe calcular el gradiente local del volumen por diferencias finitas centrales en el espacio de textura tridimensional para obtener la normal de superficie $\mathbf{N} = -\nabla f / \|\nabla f\|$.
- **FR-03.2:** Implementar el modelo de iluminación de Blinn-Phong:
  $$I_{color} = I_{ambient} \cdot k_a + I_{diffuse} \cdot k_d \max(\mathbf{N} \cdot \mathbf{L}, 0) + I_{specular} \cdot k_s \max(\mathbf{N} \cdot \mathbf{H}, 0)^\alpha$$
  con vector de luz direccional $\mathbf{L}$ vinculado a la cámara.
- **FR-03.3:** Soportar selector de Transfer Functions mediante uniform `u_presetMode`:
  - `0: Grayscale W/L`: Composición lineal translúcida estándar.
  - `1: Bone`: Resalta densidades altas (HU > 200) con opacidad opaca y color marfil.
  - `2: Soft Tissue`: Resalta tejido blando y piel con transparencia calibrada.
  - `3: MIP (Maximum Intensity Projection)`: Retorna la densidad máxima en la trayectoria del rayo.

### FR-04: Cubo Anatómico (Gizmo) Interactivo y Accesible

- **FR-04.1:** El canvas `#mpr-reference-cube` debe capturar eventos de puntero (`pointerdown`) y ejecutar hit-testing geométrico en espacio de pantalla 2D sobre los polígonos proyectados de las caras frontales (`isFront == true`).
- **FR-04.2:** El clic sobre una cara (A, P, L, R, S, I) debe animar la cámara 3D mediante interpolación suave (_ease-out_) hacia la perspectiva frontal de dicha cara en menos de 300 ms.
- **FR-04.3:** Corregir el contraste de las aristas del cubo: aristas traseras con opacidad no menor a `0.35` y aristas delanteras con opacidad `0.9` (cumpliendo ratio 3:1 WCAG 1.4.11).

### FR-05: Ergonomía de Entrada Estándar y Accesibilidad WCAG 2.2 AA

- **FR-05.1:** Mapeo estricto de eventos de mouse en el área de visualización:
  - Botón Principal (Izquierdo): Rotación orbital en 3D / Desplazamiento y rotación del Crosshair en 2D.
  - Botón Secundario (Derecho): Ajuste continuo de Window/Level en tiempo real (anulando el menú contextual nativo).
  - Botón Central (Rueda presionada): Traslación (_Pan_) de la vista en todos los cuadrantes. Habilitar la herramienta `pan` en la barra de herramientas sin bloqueos en 3D.
  - Rueda de desplazamiento: Avance secuencial de corte en el viewport enfocado (`Ctrl + Rueda`: Zoom continuo).
- **FR-05.2:** Reubicar el slider de profundidad para evitar tapar el HUD de metadatos clínicos, incorporando atributos semánticos `role="slider"`, `aria-label`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow` y `aria-orientation`.
- **FR-05.3:** Agrupar los selectores de modo y presets con `role="radiogroup"` y `role="radio"` con `aria-checked`.

### FR-06: Feedback Granular en Construcción de Volumen

- **FR-06.1:** `dicomCache` y la rutina de carga volumétrica deben emitir un evento progresivo `onProgress(current, total)` durante la decodificación.
- **FR-06.2:** La UI debe renderizar un contador textual visible y anunciado a tecnologías asistivas: `"Cargando volumen 3D: X / N cortes (Y%)"`.

---

## Non-Functional Requirements (NFR)

- **NFR-01 (Rendimiento):** El raymarching 3D con cálculo de gradientes y la extracción ortogonal/oblicua de cortes deben sostener al menos 50 FPS en hardware estándar con GPU integrada (Intel Iris Xe / AMD Radeon) para volúmenes de hasta $512 \times 512 \times 300$.
- **NFR-02 (Zero Dependencias Nuevas):** Todos los cálculos de matrices, vectores y shaders se implementan en TypeScript nativo y GLSL ES 3.00, sin incorporar bibliotecas pesadas de terceros (Three.js, VTK.js).
- **NFR-03 (Bilingüe por Construcción):** Toda etiqueta, preset, tooltip y texto de accesibilidad debe contar con claves equivalentes en `src/i18n/locales/es.ts` y `src/i18n/locales/en.ts`.
- **NFR-04 (Paridad Desktop):** El layout 2×2 y los eventos de mouse deben ser 100% compatibles con Electron sin dependencias de APIs exclusivas de navegador.
