# language: es
Característica: [TK-26] Herramientas de medición cuantitativa (longitud y área con HU)
  Como médico o radiólogo del sistema MICD
  Quiero disponer de herramientas de regla lineal y elipse ROI en el visor DICOM
  Para obtener mediciones métricas exactas en milímetros y evaluar densidades en Unidades Hounsfield (HU) en tomografías.

  Antecedentes:
    Dado que el visor web de MICD está iniciado en pantalla
    Y se encuentra cargado un estudio DICOM en el viewport principal

  # ── Escenario 1: Medición lineal calibrada en milímetros ─────────────────────

  Escenario: Trazar una medición lineal en un estudio con calibración espacial
    Dado que el estudio DICOM contiene el tag PixelSpacing con valores "0.5, 0.5"
    Cuando el usuario activa la herramienta de medición "length"
    Y presiona el botón del mouse en las coordenadas de imagen (100, 100)
    Y arrastra el cursor hasta las coordenadas de imagen (200, 100) y suelta el botón
    Entonces se dibuja una línea de medición continua entre ambos puntos
    Y la etiqueta flotante muestra la distancia calculada de "50.0 mm"
    Y no se muestra ninguna advertencia de falta de calibración

  # ── Escenario 2: Medición no calibrada con advertencia visual ───────────────

  Escenario: Trazar una medición en un estudio sin tag PixelSpacing
    Dado que el estudio DICOM no contiene el tag PixelSpacing (0028,0030)
    Cuando el usuario activa la herramienta de medición "length"
    Y traza un segmento de recta de 120 píxeles en la imagen
    Entonces la etiqueta de la medición muestra la distancia como "120 px"
    Y la etiqueta incluye visiblemente la advertencia "Sin calibración espacial"
    Y el lector de pantalla anuncia que la medida no cuenta con calibración métrica

  # ── Escenario 3: Cálculo de área y densidad HU en elipse de TC ──────────────

  Escenario: Medición de área y cálculo de Unidades Hounsfield en una lesión tomográfica
    Dado que el estudio es de modalidad TC con "RescaleSlope = 1" y "RescaleIntercept = -1024"
    Y contiene calibración PixelSpacing de "0.5, 0.5"
    Cuando el usuario activa la herramienta de medición "ellipse"
    Y traza una elipse con centro en (150, 150) y radios rx=20 píxeles, ry=20 píxeles
    Entonces el área mostrada se calcula como "314.2 mm²"
    Y la etiqueta reporta la media de densidad en Unidades Hounsfield con su desvío estándar
    Y la media calculada corresponde a la interpolación del buffer de vóxeles contenidos en la elipse

  # ── Escenario 4: Persistencia y aislamiento de anotaciones entre cortes ─────

  Escenario: Las anotaciones pertenecen estrictamente a su corte de origen
    Dado que el estudio contiene una serie de 10 cortes
    Y el usuario se encuentra visualizando el corte 3
    Cuando el usuario dibuja una regla en el corte 3
    Y avanza la navegación mediante la rueda del mouse al corte 4
    Entonces la regla dibujada en el corte 3 se oculta y no es visible en el corte 4
    Cuando el usuario retrocede nuevamente al corte 3
    Entonces la regla reaparece de forma idéntica en sus coordenadas originales

  # ── Escenario 5: Estabilidad de coordenadas frente a Pan y Zoom ─────────────

  Escenario: Las anotaciones mantienen su anclaje anatómico al hacer Zoom o Pan
    Dado que existe una medición de longitud trazada sobre una estructura anatómica
    Cuando el usuario activa la herramienta de Zoom y aumenta la escala al 200%
    O desplaza la imagen utilizando la herramienta de Pan
    Entonces los extremos de la línea y el badge de medida continúan alineados exactamente sobre los mismos vóxeles de la anatomía
