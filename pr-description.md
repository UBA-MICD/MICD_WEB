## US-26 — Validación y registro de diagnósticos

Agrega la capacidad de que **medicos y admins** aprueben, rechacen o marquen para revisión los estudios cargados en el servidor, con registro inmutable del historial de correcciones. Los investigadores no tienen acceso a ninguna acción de validación.

---

### ¿Qué cambia?

#### Viewer — barra de validación

- Aparece en la parte inferior del canvas cuando un **medico o admin** abre un estudio desde el servidor.
- Muestra el estado actual del estudio (badge: Sin validación / Aprobado / Rechazado / En revisión).
- Botones: **Aprobar**, **Rechazar**, **Marcar para revisión**.
- Al confirmar, se abre un dialog con campo de comentario (obligatorio para rechazar).
- Tras confirmar, el badge se actualiza sin recargar la página.

#### Viewer — modo corrección (admin)

- Si el estudio **ya tiene una validación**, el admin ve un aviso `"Corrigiendo validación previa"` y las acciones llaman a `POST /validation-correction` en lugar de `POST /validate`.
- La corrección referencia a la validación anterior via `correctsId` — el historial es inmutable.

#### Server screen — panel Validaciones

- Nueva pestaña **Validaciones** visible para medicos y admins.
- Tabla de estudios filtrable por estado (Todos / Sin validar / Aprobado / Rechazado / Revisión).
- Columnas: Paciente, Modalidad, Fecha, Estado, Validado por, Acciones.
- Botones de acción por fila: Aprobar / Rechazar (abre dialog de comentario) / Marcar revisión / Ver en visor.

#### Backend — `POST /validate` (nuevo comportamiento)

- Si el estudio ya tiene una validación, responde **409 Conflict** con mensaje indicando que hay que usar `/validation-correction`. Antes insertaba una nueva fila sin restricción.

#### Accesibilidad

- Al abrir el dialog, el foco se mueve automáticamente al textarea de comentario (`data-dialog-autofocus`).
- Escape cierra el dialog sin enviar ninguna acción.
- Los toasts de error tienen `role="alert"` para anuncio inmediato por lectores de pantalla.
- El `#toast-container` ya tenía `aria-live="polite"` — los toasts de éxito son anunciados por cola.

---

### Archivos principales

| Archivo                                  | Rol                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `src/viewer/validation-ui.ts`            | Barra de validación + dialog en el viewer                                  |
| `src/viewer/validation-api.ts`           | Funciones fetch: `submitValidation`, `submitCorrection`, `fetchValidation` |
| `src/server-screen/validations-panel.ts` | Panel de tabla en el server screen                                         |
| `src/shared/banner.ts`                   | `role="alert"` en error toasts                                             |

---

### Cómo testearlo

#### 1. Setup

```bash
# En MICD_BACKEND:
make up        # levanta Postgres + Orthanc + backend

# En MICD_WEB:
make restart   # rebuild + nginx
```

Necesitás usuarios con los roles `medico`, `admin` e `investigador` en la base (seeded por migración).

#### 2. Barra de validación — happy path

1. Iniciar sesión como **medico**.
2. Abrir el server screen → seleccionar un estudio → **Cargar**.
3. ✅ La barra de validación aparece en la parte inferior del visor.
4. Click **Aprobar** → dialog abre → `textarea` recibe el foco → click **Confirmar**.
5. ✅ Badge cambia a "Aprobado", toast de éxito aparece.

#### 3. Rechazar requiere comentario

1. (mismo setup que arriba) Click **Rechazar** → dialog abre.
2. Dejar el textarea vacío → click **Confirmar**.
3. ✅ El aviso "El comentario es obligatorio" aparece; no se llama al API.
4. Escribir un comentario → **Confirmar**.
5. ✅ Badge cambia a "Rechazado".

#### 4. Escape cierra sin enviar

1. Click cualquier botón de validación.
2. Con el dialog abierto, presionar `Escape`.
3. ✅ Dialog se cierra; el estado del estudio no cambia.

#### 5. Modo corrección (admin)

1. Iniciar sesión como **admin**, cargar un estudio ya validado.
2. ✅ Aviso "Corrigiendo validación previa" visible en la barra.
3. Click **Aprobar** → confirmar.
4. ✅ Toast de éxito; corrección registrada en backend.

#### 6. Doble validación bloqueada

Con `curl` o Postman, llamar `POST /api/v1/studies/:id/validate` dos veces seguidas para el mismo estudio (como medico).

```
POST /api/v1/studies/1.2.3/validate   → 201 Created
POST /api/v1/studies/1.2.3/validate   → 409 Conflict
```

✅ La segunda llamada retorna `409` con mensaje que indica usar `/validation-correction`.

#### 7. Panel Validaciones (server screen)

1. Iniciar sesión como **medico** o **admin** → ir al server screen.
2. ✅ Pestaña "Validaciones" visible.
3. Click en chips de filtro (Aprobado, Sin validar…) → la tabla se filtra.
4. Click **Ver en visor** en una fila → el estudio se abre en el viewer.

#### 8. Rol investigador sin acceso

1. Iniciar sesión como **investigador**.
2. ✅ Barra de validación no aparece al cargar un estudio.
3. ✅ Pestaña "Validaciones" no aparece en el server screen.
4. `GET /api/v1/studies/:id/validation` devuelve **200** (lectura permitida).
5. `POST /api/v1/studies/:id/validate` devuelve **403**.

#### 9. Tests automatizados

```bash
# Frontend (Node 22 en Docker):
docker run --rm -v "$PWD":/app -w /app node:22-alpine \
  sh -c "npm ci --silent && npm test"
# → 597 tests, 0 fallos

# Backend unitarios:
npm run test:unit
# → 519 tests, 0 fallos
```
