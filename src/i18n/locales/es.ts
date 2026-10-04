// Spanish — the app's original language and the default locale. Every value
// here must read exactly as the UI did before i18n existed (metadata-panel
// labels are the one deliberate exception: they were English-only before,
// see viewer.metadata.* below).
export const es: Record<string, string> = {
  // ── app ──────────────────────────────────────────────────────────────────
  "app.title": "MICD — Visualizador DICOM",
  "app.skipLink": "Saltar al visualizador",
  "app.locale.label": "Idioma",
  "app.locale.es": "Español",
  "app.locale.en": "English",

  // ── common (shared, context-free) ───────────────────────────────────────
  "common.cancel": "Cancelar",
  "common.close": "Cerrar",
  "common.error": "Error",
  "common.success": "Éxito",
  "common.checking": "Verificando…",
  "common.license": "Licencia",
  "common.mostRecent": "(más reciente)",

  // ── auth ─────────────────────────────────────────────────────────────────
  "auth.login": "Iniciar sesión",
  "auth.logout": "Cerrar sesión",
  "auth.emailLabel": "Email",
  "auth.emailPlaceholder": "tu@email.com",
  "auth.passwordLabel": "Contraseña",
  "auth.showPassword": "Mostrar contraseña",
  "auth.hidePassword": "Ocultar contraseña",
  "auth.submitLogin": "Ingresar",
  "auth.wereYouInvited": "¿Te invitaron? Activá tu cuenta",
  "auth.loginRequiredMsg":
    "Se requiere sesión para buscar o subir estudios en el servidor. La visualización local no la necesita.",
  "auth.sessionActive": "Sesión activa",
  "auth.sessionExpired": "Sesión expirada",
  "auth.expiresIn": "Expira en {{time}}",
  "auth.noSessionReadOnly": "Sin sesión · solo lectura local",
  "auth.explorerActiveLine": "Sesión activa · expira en {{time}}",
  "auth.explorerSessionExpiredLine":
    "Sesión expirada · la próxima acción pedirá iniciar sesión",
  "auth.announceExpired":
    "Tu sesión expiró. La próxima acción pedirá iniciar sesión.",
  "auth.announceExpiringSoon": "Tu sesión expira en menos de un minuto.",
  "auth.error.networkError": "No se pudo conectar con el servidor.",
  "auth.error.tooManyAttempts":
    "Demasiados intentos. Esperá unos minutos e intentá de nuevo.",
  "auth.error.badCredentials": "Email o contraseña incorrectos.",
  "auth.activity.loading": "Cargando…",
  "auth.activity.notAvailable":
    "Historial no disponible todavía en este servidor.",
  "auth.activity.loadError": "No se pudo cargar el historial.",
  "auth.activity.empty": "Sin actividad registrada.",
  "auth.activity.unexpectedResponse": "Respuesta inesperada del servidor.",

  // ── server (server screen chrome) ──────────────────────────────────────
  "server.navLabel": "Servidor",
  "server.title": "Servidor",
  "server.backToViewer": "Volver al visualizador",
  "server.tabsAriaLabel": "Acciones del servidor",
  "server.tabUpload": "Cargar",
  "server.configButton": "Configurar servidor",
  "server.advancedSettings": "Configuración avanzada",
  "server.apiOriginLabel": "Servidor de la API",
  "server.apiOriginPlaceholder": "http://localhost:3000",
  "server.apiOriginSave": "Guardar y reiniciar",
  "server.apiOriginInvalid": "Dirección de servidor inválida.",
  "dialog.activityTitle": "Historial de actividad",
  "server.studyLoadedBanner": "Estudio cargado · volviendo al visualizador",
  "server.studiesLoadedBanner":
    "{{count}} estudios cargados · volviendo al visualizador",
  "common.search": "Buscar",

  // ── explorer (study list, both views) ──────────────────────────────────
  "explorer.panelTitle": "Estudios en servidor",
  "explorer.toolbarLabel": "Estudios",
  "explorer.reload": "Recargar",
  "explorer.searchLabel": "Buscar paciente o ID",
  "explorer.clearSearch": "Limpiar búsqueda",
  "explorer.modalityLabel": "Modalidad",
  "explorer.modalityAll": "Todas",
  "explorer.dateFromLabel": "Desde",
  "explorer.dateToLabel": "Hasta",
  "explorer.descriptionLabel": "Descripción",
  "explorer.descriptionPlaceholder": "Filtrar por descripción",
  "explorer.clearFilters": "Limpiar filtros",
  "explorer.prevPage": "Página anterior",
  "explorer.nextPage": "Página siguiente",
  "explorer.openSelected": "Abrir estudio seleccionado",
  "explorer.loadingStudies": "Cargando estudios…",
  "explorer.noStudiesFiltered": "No hay estudios con esos filtros.",
  "explorer.noStudiesLoaded": "No hay estudios cargados.",
  "explorer.loadError": "Error al cargar estudios.",
  "explorer.unknownPatient": "Paciente desconocido",
  "explorer.imageCountSingular": "1 imagen",
  "explorer.imageCountPlural": "{{count}} imágenes",
  "explorer.newBadge": "Nuevo",
  "explorer.publishedOnZenodo": "Publicado en Zenodo — {{doi}}",
  "explorer.importedFromZenodo": "Importado de Zenodo — {{doi}}",
  "explorer.zenodoBadge": "Zenodo · {{doi}}",
  "explorer.importedBadge": "Importado · {{doi}}",
  "explorer.loggedOutHintLine1":
    "Iniciá sesión para ver los estudios del servidor.",
  "explorer.loggedOutHintLine2": "Abrir archivos locales no requiere sesión.",

  // ── zenodo linked filter (shared across explorer + server panel chips) ──
  "zenodo.linkedFilter": "Vinculado a Zenodo",

  // ── viewer (toolbar, canvas, WL panel, MPR, metadata) ──────────────────
  "viewer.defaultTitle": "Visualizador DICOM",
  "viewer.openFile": "Abrir archivo",
  "viewer.openFolder": "Abrir carpeta",
  "viewer.selectFiles": "Seleccionar archivos",
  "viewer.canvasEmptyLabel": "Sin imagen cargada",
  "viewer.toolbar.ariaLabel": "Herramientas de visualización",
  "viewer.tool.wlTitle": "Brillo / contraste (W)",
  "viewer.tool.zoomTitle": "Zoom (Z)",
  "viewer.tool.panTitle": "Desplazar (P)",
  "viewer.tool.crosshairTitle": "Navegación Crosshair 3D (C)",
  "viewer.tool.lengthTitle": "Regla de medición (L)",
  "viewer.tool.ellipseTitle": "Medición de área y HU (E)",
  "viewer.tool.polygonTitle": "Marcado manual de región (Polígono)",
  "viewer.tool.resetTitle": "Restablecer (R)",
  "viewer.tool.metadataTitle": "Etiquetas DICOM (M)",
  "viewer.tool.zenodoTitle": "Zenodo — repositorio de ciencia abierta",
  "viewer.tool.mprStaticTitle": "Reconstrucción Multiplanar (MPR)",
  "viewer.tool.view3dStaticTitle": "Vista 3D",
  "viewer.dropZone.title": "Abrir archivo DICOM",
  "viewer.dropZone.instructions": "Arrastrá y soltá archivos .dcm aquí, o",
  "viewer.dropZone.note":
    "Ver archivos locales no requiere iniciar sesión. Usá Servidor para buscar o subir estudios.",
  "viewer.dropZone.shortcutsHtml":
    "<kbd>W</kbd> <kbd>Z</kbd> <kbd>P</kbd> eligen la herramienta · <kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> la ajustan (<kbd>Shift</kbd> para saltos grandes) · <kbd>Re Pág</kbd><kbd>Av Pág</kbd> cambian de imagen · <kbd>R</kbd> restablece · <kbd>M</kbd> muestra las etiquetas",
  "viewer.loading": "Cargando DICOM…",
  "viewer.nav.prevTitle": "Anterior (PageUp)",
  "viewer.nav.nextTitle": "Siguiente (PageDown)",
  "viewer.nav.sliceCounter": "Corte {{current}}/{{count}}",
  "viewer.wl.panelTitle": "Ajuste de Ventana (WL/WW)",
  "viewer.wl.widthLabel": "Ancho de Ventana (WW)",
  "viewer.wl.levelLabel": "Nivel de Ventana (WL)",
  "viewer.wl.presetsTitle": "Presets Predefinidos",
  "viewer.wl.presetLung": "Pulmón",
  "viewer.wl.presetBone": "Hueso",
  "viewer.wl.presetSoftTissue": "Tejido Blando",
  "viewer.wl.presetBrain": "Cerebro",
  "viewer.metadata.panelTitle": "Etiquetas DICOM",
  "viewer.loadImageError": "No se pudo cargar la imagen en el índice {{index}}",
  "viewer.loadImageGenericError": "Error al cargar la imagen: {{message}}",
  "viewer.titleServerSlice": "{{study}} — Corte {{index}}",
  "viewer.defaultStudyLabel": "Estudio",
  "viewer.noPixelsFound":
    "No se encontraron datos de píxeles. El archivo puede usar sintaxis de transferencia comprimida.",
  "viewer.folderNoDicom":
    "No se encontraron archivos DICOM en la carpeta seleccionada.",
  "viewer.serverStudyNoImages": "El estudio no tiene imágenes.",
  "viewer.serverStudyLoadError":
    "Error al cargar el estudio del servidor: {{message}}",
  "viewer.mpr.sliceCounter": "Corte: {{current}}/{{total}}",
  "viewer.mpr.notCompatibleSlices":
    "Estudio no compatible con MPR: requiere una serie con más de 1 corte.",
  "viewer.mpr.loadingMetadata": "Cargando metadatos del estudio…",
  "viewer.mpr.notCompatiblePixelSpacing":
    "Estudio no compatible con MPR: falta el tag PixelSpacing (0028,0030).",
  "viewer.mpr.notCompatibleImagePosition":
    "Estudio no compatible con MPR: falta el tag ImagePositionPatient (0020,0032).",
  "viewer.mpr.backTo2D": "Volver a Vista 2D",
  "viewer.mpr.enabledTitle": "Reconstrucción Volumétrica 3D (MPR)",
  "viewer.mpr.needTwoSlices":
    "El estudio requiere al menos 2 cortes para la vista volumétrica 3D.",
  "viewer.mpr.volumeLoadError": "Error al cargar el volumen 3D: {{message}}",
  "viewer.mpr.webglUnavailable":
    "WebGL2 no está disponible en este navegador. La vista 3D requiere WebGL2.",
  "viewer.view3d.sliceCounter": "Corte: {{current}}/{{total}}",
  "viewer.view3d.notCompatibleSlices":
    "Estudio no compatible con Vista 3D: requiere una serie con más de 1 corte.",
  "viewer.view3d.loadingMetadata": "Cargando metadatos del estudio…",
  "viewer.view3d.notCompatiblePixelSpacing":
    "Estudio no compatible con Vista 3D: falta el tag PixelSpacing (0028,0030).",
  "viewer.view3d.notCompatibleImagePosition":
    "Estudio no compatible con Vista 3D: falta el tag ImagePositionPatient (0020,0032).",
  "viewer.view3d.backTo2D": "Volver a Vista 2D",
  "viewer.view3d.enabledTitle": "Vista Volumétrica 3D",
  "viewer.view3d.needTwoSlices":
    "El estudio requiere al menos 2 cortes para la vista volumétrica 3D.",
  "viewer.view3d.volumeLoadError": "Error al cargar el volumen 3D: {{message}}",
  "viewer.view3d.webglUnavailable":
    "WebGL2 no está disponible en este navegador. La vista 3D requiere WebGL2.",
  "viewer.view3d.sagittal": "Sagital",
  "viewer.view3d.volumetricView": "Vista Volumétrica",
  "viewer.layers.title": "Ajuste de Capas",
  "viewer.layers.loadBtn": "Cargar Estudio Superpuesto",
  "viewer.layers.opacity": "Opacidad",
  "viewer.layers.ww": "Ancho de Capa (WW)",
  "viewer.layers.wl": "Centro de Capa (WL)",

  // ── viewer — segmentación con IA (mock SAM3) ────────────────────────────
  "viewer.segmentation.buttonTitle": "Segmentación con IA (mock SAM3)",
  "viewer.segmentation.buttonLabel": "IA Segm.",
  "viewer.segmentation.running": "Segmentando…",
  "viewer.segmentation.simulatedBadge": "Simulado",
  "viewer.segmentation.layerToggle": "Segmentación IA",
  "viewer.segmentation.showTitle": "Mostrar segmentación de IA",
  "viewer.segmentation.showLabel": "Segm. IA",
  "viewer.segmentation.none":
    "No hay segmentación disponible. Generala desde Servidor → Validaciones.",
  "viewer.segmentation.hudLabel": "Segmentación IA (simulada)",
  "viewer.segmentation.noImage": "Abrí una imagen DICOM antes de segmentar.",
  "viewer.segmentation.failed": "No se pudo generar la segmentación.",
  "viewer.segmentation.tagAi": "IA",
  "viewer.segmentation.loading": "Cargando segmentación IA…",
  "viewer.segmentation.correct": "Corregir",
  "viewer.segmentation.correctHint":
    "Arrastrá, agregá o quitá vértices para ajustar el contorno; luego Enviar.",
  "viewer.segmentation.submit": "Enviar",
  "viewer.segmentation.cancel": "Cancelar",
  "viewer.segmentation.transfer": "→ Transferir al original",
  "viewer.segmentation.transferHint":
    "Llevar esta segmentación al DICOM original y verla en la vista común.",
  "viewer.segmentation.transferred": "Segmentación transferida al original.",
  "viewer.segmentation.transferRevert": "Revertir transferencia",
  "viewer.segmentation.discard": "Descartar",
  "viewer.segmentation.discardHint":
    "Descartar la segmentación de la IA sin tocar el original.",
  "viewer.segmentation.discarded": "Segmentación descartada.",
  "viewer.segmentation.discardRestore": "Restaurar",
  "viewer.segmentation.restored": "Segmentación restaurada.",
  "viewer.segmentation.pathologyAria": "Tipo de patología de la segmentación",
  "viewer.segmentation.reset": "Descartar corrección",
  "viewer.segmentation.resetHint":
    "Volver al contorno original que propuso la IA.",
  "viewer.segmentation.resetDone":
    "Corrección descartada; volviste al contorno de la IA.",
  "viewer.segmentation.correctionSaved": "Corrección guardada.",
  "viewer.segmentation.notPersisted":
    "Esta segmentación no está persistida; no se puede corregir.",
  "viewer.segmentation.bySystem": "Segmentado por IA",
  "viewer.segmentation.byPerson": "Corregido por {{who}} · {{when}}",
  "viewer.zoom.panelTitle": "Ajuste de Zoom",
  "viewer.zoom.levelLabel": "Nivel de Zoom",
  "viewer.zoom.presetsTitle": "Accesos Rápidos",
  "viewer.zoom.fit": "Ajustar a pantalla",
  "viewer.zoom.100": "100%",
  "viewer.zoom.200": "200%",
  "viewer.mpr.sagittal": "Sagital",
  "viewer.mpr.volumetricView": "Vista Volumétrica",
  "viewer.metadata.patientName": "Nombre del Paciente",
  "viewer.metadata.patientId": "ID del Paciente",
  "viewer.metadata.birthDate": "Fecha de Nacimiento",
  "viewer.metadata.sex": "Sexo",
  "viewer.metadata.studyDate": "Fecha del Estudio",
  "viewer.metadata.studyDescription": "Descripción del Estudio",
  "viewer.metadata.accessionNumber": "N° de Acceso",
  "viewer.metadata.referringPhysician": "Médico Derivante",
  "viewer.metadata.modality": "Modalidad",
  "viewer.metadata.series": "Serie",
  "viewer.metadata.seriesNumber": "N° de Serie",
  "viewer.metadata.instanceNumber": "N° de Instancia",
  "viewer.metadata.dimensions": "Dimensiones",
  "viewer.metadata.pixelSpacing": "Espaciado de Píxeles",
  "viewer.metadata.imagePosition": "Posición de Imagen",
  "viewer.metadata.bitsAllocated": "Bits Asignados",
  "viewer.metadata.bitsStored": "Bits Almacenados",
  "viewer.metadata.photometric": "Fotométrico",
  "viewer.metadata.pixelRepr": "Repr. de Píxel",
  "viewer.metadata.rescaleSlope": "Pendiente de Reescala",
  "viewer.metadata.rescaleIntercept": "Intercepto de Reescala",
  "viewer.metadata.transferSyntax": "Sintaxis de Transferencia",
  "viewer.metadata.valueUnsigned": "Sin signo",
  "viewer.metadata.valueSigned": "Con signo",
  "viewer.canvasLabel.imageDicom": "Imagen DICOM",
  "viewer.canvasLabel.patient": "paciente {{name}}",
  "viewer.canvasLabel.imageOf": "imagen {{current}} de {{total}}",
  "viewer.canvasLabel.pixels": "{{cols}} por {{rows}} píxeles",

  // ── export ───────────────────────────────────────────────────────────────
  "export.menuTitle": "Exportar estudio o imagen",
  "export.menuLabel": "Exportar",
  "export.studyZipTitle": "Exportar estudio (.zip anonimizado)",
  "export.dialogTitle": "Opciones de Exportación",
  "export.dialogPrompt": "Seleccioná el formato de exportación deseado:",
  "export.currentViewPng": "Exportar vista actual (PNG)",
  "export.fullStudyZip": "Exportar estudio completo (ZIP)",
  "export.canvasNotFound":
    "No se encontró el canvas de renderizado para exportar PNG.",
  "export.exportingPng": "Exportando imagen actual a PNG…",
  "export.canvasBlobError": "Error al generar imagen PNG desde el canvas.",
  "export.pngSuccess": "Imagen PNG descargada con éxito.",
  "export.noImagesInStudy": "El estudio no contiene imágenes.",
  "export.downloadingServerImages":
    "Descargando {{count}} imágenes del servidor…",
  "export.instanceDownloadError": "Error descargando instancia {{index}}",
  "export.noStudyLoaded": "No hay ningún estudio cargado para exportar.",
  "export.zipSuccess": "Estudio exportado exitosamente como '{{filename}}'.",
  "export.saveCanceled": "Exportación cancelada: no se guardó ningún archivo.",
  "export.genericError": "Error al exportar estudio: {{message}}",
  "export.preparingZip": "Preparando exportación de estudio .zip…",
  "export.fetchingStudyInfo":
    "Obteniendo información del estudio en el servidor…",
  "export.noInstancesInStudy":
    "El estudio seleccionado no contiene instancias.",
  "export.downloadingFiles":
    "Descargando {{count}} archivos DICOM del estudio…",
  "export.fileFetchError": "Error recuperando archivo {{index}}",

  // ── upload ───────────────────────────────────────────────────────────────
  "upload.dropHint": "Arrastrá archivos .dcm, .zip o una carpeta aquí",
  "upload.selectFiles": "Seleccionar archivos o ZIP",
  "upload.selectFolder": "Seleccionar carpeta",
  "upload.classifyTitle": "Clasificar estudio",
  "upload.classifyMessage":
    "{{count}} archivo(s) listos. Elegí una clasificación para este estudio (opcional) y confirmá para subir.",
  "upload.classifyConfirm": "Subir",
  "upload.finish": "Finalizar",
  "upload.duplicateTitle": "Estudio duplicado",
  "upload.replace": "Reemplazar",
  "upload.cancelAll": "Cancelar todo",
  "upload.zipReadError": "No se pudo leer: {{files}}",
  "upload.zipTooBig":
    'ZIP demasiado grande para el navegador — arrastralo al panel "Estudios en servidor": {{files}}',
  "upload.unzippingGeneric": "Descomprimiendo…",
  "upload.unzippingNamed": "Descomprimiendo {{name}}…",
  "upload.noDicomFound": "No se encontraron archivos DICOM.",
  "upload.transportEncrypted": "Transmisión cifrada (HTTPS){{owner}}",
  "upload.transportUnencrypted":
    "Conexión sin cifrar (HTTP) — solo para uso local{{owner}}",
  "upload.ownerSuffix": " · asociado a {{email}}",
  "upload.inProgress": "Hay una carga en curso. Esperá a que termine.",
  "upload.needLogin": "Necesitás iniciar sesión para subir estudios.",
  "upload.needLoginExplorer": "Iniciá sesión para subir estudios.",
  "upload.uploadingProgress": "Subiendo {{current}} de {{total}} archivos",
  "upload.cancelled": "Carga cancelada.",
  "upload.summaryUploaded": "{{ok}} de {{total}} subidos",
  "upload.summaryDuplicates": "{{count}} ya existían (omitidos)",
  "upload.summaryErrors": "{{count}} errores",
  "upload.networkError": "Error de red al conectar con el servidor.",
  "upload.sessionExpiredRetry":
    "Sesión expirada. Iniciá sesión para subir estudios.",
  "upload.unauthorizedRetry": "No autorizado. Iniciá sesión de nuevo.",
  "upload.fileTooLarge": "El archivo supera el límite de 2 GB.",
  "upload.genericError": "Error al cargar el archivo.",
  "upload.anonymizerUnavailable":
    "El anonimizador local no responde en {{url}}. Inicialo y volvé a intentar: no se envió ningún archivo.",
  "upload.anonymizationFailed":
    "No se pudo anonimizar {{name}}: la carga se canceló y el archivo no se envió.",
  "upload.rowLabel": "Progreso de {{name}}",
  "upload.stateNotAnonymized": "No anonimizado: no enviado",
  "upload.stateDuplicate": "Duplicado",
  "upload.stateAborted": "Cancelado",
  "upload.explorerUploadingProgress": "Subiendo {{count}} archivo{{plural}}…",
  "upload.explorerSummaryUploaded": "{{ok}} de {{total}} subido{{plural}}",
  "upload.explorerSummaryDuplicates": "{{count}} ya existían",
  "upload.duplicateOnServer":
    "{{name}} ya existe en el servidor. Usá la pestaña Cargar para reemplazarlo.",
  "upload.duplicateMessage": "El estudio de {{name}} ya existe en el servidor.",
  "explorerPanel.unsupportedFileType":
    "Tipo de archivo no soportado. Solo se aceptan .dcm y .zip.",
  "explorerPanel.filesIgnored":
    "{{count}} archivo{{plural}} ignorado{{plural}} (tipo no soportado).",

  // ── study detail panel (Zenodo info for the selected study) ────────────
  "studyDetail.ariaLabel": "Detalle del estudio en Zenodo",
  "studyDetail.loadingZenodo": "Cargando datos de Zenodo…",
  "studyDetail.published": "Publicado",
  "studyDetail.imported": "Importado",
  "studyDetail.staleWarning": "Datos locales — Zenodo no disponible",
  "studyDetail.lastSync": " (última sync: {{date}})",
  "studyDetail.authors": "Autores",
  "studyDetail.date": "Fecha",
  "studyDetail.downloads": "Descargas",
  "studyDetail.versionHistory": "Historial de versiones",
  "studyDetail.importLatestVersion": "Importar versión más reciente",
  "studyDetail.checkUpdate": "Verificar actualización en Zenodo",
  "studyDetail.openInZenodo": "Abrir en Zenodo — {{doi}}",
  "studyDetail.exportAnonymizedZip": "Exportar .zip anonimizado",
  "studyDetail.zenodoDataError": "No se pudieron obtener los datos de Zenodo.",
  "studyDetail.connectionError": "Error al conectar con el servidor.",
  "studyDetail.checkUpdateError": "No se pudo verificar la actualización.",
  "studyDetail.newVersionAvailable": "Nueva versión disponible: v{{version}}",
  "studyDetail.publishedOn": " (publicada el {{date}})",
  "studyDetail.upToDate": "Al día",
  "studyDetail.checkConnectionError":
    "Error de conexión al verificar la actualización.",

  // ── zenodo panel ─────────────────────────────────────────────────────────
  "zenodo.tabPublish": "Publicar",
  "zenodo.doiPlaceholder": "DOI o URL de Zenodo (ej: 10.5281/zenodo.1234567)",
  "zenodo.importByDoi": "Importar por DOI",
  "zenodo.searchPlaceholder": "CT lung DICOM…",
  "zenodo.fileTypeAll": "Todos",
  "zenodo.envProduction": "Producción",
  "zenodo.searchEmptyTitle": "Buscá datasets",
  "zenodo.searchEmptyHint": 'Ingresá términos como "CT lung" o "DICOM MRI"',
  "zenodo.paginationPrev": "Anterior",
  "zenodo.paginationNext": "Siguiente",
  "zenodo.config.loadHint": "Abrí este tab para cargar la configuración",
  "zenodo.logs.typeLabel": "Tipo",
  "zenodo.logs.downloadCsv": "Descargar CSV",
  "zenodo.logs.filterAll": "Todos",
  "zenodo.logs.filterPublish": "Publicación",
  "zenodo.logs.filterImport": "Importación",
  "zenodo.logs.resultLabel": "Resultado",
  "zenodo.logs.loadHint": "Abrí este tab para cargar el historial",
  "zenodo.sessionExpiredWarning":
    "Tu sesión de MICD expiró. Iniciá sesión para continuar.",
  "zenodo.searchSessionRequired": "Sesión requerida",
  "zenodo.searchLoginToSearch": "Iniciá sesión para buscar en Zenodo",
  "zenodo.needLoginToast": "Necesitás iniciar sesión para buscar en Zenodo.",
  "zenodo.error401Subtitle":
    "Tu sesión expiró. Volvé a iniciar sesión para buscar en Zenodo.",
  "zenodo.error401Toast": "Tu sesión expiró. Iniciá sesión de nuevo.",
  "zenodo.rateLimitTitle": "Límite de búsquedas alcanzado",
  "zenodo.rateLimitSubtitle":
    "Sin un token de Zenodo configurado, el límite de búsquedas es más bajo. Configurá uno en la pestaña Config o esperá unos minutos.",
  "zenodo.rateLimitToastFallback": "Límite de requests a Zenodo alcanzado.",
  "zenodo.unavailableTitle": "Zenodo no disponible",
  "zenodo.unavailableLong":
    "Zenodo no está disponible en este momento. Intentá de nuevo más tarde.",
  "zenodo.unavailableShort": "Zenodo no está disponible en este momento.",
  "zenodo.searchErrorTitle": "Error al buscar",
  "zenodo.searchErrorSubtitleFallback":
    "Ocurrió un error inesperado. Intentá de nuevo.",
  "zenodo.searchErrorToastFallback": "Error al buscar en Zenodo.",
  "zenodo.noResultsTitle": "Sin resultados",
  "zenodo.noResultsSubtitle": "Probá términos más generales o quitá filtros",
  "zenodo.connectionErrorTitle": "Error de conexión",
  "zenodo.connectionErrorSubtitle":
    "No se pudo contactar al servidor. Revisá tu conexión e intentá de nuevo.",
  "zenodo.connectionErrorToast": "Error de conexión con el servidor.",
  "zenodo.notZenodoDoi":
    "Este DOI no pertenece a Zenodo — solo se soporta importación desde Zenodo",
  "zenodo.versionLabel": "Versión",
  "zenodo.versionOptionLabel": "v{{version}} · {{date}}",
  "zenodo.versionSelectError": "No se pudo cargar la versión seleccionada.",
  "zenodo.versionConnectionError": "Error de conexión al cargar la versión.",
  "zenodo.doiResolveError": "No se pudo resolver el DOI.",
  "zenodo.doiConnectionError": "Error de conexión al resolver el DOI.",
  "zenodo.resolving": "Resolviendo…",
  "zenodo.notImportable": "No importable",
  "zenodo.importZip": "Importar ZIP",
  "zenodo.import": "Importar",
  "zenodo.confirmImportZip": "Sí, importar",
  "zenodo.zipNote":
    "El servidor descomprimirá el ZIP e importará los archivos DICOM que contenga.",
  "zenodo.filesCountLabel": "{{count}} arch.",
  "zenodo.zipConfirmMessage":
    "¿Descomprimír el ZIP ({{size}}) e importar los DICOM que contenga?",
  "zenodo.zipConfirmWarning":
    "⚠ Archivo grande — la descarga puede tardar varios minutos.",
  "zenodo.datasetNotFound":
    "El dataset no existe en este entorno de Zenodo (sandbox/producción).",
  "zenodo.importFailedGeneric":
    "No se pudo importar el dataset (error {{status}}).",
  "zenodo.downloading": "Descargando…",
  "zenodo.noImportableFiles":
    "Este dataset no tiene archivos .dcm ni .zip para importar.",
  "zenodo.noFilesShort": "Sin archivos",
  "zenodo.importConnectionError": "Error de conexión al importar el dataset.",
  "zenodo.alreadyImportedSingular": "Este archivo ya estaba importado.",
  "zenodo.alreadyImportedPlural": "{{count}} archivos ya estaban importados.",
  "zenodo.importedCount": "✓ {{count}} importado{{plural}}",
  "zenodo.resultsCount": "{{page}} / {{totalPages}}  ·  {{total}} resultados",
  "zenodo.configLoadError": "Error al cargar config",
  "zenodo.retry": "Intentá de nuevo",
  "zenodo.envConnected": "Conectado · {{hint}}",
  "zenodo.envNotConfigured": "No configurado",
  "zenodo.tokenPlaceholder": "Token de Zenodo…",
  "zenodo.save": "Guardar",
  "zenodo.saving": "Guardando…",
  "zenodo.tokenErrorInvalid":
    "Token inválido. Verificá que lo copiaste completo y que no esté revocado.",
  "zenodo.tokenErrorPermissions":
    "El token no tiene los permisos necesarios en Zenodo.",
  "zenodo.tokenErrorTimeout":
    "Zenodo no respondió a tiempo. Intentá de nuevo en unos minutos.",
  "zenodo.tokenSaveFallbackError": "No se pudo guardar el token.",
  "zenodo.enterTokenFirst": "Ingresá un token de Zenodo antes de guardar.",
  "zenodo.sessionExpiredSaveToken":
    "Tu sesión expiró. Iniciá sesión de nuevo para guardar el token.",
  "zenodo.syncTitle": "Sincronización",
  "zenodo.lastRun": "Último run: {{date}}",
  "zenodo.never": "Nunca",
  "zenodo.intervalWeekly": "Semanal",
  "zenodo.intervalDisabled": "Desactivado",
  "zenodo.syncNow": "Sincronizar ahora",
  "zenodo.syncIntervalError": "No se pudo actualizar la sincronización.",
  "zenodo.syncIntervalConnectionError":
    "Error de conexión al actualizar la sincronización.",
  "zenodo.rateLimitPaused":
    "Rate limit alcanzado — continuará en {{seconds}} segundos",
  "zenodo.checkingProgress": "Verificando {{checked}}/{{total}} registros…",
  "zenodo.syncCompleteToast":
    "Sincronización completa — {{checked}} registros verificados, {{newVersions}} con nuevas versiones disponibles",
  "zenodo.syncRunError": "No se pudo ejecutar la sincronización.",
  "zenodo.syncConnectionError": "Error de conexión al sincronizar.",
  "zenodo.goToConfig": "Ir a Config",
  "zenodo.publish.selectStudyTitle": "Seleccioná un estudio",
  "zenodo.publish.selectStudyHint":
    "Cerrá este panel, hacé click en un estudio del explorador y volvé a Publicar",
  "zenodo.publish.closePanel": "Cerrar panel",
  "zenodo.publish.studyLabel": "Estudio",
  "zenodo.publish.titleLabel": "Título *",
  "zenodo.publish.descriptionLabel": "Descripción *",
  "zenodo.publish.descriptionPlaceholder": "Descripción del dataset…",
  "zenodo.publish.authorsLabel": "Autores *",
  "zenodo.publish.authorsHint": "(Apellido, Nombre; separados por ;)",
  "zenodo.publish.authorsPlaceholder": "García, Ana; López, Juan",
  "zenodo.publish.keywordsHint": "(separados por ,)",
  "zenodo.publish.keywordsPlaceholder": "CT, DICOM, tórax",
  "zenodo.publish.envLabel": "Entorno",
  "zenodo.publish.submitButton": "Publicar en Zenodo",
  "zenodo.publish.publishing": "Publicando…",
  "zenodo.publish.hintNotAnonymized":
    " El estudio debe estar anonimizado primero.",
  "zenodo.publish.hintNoCredentials":
    " Configurá un token en la pestaña Config.",
  "zenodo.publish.hintStudyNotFound":
    " El estudio no se encontró en la base de datos.",
  "zenodo.publish.successMessage":
    "✓ Publicado · DOI: {{doi}} · {{count}} archivo(s)",
  "zenodo.publish.connectionError": "Error de conexión.",
  "zenodo.publish.errorFallback": "Error {{status}}",
  "zenodo.logs.loading": "Cargando historial…",
  "zenodo.logs.loadErrorStatus": "Error al cargar el historial ({{status}}).",
  "zenodo.logs.connectionError": "No se pudo conectar al servidor.",
  "zenodo.logs.noRecords": "No hay registros para los filtros seleccionados.",
  "zenodo.logs.dateTimeHeader": "Fecha/hora",
  "zenodo.logs.actionHeader": "Acción",
  "zenodo.logs.resourceHeader": "Recurso",
  "zenodo.logs.previousPage": "← Anterior",
  "zenodo.logs.nextPage": "Siguiente →",
  "zenodo.logs.pageInfo": "Pág. {{page}} / {{totalPages}}",
  "zenodo.quotaAlertDefault":
    "Almacenamiento de Zenodo casi lleno. Revisá la configuración de Zenodo.",
  "orthanc.storageAlertDefault":
    "Almacenamiento del servidor Orthanc casi lleno ({{pct}}% usado). Liberá espacio o ampliá la capacidad.",

  // ── users (admin panel, US-H04) ─────────────────────────────────────────────
  "users.tab": "Usuarios",
  "users.title": "Gestión de usuarios",
  "users.col.name": "Nombre",
  "users.col.email": "Correo",
  "users.col.role": "Rol",
  "users.col.status": "Estado",
  "users.col.lastAccess": "Último acceso",
  "users.col.actions": "Acciones",
  "users.role.admin": "Administrador",
  "users.role.medico": "Médico",
  "users.role.investigador": "Investigador",
  "users.status.active": "Activo",
  "users.status.invited": "Invitado",
  "users.status.blocked": "Bloqueado",
  "users.status.deleted": "Eliminado",
  "users.action.block": "Bloquear",
  "users.action.enable": "Habilitar",
  "users.action.delete": "Eliminar",
  "users.action.create": "Crear usuario",
  "users.action.exportAuditLog": "Descargar log de auditoría (CSV)",
  "users.form.name": "Nombre",
  "users.form.email": "Correo",
  "users.form.role": "Rol",
  "users.empty": "No hay usuarios.",
  "users.confirmDelete":
    "¿Eliminar esta cuenta? Se podrá recrear más adelante.",
  "users.toast.created": "Usuario creado.",
  "users.toast.roleChanged": "Rol actualizado.",
  "users.toast.deleted": "Usuario eliminado.",
  "users.error.generic": "No se pudo completar la operación.",
  "users.error.network": "No se pudo conectar al servidor.",
  "users.error.forbidden": "No tenés permiso para gestionar usuarios.",
  "users.error.load": "No se pudo cargar la lista de usuarios.",
  "users.error.nameRequired": "El nombre es obligatorio.",
  "users.error.emailRequired": "Ingresá un correo válido.",
  "users.error.roleRequired": "Seleccioná un rol válido.",

  // ── accept-invite (US-H04) ──────────────────────────────────────────────────
  "invite.title": "Crear tu cuenta",
  "invite.forEmail": "Estás creando la cuenta para {{email}}.",
  "invite.password": "Contraseña",
  "invite.submit": "Crear cuenta e ingresar",
  "invite.invalid": "Esta invitación no es válida o ya venció.",
  "invite.error.tooShort": "La contraseña debe tener al menos 8 caracteres.",
  "invite.error.network": "No se pudo conectar al servidor.",
  "invite.error.generic": "No se pudo completar la operación.",
  "invite.dialog.title": "Activá tu cuenta",
  "invite.dialog.msg":
    "Ingresá tu email y el código que recibiste por correo, y elegí una contraseña.",
  "invite.dialog.emailLabel": "Email",
  "invite.dialog.codeLabel": "Código de invitación",
  "invite.dialog.missing": "Ingresá tu email y el código de invitación.",
  "invite.dialog.emailMismatch":
    "Ese código no corresponde a ese email. Revisá ambos.",

  // ── System panel (admin) ────────────────────────────────────────────────────
  "system.tab": "Sistema",
  "system.orthancStorage": "Almacenamiento Orthanc",
  "system.free": "Libre",
  "system.of": "de",
  "system.studies": "Estudios",
  "system.series": "Series",
  "system.instances": "Instancias",
  "system.used": "usados",
  "system.loadError": "No se pudo cargar el estado del servidor.",

  // ── Walkthrough / guided tour (TK-27) ───────────────────────────────────────
  "tour.controls.next": "Siguiente",
  "tour.controls.back": "Atrás",
  "tour.controls.skip": "Omitir tutorial",
  "tour.controls.finish": "Finalizar",
  "tour.controls.close": "Cerrar tutorial",
  "tour.progress": "Paso {{n}} de {{total}}",
  "tour.help.label": "Tutorial guiado",
  "tour.core.welcome.title": "Bienvenido a MICD",
  "tour.core.welcome.body":
    "Un recorrido breve por el visor y, si inicias sesión, por las funciones del servidor. Pulsa Esc u Omitir para salir cuando quieras — puedes reabrirlo desde el botón ?.",
  "tour.core.open.title": "Abrir un estudio",
  "tour.core.open.body":
    "Abre un archivo o carpeta DICOM local desde tu equipo — sin iniciar sesión. También puedes arrastrar archivos al visor.",
  "tour.core.wl.title": "Ventana / Nivel",
  "tour.core.wl.body":
    "Ajusta brillo y contraste arrastrando sobre la imagen, o aplica un preset (hueso, cerebro, pulmón, tejido blando).",
  "tour.core.zoompan.title": "Zoom y desplazamiento",
  "tour.core.zoompan.body":
    "Haz zoom para ver el detalle y desplázate para moverte por la imagen. La rueda del ratón también hace zoom.",
  "tour.core.mpr.title": "MPR y 3D",
  "tour.core.mpr.body":
    "Para series volumétricas, reconstruye los planos axial, coronal y sagital, o cambia a la vista 3D.",
  "tour.core.metadata.title": "Metadatos DICOM",
  "tour.core.metadata.body":
    "Consulta las etiquetas DICOM del estudio — paciente, serie y detalles de adquisición.",
  "tour.core.reset.title": "Restablecer la vista",
  "tour.core.reset.body":
    "Devuelve ventana/nivel, zoom y desplazamiento a sus valores por defecto con un clic.",
  "tour.core.explorer.title": "Explorador de estudios",
  "tour.core.explorer.body":
    "Muestra u oculta el panel del explorador para navegar por las series y estudios que tienes abiertos.",
  "tour.core.language.title": "Idioma",
  "tour.core.language.body":
    "Cambia la interfaz entre español e inglés en cualquier momento.",
  "tour.core.signin.title": "Funciones del servidor",
  "tour.core.signin.body":
    "Inicia sesión para acceder al servidor: busca estudios compartidos y — según tu rol — sube, publica y gestiona usuarios.",
  "tour.investigador.search.title": "Buscar estudios",
  "tour.investigador.search.body":
    "Encuentra estudios por paciente, modalidad o fecha. Empieza a escribir para buscar en el repositorio compartido.",
  "tour.investigador.dates.title": "Filtrar por fecha",
  "tour.investigador.dates.body":
    "Acota los resultados a un rango de fechas de adquisición con los campos desde/hasta.",
  "tour.investigador.results.title": "Resultados",
  "tour.investigador.results.body":
    "Los estudios coincidentes aparecen aquí. Para tu rol, la identidad del paciente está anonimizada — trabajas con datos sin identificar.",
  "tour.investigador.open.title": "Abrir un estudio",
  "tour.investigador.open.body":
    "Selecciona un estudio y ábrelo en el visor para revisar sus imágenes.",
  "tour.investigador.export.title": "Exportar",
  "tour.investigador.export.body":
    "Exporta imágenes o un paquete del estudio. Las descargas para tu rol están anonimizadas.",
  "tour.investigador.zenodo.title": "Corpus público de Zenodo",
  "tour.investigador.zenodo.body":
    "Busca en el corpus público de investigación de Zenodo conjuntos de datos publicados abiertamente.",
  "tour.investigador.done.title": "Todo listo",
  "tour.investigador.done.body":
    "Ese es tu kit de investigador — buscar, revisar y exportar anonimizado. Subir estudios, la administración de usuarios y la publicación no forman parte de este rol. Reabre este tutorial cuando quieras desde el botón ?.",
  "tour.staff.search.title": "Buscar estudios",
  "tour.staff.search.body":
    "Encuentra estudios por paciente, modalidad o fecha. Como personal clínico ves los datos completos del paciente.",
  "tour.staff.results.title": "Resultados",
  "tour.staff.results.body":
    "Los estudios coincidentes aparecen aquí con la información completa del paciente.",
  "tour.staff.open.title": "Abrir un estudio",
  "tour.staff.open.body":
    "Selecciona un estudio y ábrelo en el visor para revisar sus imágenes.",
  "tour.staff.export.title": "Exportar un estudio",
  "tour.staff.export.body":
    "Exporta imágenes (PNG) o un paquete completo del estudio (ZIP), con todos los metadatos.",
  "tour.staff.uploadTab.title": "Subir estudios",
  "tour.staff.uploadTab.body":
    "Abre la pestaña Cargar para añadir nuevos estudios al servidor.",
  "tour.staff.uploadDrop.title": "Arrastrar y soltar",
  "tour.staff.uploadDrop.body":
    "Suelta archivos DICOM aquí para subirlos. Cada archivo se sube con su propia fila de progreso.",
  "tour.staff.uploadFolder.title": "Subir una carpeta",
  "tour.staff.uploadFolder.body":
    "O sube una carpeta entera de una vez — se buscan archivos DICOM en las subcarpetas.",
  "tour.staff.uploadStatus.title": "Progreso y estado",
  "tour.staff.uploadStatus.body":
    "Sigue aquí el progreso y el estado de cada archivo mientras se suben tus estudios.",
  "tour.staff.zenodoImport.title": "Conjuntos de datos de Zenodo",
  "tour.staff.zenodoImport.body":
    "Busca en el corpus público de Zenodo e importa conjuntos de datos directamente al servidor.",
  "tour.medico.done.title": "Todo listo",
  "tour.medico.done.body":
    "Ese es tu kit clínico — buscar, revisar, subir, importar y exportar con todos los metadatos. La gestión de usuarios, la configuración/publicación en Zenodo y el registro de actividad son solo para administradores. Reabre este tutorial cuando quieras desde el botón ?.",
  "tour.admin.usersTab.title": "Gestión de usuarios",
  "tour.admin.usersTab.body":
    "Abre la pestaña Usuarios para gestionar cuentas — solo la ven los administradores.",
  "tour.admin.create.title": "Crear un usuario",
  "tour.admin.create.body":
    "Añade un usuario con nombre, correo y rol. Se le envía una invitación por correo.",
  "tour.admin.role.title": "Asignar roles",
  "tour.admin.role.body":
    "Cambia aquí el rol de un usuario — investigador, médico o administrador.",
  "tour.admin.block.title": "Bloquear y habilitar",
  "tour.admin.block.body":
    "Bloquea una cuenta para suspender el acceso y vuelve a habilitarla más tarde.",
  "tour.admin.delete.title": "Eliminar un usuario",
  "tour.admin.delete.body":
    "La eliminación es un borrado lógico — la cuenta se retira pero se conserva el historial de auditoría.",
  "tour.admin.lastAccess.title": "Último acceso",
  "tour.admin.lastAccess.body":
    "El último inicio de sesión de cada usuario se registra en esta columna.",
  "tour.admin.activity.title": "Registro de actividad",
  "tour.admin.activity.body":
    "Abre el registro de auditoría para revisar las acciones del sistema y expórtalo como CSV.",
  "tour.admin.zenodo.title": "Administración de Zenodo",
  "tour.admin.zenodo.body":
    "Configura las credenciales y la sincronización de Zenodo, revisa los registros de sincronización y la cuota, y publica estudios. La publicación es irreversible y hace los datos públicos — verifica con cuidado antes de publicar.",
  "tour.admin.help.title": "Reábrelo cuando quieras",
  "tour.admin.help.body":
    "Ese es el kit completo de administrador. Relanza este tutorial cuando quieras desde este botón ?.",
  // ── validation (US-26) ───────────────────────────────────────────────────────
  "validation.barAriaLabel": "Validación de diagnóstico",
  "validation.approve": "Aprobar",
  "validation.reject": "Rechazar",
  "validation.review": "Marcar para revisión",
  "validation.correctionNotice":
    "Se registrará una corrección sobre la validación previa.",
  "validation.dialog.title": "Confirmar acción",
  "validation.dialog.titleCorrection": "Registrar corrección",
  "validation.dialog.msg.approved": "¿Confirmás la aprobación de este estudio?",
  "validation.dialog.msg.rejected":
    "¿Confirmás el rechazo de este estudio? El comentario es obligatorio.",
  "validation.dialog.msg.review":
    "¿Marcás este estudio para revisión posterior?",
  "validation.dialog.msg.correctionApproved":
    "¿Registrás una corrección aprobando este estudio?",
  "validation.dialog.msg.correctionRejected":
    "¿Registrás una corrección rechazando este estudio? El comentario es obligatorio.",
  "validation.dialog.msg.correctionReview":
    "¿Registrás una corrección marcando este estudio para revisión?",
  "validation.dialog.commentLabel": "Comentario",
  "validation.dialog.commentRequired":
    "Se recomienda dejar un comentario al rechazar.",
  "validation.dialog.confirm": "Confirmar",
  "validation.status.approved": "Aprobado",
  "validation.status.rejected": "Rechazado",
  "validation.status.review": "Para revisión",
  "validation.status.none": "Sin validación",
  "classification.label": "Clasificación",
  "classification.none": "Sin clasificar",
  "classification.acv": "ACV",
  "classification.hemorragia": "Hemorragia",
  "classification.tumor": "Tumor",
  "classification.desmielinizante": "Desmielinizante",
  "classification.normales": "Normales",
  "classification.otros": "Otros",
  "validation.toast.success.approved": "Estudio aprobado.",
  "validation.toast.success.rejected": "Estudio rechazado.",
  "validation.toast.success.review": "Estudio marcado para revisión.",
  "validation.toast.success.correction": "Corrección registrada.",
  "validation.toast.error": "No se pudo registrar la validación.",
  "validation.analysisDone": "Análisis completado.",
  "validation.analysisFailed": "Error en el análisis.",
  "validation.readonlyNotice":
    "Solo el administrador puede corregir esta validación.",

  // ── Panel de Validaciones (US-26) ────────────────────────────────────────────
  "validations.tab": "Validaciones",
  "validations.filtersLabel": "Filtrar por estado",
  "validations.filterAll": "Todos",
  "validations.filterPending": "Sin validar",
  "validations.filterApproved": "Aprobados",
  "validations.filterRejected": "Rechazados",
  "validations.filterReview": "Para revisión",
  "validations.colPatient": "Paciente",
  "validations.colModality": "Modalidad",
  "validations.colDate": "Fecha",
  "validations.colStatus": "Estado",
  "validations.colValidatedBy": "Validado por",
  "validations.colActions": "Acciones",
  "validations.segmentWithAI": "Segmentar con IA",
  "validations.empty": "No hay estudios que coincidan con el filtro.",
  "validations.loadError": "No se pudo cargar la lista de estudios.",
  "validations.actionSuccess.approved": "Estudio aprobado.",
  "validations.actionSuccess.rejected": "Estudio rechazado.",
  "validations.actionSuccess.review": "Estudio marcado para revisión.",
  "validations.rejectDialog.title": "Rechazar estudio",
  "validations.rejectDialog.commentLabel": "Comentario (opcional)",
  "validations.rejectDialog.confirm": "Rechazar",
  "validations.correctionBadge": "corrección",

  // ── Configuración de Servidor (TK-29) ───────────────────────────────────────
  "serverConfig.title": "Configuración del Servidor",
  "serverConfig.description":
    "Ingresá la URL base del servidor PACS/Orthanc para consultar estudios, metadatos y volúmenes DICOM.",
  "serverConfig.urlLabel": "URL del Servidor",
  "serverConfig.urlPlaceholder": "http://localhost:3000",
  "serverConfig.saveAndConnect": "Guardar / Conectar",
  "serverConfig.saveSuccess": "Configuración guardada exitosamente.",
  "serverConfig.invalidUrl":
    "Formato de URL inválido. Usá http:// o https:// (ej. http://localhost:3000)",

  // ── Medición y anotaciones (TK-26) ──────────────────────────────────────────
  "annotations.length": "Longitud",
  "annotations.area": "Área",
  "annotations.mean": "Media",
  "annotations.stdDev": "Desvío Est.",
  "annotations.uncalibrated": "Sin calibración espacial",
  "annotations.polygon": "Polígono",
  "annotations.perimeter": "Perímetro",
  "viewer.measure.panelTitle": "Ajuste de Mediciones",
  "viewer.measure.unitLabel": "Unidades",
  "viewer.measure.pathologyLabel": "Patología",
  "viewer.measure.pathologyNeedPolygon":
    "Seleccioná un polígono para asignarle una patología.",
  "viewer.measure.unitMm": "Milímetros (mm)",
  "viewer.measure.unitCm": "Centímetros (cm)",
  "viewer.measure.lineWidthLabel": "Grosor de línea",
  "viewer.measure.clearAnnotations": "Borrar mediciones",
  "viewer.measure.exportSegmentation": "Exportar Segmentación",
  "viewer.measure.noSegmentationToExport":
    "No hay segmentaciones poligonales para exportar en este corte.",
  "viewer.measure.exportSuccess": "Segmentación exportada exitosamente.",
  "viewer.measure.toggleVisibility": "Esconder/Mostrar",
  "viewer.measure.hideAnnotations": "Ocultar anotaciones",
  "viewer.measure.showAnnotations": "Mostrar anotaciones",
  "viewer.info.hide": "Ocultar info",
  "viewer.info.show": "Mostrar info",
  "viewer.measure.saveAnnotations": "Guardar",
  "viewer.measure.savedSuccess": "¡Guardado!",
};
