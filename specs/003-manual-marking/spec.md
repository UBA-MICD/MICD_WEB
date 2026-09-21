# Spec: Marcado manual ad hoc en visor DICOM (Regiones Poligonales)

> **Number:** 003 · **Slug:** `003-manual-marking` · **Ticket:** US-48
> **Status:** Draft · **Author:** MICD team · **Date:** 2026-09-20
> **Repos affected:** MICD_WEB (authored) · desktop (via vendoring)

## Why (problem & motivation)

El visor DICOM de MICD cuenta actualmente con herramientas de medición geométrica básica (longitud lineal y elipses cuantitativas introducidas en la TK-26). Sin embargo, en la práctica clínica y de investigación en el Hospital de Clínicas, una gran proporción de las lesiones patológicas (tumores sólidos, infiltrados pulmonares, hematomas laminares o fracturas óseas) y contornos de órganos presentan **geometrías altamente irregulares y asimétricas** que no pueden delimitarse con precisión mediante simples elipses o rectángulos.

Asimismo, los profesionales y validadores médicos requieren poder trazar regiones de interés (ROI) y segmentaciones anatómicas **de forma manual y ad hoc, completamente independientes de modelos de Inteligencia Artificial**. Esto es crítico para:

1. Casos donde los modelos de IA no están entrenados o fallan frente a patologías atípicas.
2. Servir como estándar de referencia ("ground truth") para la validación clínica ciega y docencia médica.
3. Permitir al profesional realizar correcciones finas inmediatas sobre los contornos (arrastrando nodos/vértices o reubicando la región).
4. Exportar localmente el resultado de la delimitación sin depender de conectividad a servidores externos ni incurrir en latencias de red.

La falta de esta capacidad obliga a los especialistas a exportar capturas estáticas y utilizar herramientas de dibujo externas no calibradas, perdiendo la relación espacial con los metadatos del estudio DICOM original.

## Who (users & roles)

- **Todos los roles (`medico`, `investigador`, `admin`, invitado/guest):**
  - Conforme al **Principio I de la Constitución MICD**, la inspección y el trabajo sobre el visor local son 100% libres, offline y sin autenticación requerida.
  - Todo usuario que cargue un estudio local o remoto tiene acceso irrestricto a la herramienta de marcado manual, su edición y su exportación local.
  - No existe restricción de roles para trazar, editar, borrar o descargar anotaciones locales en el visor.

## What (user stories)

- Como **médico o radiólogo**, quiero trazar una región poligonal cerrada sobre una lesión irregular para delimitar su perímetro anatómico exacto.
- Como **validador clínico**, quiero seleccionar una región existente y ver sus vértices para ajustar individualmente su posición arrastrándolos, refinando el margen tumoral sin tener que redibujar toda la forma.
- Como **usuario**, quiero poder hacer clic y arrastrar la región completa desde su borde o interior para reposicionarla sobre la anatomía si fue trazada con un desfase.
- Como **usuario**, quiero eliminar una región seleccionada mediante la tecla `Delete` o `Backspace` para descartar trazos erróneos.
- Como **investigador o médico**, quiero exportar la segmentación realizada a un archivo descargable local con el nombre `"<nombre del file> - segmentacion hecha.json"`, conteniendo las coordenadas en espacio imagen y metadatos clínicos, para su análisis cuantitativo o archivo docente.
- Como **especialista navegando un volumen tomográfico**, quiero que las regiones manuales trazadas queden ancladas estrictamente a su corte (`SOPInstanceUID` o índice de corte) y no se confundan con otros planos anatómicos.

## Functional requirements

- **FR-1 (Herramienta de Marcado Manual):** El sistema DEBE proveer una herramienta `polygon` seleccionable desde la barra de herramientas del visor.
- **FR-2 (Trazado de Región Cerrada):**
  - El usuario DEBE poder definir una región mediante clics sucesivos que agreguen vértices.
  - Durante el trazado, el sistema DEBE mostrar una línea elástica guía entre el último vértice fijado y la posición actual del puntero.
  - El polígono DEBE cerrarse cuando el usuario haga clic cerca del primer vértice (dentro de un radio de tolerancia) o mediante una acción explícita de confirmación (doble clic o tecla `Enter`).
- **FR-3 (Cálculo Geométrico de Perímetro y Área):**
  - Si el estudio DICOM cuenta con calibración espacial (`PixelSpacing` válido):
    - El sistema DEBE calcular el área interior del polígono en milímetros cuadrados ($mm^2$).
    - El sistema DEBE calcular el perímetro de la región en milímetros ($mm$).
  - Si el estudio carece de calibración espacial:
    - El sistema DEBE calcular el área en píxeles cuadrados ($px^2$) y el perímetro en píxeles ($px$), mostrando una advertencia visible de _"Sin calibración espacial"_.
- **FR-4 (Selección y Estado Activo):**
  - Al hacer clic sobre el borde o interior de una región cerrada existente, la región DEBE pasar al estado seleccionada (`selected`).
  - Al seleccionarse, el sistema DEBE renderizar manijas visuales ("handles") distintivas en cada uno de sus vértices.
- **FR-5 (Edición de Vértices):**
  - Con una región seleccionada, hacer clic y arrastrar sobre cualquiera de sus vértices DEBE desplazar únicamente dicho vértice, recalculando el contorno, área y perímetro en tiempo real durante el arrastre.
- **FR-6 (Traslación de la Forma Completa):**
  - Con una región seleccionada, hacer clic y arrastrar sobre un segmento del borde (o su interior relleno) que no corresponda a un vértice DEBE desplazar la totalidad de la región de manera rígida, preservando su forma relativa.
- **FR-7 (Eliminación de Región):**
  - Presionar la tecla `Delete` o `Backspace` con una región seleccionada DEBE eliminarla de la sesión activa.
- **FR-8 (Exportación Local de Segmentación):**
  - El sistema DEBE proveer una opción o botón de exportación que genere la descarga inmediata de un archivo JSON con la nomenclatura:
    `"<nombre del archivo original> - segmentacion hecha.json"`.
  - El contenido JSON DEBE incluir: identificador del estudio, `SOPInstanceUID`, dimensiones de la matriz de imagen, calibración de píxeles (`pixelSpacing`), y el listado de puntos 2D en coordenadas absolutas de imagen.
- **FR-9 (Aislamiento por Corte y Estabilidad con Pan/Zoom):**
  - Las coordenadas DEBEN almacenarse en el espacio de la imagen DICOM (World-Space) y proyectarse dinámicamente al espacio de pantalla.
  - Las regiones sólo DEBEN ser visibles en el corte exacto en el que fueron trazadas. Transformaciones de Zoom y Pan no deben deformar ni desalinear la región.

## Acceptance criteria

- **AC-1 (Trazado de región irregular):**
  - Dado un estudio cargado en el visor y la herramienta de marcado activa, cuando el usuario hace clic en cuatro puntos anatómicos y cierra en el punto de inicio, entonces el visor renderiza un polígono cerrado continuo y muestra un badge con su área y perímetro.
- **AC-2 (Edición precisa de vértice):**
  - Dada una región poligonal seleccionada en pantalla, cuando el usuario arrastra uno de sus vértices 30 píxeles hacia afuera, entonces el vértice adopta la nueva posición, el contorno se actualiza dinámicamente y el badge recalcula el área.
- **AC-3 (Traslación de la forma completa):**
  - Dada una región poligonal seleccionada, cuando el usuario hace clic en el borde (lejos de los vértices) y arrastra el puntero, entonces todos los vértices se desplazan rígidamente por el mismo delta vectorial.
- **AC-4 (Eliminación de la región):**
  - Dada una región poligonal seleccionada, cuando el usuario presiona la tecla `Delete`, entonces la región desaparece del visor y del estado de la sesión.
- **AC-5 (Exportación local formateada):**
  - Dada una región poligonal trazada sobre el archivo `estudio_torax.dcm`, cuando el usuario solicita la exportación, entonces el navegador dispara la descarga de `estudio_torax - segmentacion hecha.json` conteniendo el arreglo de puntos en coordenadas físicas y metadatos de calibración.

## Out of scope

- Segmentación volumétrica 3D o mallado tridimensional interpolado entre cortes adyacentes.
- Exportación en formatos DICOM binarios complejos (DICOM-SEG o RT-STRUCT) en el servidor PACS remoto (alcance futuro).
- Modificación directa o destructiva del buffer de vóxeles/píxeles original del DICOM.
- Modelos de asistencia por Inteligencia Artificial para ajuste automático de bordes (active contours / deep learning) en este ticket.

## Non-functional requirements (the constitution's gates)

- **i18n:** Nuevas cadenas incorporadas en estricta paridad en `src/i18n/locales/es.ts` y `src/i18n/locales/en.ts` (labels de botones, tooltips, mensajes de guardado y accesibilidad).
- **Accesibilidad (WCAG 2.2 AA):**
  - El botón de marcado manual se integra a la botonera principal con `roving.ts` (un solo tab stop para el grupo).
  - Estado activo señalizado mediante `aria-pressed="true"`.
  - Anuncio en `#measure-announce` (aria-live polite) al cerrar un polígono, editar un vértice o exportar el archivo.
- **Seguridad:** Los nombres de archivo y metadatos interpolados en la exportación deben ser sanitizados. La descarga se gestiona mediante Blob nativo en memoria sin inyección de scripts ni llamadas externas.
- **Desktop parity:** Código 100% TypeScript estándar sin APIs exclusivas de navegador web o Electron, garantizando que `make sync-web` en `desktop/` compile y ejecute con paridad total.
- **Performance:** Renderizado vectorial en Canvas 2D a 60 fps durante el arrastre continuo de vértices o formas.

## Review checklist

- [x] Problema clínico y justificación de independencia de IA claramente definidos.
- [x] Requerimientos funcionales de trazado, edición de nodos, traslación y exportación detallados.
- [x] Criterios de aceptación verificables en formato BDD.
- [x] Puertas de calidad constitucional (i18n, a11y, seguridad, paridad, plataforma pura) contempladas.
- [x] Sin detalles de implementación de bajo nivel filtrados en la especificación.
