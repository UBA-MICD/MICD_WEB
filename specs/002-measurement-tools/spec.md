# Spec: Herramientas de medición (longitud y área)

> **Number:** 002 · **Slug:** `002-measurement-tools` · **Ticket:** TK-26
> **Status:** Draft · **Author:** MICD team · **Date:** 2026-09-11
> **Repos affected:** MICD_WEB (authored) · desktop (via vendoring)

## Why (problem & motivation)

El visor DICOM de MICD permite actualmente inspeccionar estudios mediante ajustes de Ventana/Nivel (W/L), Zoom, Pan, Crosshair y reconstrucciones 3D/MPR, pero carece de **herramientas de medición cuantitativa**.

En la práctica médica y radiológica diaria, la evaluación diagnóstica exige mediciones métricas exactas:

1. **Longitud lineal:** Dimensionamiento de tumores o nódulos (criterios RECIST), luz vascular, diámetros de órganos y márgenes quirúrgicos.
2. **Área y densidad tisular (ROI elíptica):** En tomografía computarizada (CT), no basta con medir el área; la caracterización del tejido depende críticamente del cálculo de la media de **Unidades Hounsfield (HU)** dentro de una región de interés para diferenciar quistes (0 a 20 HU), contenido graso (-100 a -50 HU), hematomas/sangrado (60 a 80 HU) y lesiones sólidas o calcificaciones (>100 HU).

Sin estas herramientas en el visor web y desktop, el profesional debe recurrir a software externo o realizar estimaciones cualitativas propensas a error. Asimismo, los estudios DICOM pueden o no contener calibración espacial física (`PixelSpacing`, tag `0028,0030`): si el archivo carece de esta información (e.g. radiografías digitalizadas o capturas secundarias), el sistema debe reportar la medida en píxeles y advertir explícitamente al usuario para evitar errores clínicos graves basados en escalas incorrectas.

## Who (users & roles)

- **Todos los roles (`medico`, `investigador`, `admin`, invitado/guest):**
  - Conforme al **Principio I de la Constitución MICD**, el visor local es libre, offline y no requiere autenticación. Todo usuario que cargue un estudio local o remoto tiene acceso irrestricto a las herramientas de medición.
  - No existe restricción de roles para medir distancias o densidades en el visor.

## What (user stories)

- Como **médico o radiólogo**, quiero trazar una línea recta entre dos puntos anatómicos para medir distancias exactas en milímetros (mm).
- Como **radiólogo evaluando un estudio de TC**, quiero trazar una elipse sobre una lesión para calcular su área en $mm^2$ y obtener automáticamente la densidad promedio en Unidades Hounsfield ($\overline{HU} \pm SD$), determinando la naturaleza tisular del hallazgo.
- Como **usuario con un DICOM no calibrado**, quiero ver la medida en píxeles (`px` / `px²`) acompañada de una advertencia visual clara de _"Sin calibración espacial"_, para no confundir unidades relativas con milímetros reales.
- Como **especialista navegando un volumen tomográfico**, quiero que las anotaciones que dibujé permanezcan ancladas a su corte (`SOPInstanceUID` o índice de corte) específico y no se superpongan indebidamente al cambiar de corte.
- Como **usuario**, quiero poder interactuar con las anotaciones (seleccionarlas o eliminarlas) cuando ya no las necesite en pantalla.

## Functional requirements

- **FR-1 (Herramienta de Regla / Longitud):** El sistema DEBE proveer una herramienta `length` que permita definir un segmento de recta mediante dos puntos (`start`, `end`) sobre el plano de la imagen.
- **FR-2 (Herramienta de Área / Elipse):** El sistema DEBE proveer una herramienta `ellipse` que permita definir una región de interés elíptica (centro y radios $r_x, r_y$).
- **FR-3 (Calibración milimétrica):** Si el DICOM contiene el tag `PixelSpacing` `(0028,0030)` válido:
  - La distancia DEBE calcularse y formatearse en milímetros (ej. `24.5 mm`).
  - El área de la elipse DEBE calcularse y formatearse en milímetros cuadrados (ej. `184.2 mm²`).
- **FR-4 (Degradación y advertencia sin calibración):** Si el DICOM carece del tag `PixelSpacing` `(0028,0030)` o contiene valores inválidos/cero:
  - Las distancias DEBEN mostrarse en píxeles (ej. `128 px`).
  - Las áreas DEBEN mostrarse en píxeles cuadrados (ej. `3240 px²`).
  - La etiqueta de la anotación DEBE incluir un indicador de advertencia visible: _"Sin calibración espacial"_ (en español) / _"Uncalibrated"_ (en inglés).
- **FR-5 (Cálculo de Unidades Hounsfield en Elipse):** En estudios de tomografía computarizada (CT) o modalidades con `RescaleSlope` `(0028,1053)` y `RescaleIntercept` `(0028,1052)` presentes:
  - El sistema DEBE calcular la media aritmética de HU ($\overline{HU}$) y el desvío estándar ($\pm SD$) de los vóxeles/píxeles contenidos estrictamente dentro de la elipse.
  - El badge de la elipse DEBE mostrar el área junto a la estadística HU (ej. `145.2 mm² | Media: 34.2 HU (±8.1)`).
  - Si la modalidad no es CT o no cuenta con los tags de reescalado, el cálculo de HU se omitirá mostrando únicamente el área.
- **FR-6 (Anotaciones por corte y persistencia en sesión):** Cada anotación DEBE asociarse a la instancia del corte activo (`SOPInstanceUID` o `sliceIndex`). Al navegar entre cortes, únicamente se renderizarán las anotaciones correspondientes al corte actual.
- **FR-7 (Estabilidad frente a Zoom y Pan):** Las anotaciones DEBEN almacenarse en coordenadas de imagen (espacio mundo del DICOM) y proyectarse dinámicamente al espacio de pantalla, garantizando que transformaciones de Zoom o desplazamiento (Pan) no desalineen los gráficos.
- **FR-8 (Exclusión mutua de herramientas):** La selección de `length` o `ellipse` en la barra de herramientas DEBE ser mutuamente excluyente con las herramientas existentes (`wl`, `zoom`, `pan`, `crosshair`).
- **FR-9 (Eliminación de anotaciones):** El usuario DEBE poder eliminar una anotación individual activa (tecla `Delete` / `Backspace` o botón de cierre) o limpiar todas las anotaciones del corte/estudio.

## Acceptance criteria

Matriz BDD detallada en [`002-measurement-tools.feature`](002-measurement-tools.feature). Escenarios principales:

- **AC-1 (Medición lineal calibrada):** Dado un estudio DICOM con `PixelSpacing = [0.5, 0.5]` mm, cuando el usuario traza una línea de 100 píxeles horizontales, el visor muestra exactamente `50.0 mm`.
- **AC-2 (Medición no calibrada con advertencia):** Dado un estudio DICOM sin tag `PixelSpacing`, cuando el usuario mide una distancia o área, el visor muestra la magnitud en `px` / `px²` y añade la advertencia visible _"Sin calibración espacial"_.
- **AC-3 (Área y cálculo de HU en elipse CT):** Dado un corte tomográfico con `RescaleSlope = 1` y `RescaleIntercept = -1024`, cuando el usuario dibuja una elipse en una región homogénea de agua (pixel value ~1024), el visor reporta el área calculada y un promedio de `~0.0 HU`.
- **AC-4 (Persistencia en navegación de cortes):** Dado un estudio con 10 cortes y una medición dibujada en el corte 3, cuando el usuario avanza al corte 4, la medición desaparece; cuando regresa al corte 3, la medición vuelve a renderizarse en la posición exacta.
- **AC-5 (Persistencia geométrica con Pan/Zoom):** Dada una medición en pantalla, cuando el usuario aplica zoom 2x o desplaza la imagen con Pan, los anclajes y etiquetas de la medición se mantienen perfectamente posicionados sobre la anatomía.

## Out of scope

- Guardado o persistencia de anotaciones como objetos DICOM PR / GSPS en el servidor Orthanc (alcance de ticket posterior).
- Herramientas poligonales libres, ángulo de Cobb o segmentación volumétrica 3D.
- Modificación destructiva del buffer de píxeles original del DICOM.

## Non-functional requirements (the constitution's gates)

- **i18n:** Nuevas cadenas incorporadas en estricta paridad en [`src/i18n/locales/es.ts`](../../src/i18n/locales/es.ts) y [`src/i18n/locales/en.ts`](../../src/i18n/locales/en.ts) (labels de herramientas, tooltips, sufijos de unidades `mm`, `mm²`, `px`, `px²`, `HU`, y mensaje de advertencia _"Sin calibración espacial"_ / _"Uncalibrated"_).
- **Accesibilidad (WCAG 2.2 AA):**
  - Botones de herramientas con `role="radio"` o `aria-pressed` en grupo con `roving.ts`.
  - Atajos de teclado documentados para activar herramientas.
  - Anuncio en región en vivo (`#measure-announce` o similar) al completar una medición reportando el valor resultante a lectores de pantalla.
- **Seguridad:** Todo texto formateado o proveniente de metadatos DICOM debe pasar por `escapeHtml` / `escapeAttr`. Sin inyecciones directas de HTML.
- **Desktop parity:** Código 100% en TypeScript puro sin dependencias de Electron, consumible directamente por `MICD_APP` vía vendoring verbatim.
- **Performance:** Muestreo de elipse acotado a la bounding box con verificación de pertenencia cuadrática para evitar bloqueos del hilo principal en ROIs grandes. Renderizado overlay a 60 fps.

## Limitaciones Conocidas (MVP)

- **Persistencia en memoria:** `state.annotations` vive únicamente en memoria volátil de la aplicación. Las mediciones se pierden al recargar la página (F5) o cerrar el visor, dado que la persistencia en almacenamiento persistente o como objetos DICOM PR / GSPS en el servidor Orthanc corresponde a un alcance posterior fuera de este MVP.

## Open questions

_(Ninguna pregunta abierta bloqueante; requerimientos consolidados)._

## Review checklist

- [x] Problema clínico y motivación claramente definidos.
- [x] Regla de degradación para estudios no calibrados estipulada.
- [x] Casos de uso de Unidades Hounsfield en CT contemplados.
- [x] Criterios de aceptación verificables en formato BDD.
- [x] Puertas de calidad constitucional (i18n, a11y, seguridad, paridad) verificadas.
