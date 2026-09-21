# Spec: Pipeline de Carga Unificado y Orientación Espacial DICOM (RLPA)

> **Number:** 004 · **Slug:** `004-study-loading` · **Ticket:** US-49 / Core Loading Unification
> **Status:** Draft · **Author:** MICD team · **Date:** 2026-09-21
> **Repos affected:** MICD_WEB (authored) · desktop (via vendoring)

---

## Why (problem & motivation)

Tras el merge con la rama `dev`, se detectaron comportamientos divergentes críticos en la visualización de estudios DICOM dependiendo de la vía de entrada utilizada:

1. **Carga por Carpeta (Folder Picker / Drag-and-Drop):** La imagen 2D se renderiza invertida verticalmente ("de cabeza"). Al cargar múltiples cortes, se dispara la construcción del volumen 3D/MPR, mientras que el renderizado 2D y el visor legacy ignoran por completo los cosenos directores de orientación anatómica `ImageOrientationPatient (0020,0037)`. Previamente existió un parche temporal en CSS (`scaleY(-1)`) en `applyCanvasTransform` que fue removido en `dev`, dejando al descubierto la falta de manejo de orientación real.
2. **Carga por Archivo .ZIP:** Los cortes se cargan desordenados. La descompresión asíncrona mediante `fflate.unzip` devuelve un diccionario de JavaScript cuyas claves no garantizan orden secuencial ni numérico. La función de ordenamiento actual `sortFilesByInstanceNumber` se limita a leer el tag opcional `InstanceNumber (0020,0013)` o a comparar alfanuméricamente nombres de archivo (que en exports PACS son cadenas arbitrarias o UIDs), ignorando las coordenadas espaciales tridimensionales de la anatomía del paciente.
3. **Carga de Archivo Suelto:** Al contener un único corte, no se ejecuta el pipeline volumétrico (`loadVolumeIntoEngines()`), enmascarando los problemas de ordenamiento y operando bajo supuestos de orientación fijos.

En el ámbito médico-clínico (Hospital de Clínicas), el orden y la orientación espacial de los estudios son **requisitos de seguridad diagnóstica innegociables**. Una imagen invertida o un volumen con cortes desordenados pueden inducir a errores graves en la lateralidad de patologías y en la navegación volumétrica.

El objetivo de esta especificación es **unificar de manera agnóstica el pipeline de carga** (abstraer archivo individual, carpeta, ZIP y servidor) mediante un modelo canónico (`StudyBuilder`) que ordene los cortes por proyección matemática sobre la normal del plano del paciente y garantice la orientación clínica estándar **RLPA (Right-Left, Posterior-Anterior)**.

---

## Who (users & roles)

- **Médico Radiólogo / Especialista Clínico:** Requiere navegar tomografías computadas (CT) y resonancias magnéticas (MRI) con orden anatómico estricto y orientación espacial fiable, independientemente de cómo se hayan exportado los archivos.
- **Validador Clínico e Investigador:** Requiere que las marcas, anotaciones y segmentaciones manuales se proyecten sobre la anatomía correcta en el corte correspondiente sin distorsiones por inversiones de coordenadas.
- **Usuario Invitado / Guest:** Conforme al **Principio I de la Constitución MICD**, la carga y visualización local de archivos (sueltos, en carpeta o en ZIP) es 100% offline, gratuita y sin requerimiento de credenciales.

---

## What (user stories)

- Como **médico radiólogo**, quiero abrir un estudio DICOM desde un archivo ZIP, una carpeta o archivos sueltos y ver los cortes ordenados de forma continua según su posición anatómica real, para evaluar la progresión céfalo-caudal de una lesión sin saltos ni cortes desfasados.
- Como **radiólogo**, quiero que el visor presente las imágenes respetando la convención radiológica estándar (Anterior arriba, Posterior abajo, Derecha del paciente a la izquierda de la pantalla, Izquierda del paciente a la derecha de la pantalla), independientemente de la posición de adquisición (supino/prono).
- Como **usuario**, quiero que las etiquetas de orientación en los cuatro extremos del viewport (`A`, `P`, `R`, `L`, `S`, `I`) reflejen dinámicamente la orientación anatómica calculada a partir de los metadatos DICOM del corte actual y no textos estáticos hardcodeados.
- Como **ingeniero de software**, quiero que todo el proceso de parseo, extracción, clasificación por series y ordenamiento geométrico ocurra en un módulo central desacoplado de la UI (`StudyBuilder`), facilitando pruebas unitarias sin DOM.

---

## Functional requirements

### FR-1: Pipeline de Carga Agnóstico de la Fuente

- El sistema DEBE proveer un único punto de entrada de procesamiento de estudios que reciba colecciones de `ArrayBuffer` (o `File`) sin importar si provienen de:
  - Selector de archivo único o múltiple (`#open-files-input`).
  - Selector de carpeta del navegador (`#open-folder-input`, `webkitdirectory`).
  - Archivos comprimidos `.zip` arrastrados o seleccionados.
  - Consulta al servidor Orthanc / backend (`loadStudyFromServer`).
- Los flujos de entrada en UI sólo deben encargarse de desempaquetar bytes (descomprimir ZIPs si corresponde) y pasar la lista de buffers al constructor de estudios.

### FR-2: Ordenamiento Espacial Riguroso (3D Slice Ordering)

- Para cada serie de imágenes, el sistema DEBE calcular el vector normal del plano de corte $\mathbf{N}$ utilizando el producto vectorial de los cosenos directores de fila ($\mathbf{R}$) y columna ($\mathbf{C}$) presentes en `ImageOrientationPatient (0020,0037)`:
  $$\mathbf{N} = \mathbf{R} \times \mathbf{C} = \begin{bmatrix} R_y C_z - R_z C_y \\ R_z C_x - R_x C_z \\ R_x C_y - R_y C_x \end{bmatrix}$$
- Para cada corte $i$, el sistema DEBE calcular la distancia proyectada $d_i$ a lo largo de la normal a partir del vector de traslación del origen `ImagePositionPatient (0020,0032)` ($\mathbf{IPP}_i$):
  $$d_i = \mathbf{IPP}_i \cdot \mathbf{N}$$
- El ordenamiento de los cortes DEBE seguir la siguiente jerarquía:
  1. **Primario:** Distancia proyectada $d_i$ (orden numérico ascendente o según la dirección canónica anatómica).
  2. **Secundario (Fallback 1):** Si falta `ImagePositionPatient` o los valores proyectados son idénticos, ordenar por `InstanceNumber (0020,0013)` ascendente.
  3. **Terciario (Fallback 2):** Si falta `InstanceNumber`, ordenar por nombre de archivo mediante ordenación natural alfanumérica (`localeCompare` con `numeric: true`).

### FR-3: Orientación Anatómica Canónica (RLPA)

- El sistema DEBE interpretar los vectores $\mathbf{R}$ y $\mathbf{C}$ de `ImageOrientationPatient` para determinar la orientación de filas y columnas con respecto a los ejes del paciente en el sistema LPS (Left, Posterior, Superior):
  - Eje $X$: Negativo = Right (R), Positivo = Left (L).
  - Eje $Y$: Negativo = Anterior (A), Positivo = Posterior (P).
  - Eje $Z$: Negativo = Inferior (I), Positivo = Superior (S).
- Si la adquisición del estudio invierte el sentido de las columnas (por ejemplo, paciente en decúbito prono donde la dirección de columnas apunta hacia Anterior en lugar de Posterior), el sistema DEBE aplicar la inversión necesaria en la proyección o rasterizado para garantizar que la presentación clínica sea consistente:
  - **Arriba:** Anterior (o Superior en cortes sagitales/coronales).
  - **Abajo:** Posterior (o Inferior en cortes sagitales/coronales).
  - **Izquierda:** Right del paciente.
  - **Derecha:** Left del paciente.

### FR-4: Etiquetas Dinámicas de Orientación Anatómica (HUD)

- Las etiquetas de orientación en los bordes del visor (Top, Bottom, Left, Right) DEBEN calcularse dinámicamente para cada imagen a partir de los vectores $\mathbf{R}$ y $\mathbf{C}$.
- Se DEBEN erradicar las asignaciones fijas hardcodeadas (`top.textContent = "A"`, etc.) que no verifican los metadatos reales de la imagen cargada.

### FR-5: Consistencia con Herramientas de Medición y Anotaciones

- La transformación matemática de coordenadas entre pantalla y mundo (`screenToWorld`, `worldToScreen` en `measurement-math.ts`) DEBE coordinarse con la transformación real del canvas y no depender de banderas booleanas mágicas como `flipY: true` desconectadas del renderer.

---

## Acceptance criteria

- **AC-1 (Paridad de resultado entre Carpeta, ZIP y Archivos):**
  - Dado un conjunto de 50 cortes DICOM de una tomografía axial, cuando se cargan mediante:
    a) Carpeta descomprimida en el disco,
    b) Archivo comprimido `.zip`,
    c) Selección múltiple de archivos `.dcm`,
  - Entonces el orden resultante de los cortes en el navegador de series y la visualización de la primera y última rebanada son idénticos en los 3 casos.

- **AC-2 (Ordenamiento por posición espacial física):**
  - Dado un estudio tomográfico en un archivo ZIP cuyos nombres de archivo son hashes alfanuméricos arbitrarios y cuyos `InstanceNumber` faltan o están desordenados, cuando el estudio se procesa, entonces los cortes quedan estrictamente ordenados de menor a mayor cota sobre la normal del plano ($\mathbf{IPP} \cdot \mathbf{N}$).

- **AC-3 (Orientación anatómica no invertida):**
  - Dado un estudio axial cargado desde una carpeta local, cuando se renderiza el corte en el canvas 2D, entonces la pared abdominal/anterior se ubica en la parte superior y la columna vertebral/posterior en la inferior, coincidiendo con la convención radiológica RLPA.

- **AC-4 (Etiquetas HUD calculadas dinámicamente):**
  - Dado un corte con `ImageOrientationPatient = [1, 0, 0, 0, 1, 0]`, cuando se actualiza la interfaz, entonces las etiquetas muestran: Superior = `A`, Inferior = `P`, Izquierda = `R`, Derecha = `L`.
  - Dado un corte coronal (`[1, 0, 0, 0, 0, -1]`), las etiquetas muestran: Superior = `S`, Inferior = `I`, Izquierda = `R`, Derecha = `L`.

- **AC-5 (Fallback resiliente):**
  - Dado un archivo DICOM de radiografía simple (CR/DX) que no posee `ImagePositionPatient` ni `ImageOrientationPatient`, cuando se carga en el visor, entonces se renderiza correctamente sin errores y las etiquetas de orientación se ocultan o muestran valores neutrales.

---

## Non-functional requirements (Constitution compliance)

- **I. Local viewing is free:** Todo el pipeline de ordenamiento, cálculo vectorial y orientación se ejecuta 100% en el cliente (navegador / Electron) sin invocar APIs externas ni requerir autenticación.
- **II. Plain platform, no dependencies:** El cálculo matemático vectorial ($\mathbf{R} \times \mathbf{C}$, producto punto, matrices de rotación) se implementa en TypeScript puro sin bibliotecas de álgebra pesadas ni bundlers.
- **III. Desktop parity:** Módulos ubicados en `src/` de `web/` compatibles con la réplica exacta en `desktop/` mediante `make sync-web`.
- **IV. Tests where it counts:** Cobertura de tests unitarios DOM-free para el algoritmo de proyección de normales, el clasificador de orientación y los fallbacks de ordenamiento.

---

## Review checklist

- [x] Criterios de aceptación documentados para todos los orígenes de datos.
- [x] Fórmula matemática de ordenamiento por $\mathbf{IPP} \cdot (\mathbf{R} \times \mathbf{C})$ especificada.
- [x] Requerimientos de orientación RLPA y HUD dinámico definidos.
- [x] Compatibilidad con la constitución MICD garantizada.
