# MICD Frontend Web Client

Este repositorio contiene la interfaz de usuario (Single Page Application) del sistema **MICD** para la exploración y visualización de estudios médicos DICOM.

Está construido con **TypeScript y Vanilla HTML5/CSS3** (sin framework ni bundler: `tsc` compila `src/*.ts` directamente a módulos ES), y se sirve en producción mediante **Nginx**, el cual también gestiona el redireccionamiento de la API REST (`/api/*`) y de autenticación (`/auth/*`) hacia el backend.

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
│   ├── index.html              # Estructura base del visor web
│   ├── styles.css              # Estilos del visualizador y sistema de diseño
│   ├── renderer.ts             # Punto de entrada de lógica del visor y explorador
│   ├── auth.ts                 # Sesión JWT: login, refresh, authFetch y gate de login
│   ├── dicom-parser-util.ts    # Utilidad para parseo local de archivos DICOM
│   ├── dicom-renderer.ts       # Procesamiento de Canvas, coordenadas y ajustes visuales
│   ├── folder-files.ts         # Filtrado y ordenado lógico de imágenes locales
│   └── *.test.ts               # Pruebas unitarias del cliente (node:test)
├── Dockerfile                  # Compilación tsc + Servidor Nginx (multi-stage)
├── nginx.conf                  # Proxy inverso /api y /auth -> backend:3000 y fallback de SPA
├── docker-compose.yml          # Definición del contenedor frontend (Red externa: micd)
├── Makefile                    # Comandos rápidos para despliegue y validación
├── .env.example                # Define el puerto público del frontend (FRONTEND_PORT)
└── tsconfig.json               # Configuración de compilación TypeScript
```

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
