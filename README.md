[![codecov](https://codecov.io/gh/UBA-MICD/MICD_WEB/graph/badge.svg?token=5K24EKCRXT)](https://codecov.io/gh/UBA-MICD/MICD_WEB)

# MICD Frontend Web Client

Este repositorio contiene la interfaz de usuario (Single Page Application) del sistema **MICD** para la exploración y visualización de estudios médicos DICOM.

Está construido con **TypeScript y Vanilla HTML5/CSS3** (sin framework ni bundler: `tsc` compila `src/**/*.ts` directamente a módulos ES), y se sirve en producción mediante **Nginx**, el cual también gestiona el redireccionamiento de la API REST (`/api/*`) y de autenticación (`/auth/*`) hacia el backend.

---

## Requisito Crítico de Red (Leer antes de arrancar)

El frontend **no se comunica directamente con el PACS ni con la base de datos**. Todas las llamadas a `/api/*` y `/auth/*` se delegan a través de un proxy inverso configurado en Nginx hacia `http://backend:3000`.

Para que esto funcione en contenedores:

1. **Red Compartida:** Este contenedor debe unirse a la red de Docker llamada **`micd`**.
2. **Orden de Arranque:** La red `micd` es creada por la base de datos y la API en el repositorio **`MICD_BACKEND`**.
3. **Restricción:** **Debes levantar primero la pila del backend** (`make up` en `MICD_BACKEND`) antes de iniciar este servicio. Si intentas levantar este frontend sin levantar el backend primero, Docker Compose fallará reportando que la red `micd` es inexistente.

---

## Estructura del Proyecto

```text
MICD_WEB/
├── src/
│   ├── index.html              # Estructura base del visor web (ambas screens)
│   ├── styles.css              # Estilos del visualizador y sistema de diseño
│   ├── main.ts                 # Punto de entrada: bootstrap y wiring de features
│   ├── global.d.ts             # Tipos del puente opcional window.api (Electron)
│   ├── auth/
│   │   ├── auth.ts             # Sesión JWT: login, refresh, authFetch y gate de login
│   │   ├── login-form.ts       # mountLoginForm(): submit/error/disable del form de login
│   │   └── session-ui.ts       # updateAuthUI(), countdown de sesión, historial de actividad
│   ├── server-screen/
│   │   ├── server-screen.ts    # Screen del servidor: tabs Buscar/Cargar, auth card
│   │   └── study-detail-panel.ts # Panel de detalle de un estudio (Buscar)
│   ├── explorer/
│   │   ├── explorer.ts         # Explorador de estudios (panel + grilla de Buscar)
│   │   └── explorer-panel.ts   # Variante compacta del explorador junto al visor
│   ├── upload/
│   │   ├── upload.ts           # Panel de subida (progreso XHR, carpetas, duplicados)
│   │   └── zip-expand.ts       # Expansión de .zip del lado del cliente antes de subir
│   ├── viewer/
│   │   ├── state.ts            # Estado compartido del visor (serie, viewport, herramienta)
│   │   ├── loading.ts          # Apertura local (archivos/carpeta/drop) y carga desde servidor
│   │   ├── rendering.ts        # Render de canvas, panel de metadata y overlays
│   │   ├── interaction.ts      # Toolbar, mouse, teclado, navegación de serie
│   │   ├── cache.ts            # Cache + prefetch de slices (local y servidor)
│   │   └── mpr.ts              # Reconstrucción 3D/MPR con raymarching WebGL2
│   ├── zenodo/
│   │   └── zenodo-panel.ts     # Panel Zenodo: buscar, publicar, config, logs
│   ├── services/
│   │   └── export-service.ts   # Export a PNG/ZIP anonimizado (downloadBlob)
│   ├── utils/
│   │   └── dicom-anonymizer.ts # Anonimización de tags DICOM para export/Zenodo
│   ├── dicom/
│   │   ├── dicom-parser-util.ts # Utilidad para parseo local de archivos DICOM
│   │   └── dicom-renderer.ts   # Procesamiento de Canvas, coordenadas y ajustes visuales
│   ├── i18n/
│   │   ├── i18n.ts             # t(), setLocale(), applyTranslations() — ver CLAUDE.md
│   │   └── locales/            # es.ts (default) y en.ts, mismo set de keys
│   ├── shared/
│   │   ├── dom.ts              # Helpers de DOM ($, escapes, loading/error)
│   │   ├── token-store.ts      # Refresh token: safeStorage (Electron) o localStorage
│   │   ├── desktop.ts          # isDesktop(), UI condicional [data-desktop-only]
│   │   └── folder-files.ts     # Filtrado y ordenado lógico de imágenes locales
│   ├── vendor/                 # Assets vendorizados (fuentes; fflate se genera en build)
│   └── **/*.test.ts            # Pruebas unitarias del cliente (node:test, vía tsx)
├── Dockerfile                  # Compilación tsc + Servidor Nginx (multi-stage)
├── nginx.conf                  # Proxy inverso /api y /auth -> backend:3000 y fallback de SPA
├── docker-compose.yml          # Definición del contenedor frontend (Red externa: micd)
├── Makefile                    # Comandos rápidos para despliegue y validación
├── .env.example                # Define el puerto público del frontend (FRONTEND_PORT)
└── tsconfig.json               # Configuración de compilación TypeScript
```

> Este cliente comparte código, feature por feature, con `desktop` (la app Electron): todo lo
> que se agrega acá debe funcionar también ahí, y viceversa. Ver la sección "Desktop parity" de
> `CLAUDE.md` para el detalle del mecanismo de sincronización.

---

## Instrucciones de Arranque

### Requisitos Previos

- **Docker y Docker Compose** instalados.
- La pila del backend levantada y corriendo (desde el repositorio `MICD_BACKEND`).

### Paso 1: Configuración de Entorno e Instalación

Genera las dependencias del desarrollador y el archivo `.env`:

```bash
make install
```

### Paso 2: Levantar el Servidor Frontend (Nginx)

Una vez verificado que el backend está corriendo, levanta el frontend:

```bash
make up
```

Por defecto, la aplicación estará disponible en: [http://localhost](http://localhost) (puerto 80). Si deseas modificar el puerto público, puedes editar el archivo `.env`.

### Paso 3: Verificación de Estado

Puedes validar que el frontend esté respondiendo y se esté comunicando correctamente con la API ejecutando:

```bash
make check
```

---

## Autenticación

El visor local es público, pero **toda operación contra el servidor exige un JWT**:

- **Visualización local sin login:** abrir un archivo o carpeta DICOM del disco (parseo y render en el navegador) no requiere sesión.
- **Operaciones del servidor protegidas:** listar/buscar estudios, miniaturas, descarga de imágenes y subida de estudios envían siempre `Authorization: Bearer <token>`. El backend rechaza con `401` cualquier request sin token válido.
- **Popup de login perezoso:** la sesión no bloquea la app. Al intentar la primera operación del servidor (o si el token expira a mitad de sesión), aparece el diálogo de login. Cancelarlo devuelve al estado público sin romper el visor local.
- **Tokens:** el _access token_ (15 min) vive solo en memoria (nunca se persiste); el _refresh token_ (7 días) se guarda en `localStorage` y **rota en cada refresh** (un solo uso). Al recargar la página la sesión se restaura silenciosamente con el refresh token.
- **Rate limit:** `/auth/login` limita a 5 intentos fallidos por IP cada 15 minutos (`429`); el diálogo muestra el aviso correspondiente.

---

## Desarrollo y Pruebas Locales

Si deseas ejecutar pruebas o realizar builds manuales fuera de Docker, puedes utilizar los siguientes comandos:

- **Instalación local:** `npm install`
- **Compilación de producción:** `npm run build`
- **Correr Pruebas Unitarias:** `npm test`

---

## Control de Calidad (Git Hooks)

Este repositorio utiliza `pre-commit` para asegurar que el código mantiene un estilo limpio y consistente.

Si deseas configurar los hooks localmente, asegúrate de tener `pre-commit` instalado y ejecuta:

```bash
pre-commit install
```

Esto asegurará que **Prettier**, **ESLint**, **CSpell** y las **pruebas unitarias** se ejecuten automáticamente antes de confirmar y subir tus cambios.
