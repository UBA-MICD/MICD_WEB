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
├── docs/adr/                   # Architecture Decision Records (decisiones de arquitectura)
├── .env.example                # Define el puerto público del frontend (FRONTEND_PORT)
└── tsconfig.json               # Configuración de compilación TypeScript
```

> Este cliente comparte código, feature por feature, con `desktop` (la app Electron): todo lo
> que se agrega acá debe funcionar también ahí, y viceversa. Ver la sección "Desktop parity" de
> `CLAUDE.md` para el detalle del mecanismo de sincronización.

---

## Decisiones de Arquitectura (ADR)

Las decisiones técnicas del sistema están registradas como **Architecture Decision Records** en [`docs/adr/`](docs/adr/README.md), todas con el mismo formato: **Contexto → Opciones consideradas → Decisión → Consecuencias**.

- [ADR-0001 — Stack tecnológico](docs/adr/0001-stack-tecnologico.md)
- [ADR-0002 — Protocolo de comunicación](docs/adr/0002-protocolo-de-comunicacion.md)
- [ADR-0003 — Integración con Orthanc como PACS](docs/adr/0003-integracion-orthanc.md)
- [ADR-0004 — Autenticación con JWT](docs/adr/0004-autenticacion-jwt.md)
- [ADR-0005 — Módulo de anonimización externo](docs/adr/0005-modulo-anonimizacion-externo.md)

Para registrar una decisión nueva, copiar [`docs/adr/TEMPLATE.md`](docs/adr/TEMPLATE.md) con el número siguiente y agregarla al índice. El conjunto de ADR se mantiene **idéntico en `MICD_WEB` y `MICD_BACKEND`** (son decisiones del sistema, no de un repo): al cambiar uno, replicar el archivo en el otro repo.

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

## Anonimización de DICOM (US-16)

**Ningún DICOM sin anonimizar sale de la computadora del usuario.** La
anonimización ocurre en el cliente, antes de la subida, y el backend guarda lo
que recibe sin volver a anonimizar.

### Flujo

1. El usuario elige o arrastra archivos en la pestaña **Cargar** (o sobre el
   explorador).
2. Antes de empezar la cola, el cliente verifica que el anonimizador responda.
   Si no responde, **no se envía nada** y se muestra la URL que se intentó.
3. Cada archivo se manda al servicio de anonimización que corre en la **misma
   máquina** (repo `Imagenes-medicas-anonimizacion`, `POST /anonymize/`), y se
   sube **únicamente** lo que ese servicio devuelve.
4. En la app de escritorio el trabajo lo hace el proceso principal de Electron
   (`window.api.anonymizeDicom`), porque el renderer carga desde `file://` y ese
   origen no está —ni debe estar— en la lista CORS del servicio.

El código vive en [`src/upload/local-anonymizer.ts`](src/upload/local-anonymizer.ts)
y se usa desde [`src/upload/upload.ts`](src/upload/upload.ts).

### Qué se elimina o reemplaza

Lo define el servicio externo (perfil DICOM PS3.15 Anexo E + una segunda pasada
propia), no este repo:

- **Se vacían o reemplazan por un placeholder:** nombre del paciente,
  direcciones, teléfonos, institución y médicos (derivador, ejecutor, lector,
  operadores).
- **Se reemplazan por un hash:** `PatientID`, `AccessionNumber`, `StudyID`. El
  mismo valor produce siempre el mismo hash, para poder agrupar estudios de un
  mismo sujeto sin guardar el identificador real.
- **Se desplazan:** las fechas, con un offset por paciente que conserva los
  intervalos.
- **Se eliminan:** los tags privados y las secuencias anidadas.
- **Se conservan a propósito:** sexo, edad, grupo étnico y las descripciones de
  estudio y serie, por su valor científico.

> ⚠️ **No se tocan los píxeles.** El texto quemado en la imagen (_burned-in
> annotation_) sobrevive a la anonimización. Es el hallazgo H1 de
> `ANONYMIZATION_SECURITY_REVIEW.md` y sigue abierto: no subas estudios de
> ecografía o _secondary capture_ sin revisarlos.

### Comportamiento ante fallos (_fail closed_)

Nunca hay una vía degradada: si la anonimización no se puede hacer, el archivo
**no se sube**.

| Situación                                                 | Qué pasa                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| El servicio no responde al iniciar la cola                | No se envía ningún archivo; el mensaje incluye la URL                            |
| El servicio rechaza un archivo (no es DICOM válido)       | Esa fila queda en «No anonimizado: no enviado»; las demás siguen                 |
| El servicio se cae a mitad de la cola                     | Igual que arriba, archivo por archivo                                            |
| Falta `dicomParser` en el navegador (ruta de exportación) | `anonymizeDicomBuffer` lanza un error en lugar de devolver los bytes sin limpiar |

### Configuración

| Clave                        | Dónde           | Por defecto             | Para qué                                       |
| ---------------------------- | --------------- | ----------------------- | ---------------------------------------------- |
| `micd_anonymizer_url`        | `localStorage`  | `http://127.0.0.1:8000` | URL del servicio de anonimización              |
| `window.MICD_ANONYMIZER_URL` | variable global | —                       | Alternativa a la anterior, con menor prioridad |

La **CSP** de `index.html` fija `connect-src` a `http://127.0.0.1:8000` y
`http://localhost:8000`. Es deliberado: aunque alguien cambie
`micd_anonymizer_url`, el navegador no deja mandar los datos del paciente a un
host remoto. Si necesitás otra URL, hay que cambiar también la CSP.

El servicio debe aceptar el origen del visor en `ANONYMIZER_CORS_ORIGINS` (ver
el README de `Imagenes-medicas-anonimizacion`).

### Cómo correr las pruebas

```bash
npm test                      # incluye local-anonymizer.test.ts y upload.test.ts

# Con el corpus de DICOM con PHI falso (12 archivos, se generan):
cd ../testing && make phi-samples
cd ../web && MICD_PHI_FIXTURES=../testing/anonymization/fixtures npm test
```

Sin `MICD_PHI_FIXTURES`, la suite de fixtures se saltea en lugar de fallar. La
suite completa (contrato del servicio, extremo a extremo contra Orthanc y
Cypress sobre la UI real) vive en `testing/anonymization/` — ver su README.

### Pruebas de integración de la anonimización (TK-15)

Estas pruebas cubren **nuestra integración** con el módulo externo del otro
equipo (`Imagenes-medicas-anonimizacion`), para detectar regresiones cuando ese
equipo actualiza su módulo. **No** prueban el algoritmo de anonimización de ellos.

| Archivo                                          | Qué cubre                                                                                                                                                                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/upload/__fixtures__/synthetic-dicom.ts`     | Fábrica de DICOM **sintéticos** en memoria (sin datos reales), con PII falsa en tags de primer nivel, una secuencia anidada, un tag privado y UIDs; más el helper `expectNoPII`. Corre en CI sin corpus externo.                                    |
| `src/upload/anonymization-integration.test.ts`   | Contra un servicio **falso**: un anonimizador correcto devuelve bytes sin PII; uno que deja PII es detectado (la aserción no es vacua); salida vacía/no-DICOM/timeout/error de red/no-2xx fallan cerrado; los errores nunca filtran valores de PII. |
| `src/upload/anonymizer-contract.ts` + `.test.ts` | Contrato versionado del servicio (`GET /` salud, `POST /anonymize/` con `file`+`profile`, 2xx = bytes, errores `{detail}`) y chequeos que marcan desviaciones con el mensaje `the external anonymization contract changed: …`.                      |

```bash
npm test                      # corre todo lo anterior (sintético, en CI)
npm run test:coverage         # genera coverage/lcov.info
npm run check:anon-coverage   # exige >= 80% (líneas y ramas) en el módulo de integración
```

**Smoke test contra el servicio real** (opcional, no arranca Docker): con el
anonimizador Python corriendo, poné `MICD_ANONYMIZER_SMOKE=1` (y opcionalmente
`MICD_ANONYMIZER_URL`) y corré `npm test`. Sin esa variable, el caso se saltea.

**Cómo actualizar el contrato** cuando el otro equipo publica una versión nueva
a propósito: subí `CONTRACT_VERSION` y ajustá `ANONYMIZER_CONTRACT` en
`src/upload/anonymizer-contract.ts` en el mismo commit — el diff queda como
registro del cambio.

**Qué NO cubren:** el algoritmo del otro equipo y los datos quemados en los
píxeles (_burned-in annotation_) quedan fuera de alcance; la verificación previa
al almacenamiento vive en el backend (ver su README).

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
