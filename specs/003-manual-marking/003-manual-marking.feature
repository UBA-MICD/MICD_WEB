# language: es
Característica: [US-48] Marcado manual ad hoc en visor DICOM (Regiones Poligonales)
  Como validador clínico, médico o investigador del sistema MICD
  Quiero trazar manualmente regiones poligonales sobre estudios DICOM, editar sus vértices, borrarlas y exportarlas localmente
  Para delimitar contornos patológicos irregulares y preservar segmentaciones sin depender de modelos de Inteligencia Artificial ni conexión a servidores externos.

  Antecedentes:
    Dado que el visor DICOM de MICD está iniciado en pantalla
    Y se encuentra cargado un estudio DICOM en el viewport activo

  # ── Escenario 1: Trazado exitoso de una región poligonal ────────────────────

  Escenario: Trazar exitosamente una región poligonal cerrada delimitando una lesión
    Dado que el estudio DICOM contiene el tag PixelSpacing con valores "0.5, 0.5"
    Cuando el usuario activa la herramienta de marcado manual "polygon"
    Y hace clic sucesivamente en las coordenadas de imagen (100, 100), (200, 100), (200, 200) y (100, 200)
    Y hace clic en las proximidades del primer vértice (100, 100) para cerrar la figura
    Entonces se renderiza un polígono cerrado con relleno translúcido continuo
    Y el badge informativo muestra el área calculada de "2500.0 mm²" y el perímetro de "200.0 mm"
    Y la región queda registrada en el estado de anotaciones del corte actual
    Y el lector de pantalla anuncia que la región ha sido delimitada exitosamente

  # ── Escenario 2: Edición de un vértice existente arrastrando su nodo ────────

  Escenario: Editar la posición de un vértice existente en una región poligonal
    Dado que existe una región poligonal cerrada con 4 vértices seleccionada en pantalla
    Y sus manijas visuales circulares son visibles en cada vértice
    Cuando el usuario presiona el botón del mouse sobre la manija del vértice ubicado en (200, 100)
    Y arrastra el cursor hasta la nueva coordenada de imagen (250, 80) y suelta el botón
    Entonces únicamente dicho vértice actualiza su posición a (250, 80)
    Y los restantes 3 vértices mantienen intactas sus coordenadas originales
    Y el contorno del polígono se ajusta en tiempo real conectando la nueva posición
    Y el badge recalculó automáticamente el nuevo área y perímetro de la región
    Y el cambio queda persistido en el estado de anotaciones

  # ── Escenario 3: Traslación rígida de la región completa ────────────────────

  Escenario: Mover toda la región arrastrando desde un borde o su interior
    Dado que existe una región poligonal seleccionada en pantalla
    Cuando el usuario presiona el botón del mouse sobre el borde del polígono a más de 8 píxeles de cualquier vértice
    Y arrastra el cursor desplazándolo un vector delta (+30 píxeles horizontales, +20 píxeles verticales)
    Y suelta el botón del mouse
    Entonces todos los vértices del polígono se desplazan exactamente (+30, +20) píxeles en el espacio de la imagen
    Y la forma geométrica relativa, el área y el perímetro se conservan inalterados

  # ── Escenario 4: Eliminación de una región seleccionada ─────────────────────

  Escenario: Eliminar una región poligonal activa mediante el teclado
    Dado que existe una región poligonal trazada en el corte actual
    Cuando el usuario hace clic sobre la región para seleccionarla
    Y presiona la tecla "Delete"
    Entonces la región poligonal y su badge desaparecen del canvas del visor
    Y la anotación es removida del estado de anotaciones de la sesión
    Y el lector de pantalla anuncia la eliminación de la anotación

  # ── Escenario 5: Guardado local de las coordenadas de la segmentación ───────

  Escenario: Exportar localmente la segmentación poligonal a un archivo JSON
    Dado que el archivo DICOM cargado en el visor se denomina "torax_control_01.dcm"
    Y contiene una región poligonal trazada con 6 vértices en el corte activo
    Cuando el usuario presiona el botón de exportar segmentación
    Entonces el navegador inicia automáticamente la descarga de un archivo
    Y el archivo descargado tiene el nombre exacto "torax_control_01 - segmentacion hecha.json"
    Y el contenido del JSON incluye el identificador "SOPInstanceUID", las dimensiones de imagen y el arreglo con las 6 coordenadas "Point2D"
    Y la descarga se realiza de forma estrictamente local sin peticiones de red al backend

  # ── Escenario 6: Marcado en estudio no calibrado con advertencia ────────────

  Escenario: Trazar una región en un estudio sin calibración espacial
    Dado que el estudio DICOM carece del tag PixelSpacing
    Cuando el usuario traza una región poligonal cerrada con la herramienta "polygon"
    Entonces el badge informativo reporta el área en "px²" y el perímetro en "px"
    Y se visualiza la advertencia "Sin calibración espacial"
