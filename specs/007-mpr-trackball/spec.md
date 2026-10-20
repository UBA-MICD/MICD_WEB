# Spec: Control Trackball MPR (Pitch/Yaw) en la barra de herramientas

> **Number:** 007 · **Slug:** `007-mpr-trackball` · **Ticket:** TK-30 (Tarea · Prioridad Media · Épica Visualización DICOM)
> **Status:** Draft · **Author:** MICD Architecture & Clinical UX Team · **Date:** 2026-10-12
> **Related:** TK-48 / US-50 (`specs/006-mpr-oblique-ux`)
> **Repos affected:** `web` (authored) · `desktop` (via vendoring en `src/renderer/`)

---

## Why (problem & motivation)

Con US-50 el visor permite cortes oblicuos rotando los brazos del crosshair directamente sobre la imagen. Esa misma gesticulación sirve a la vez para **trasladar** el crosshair, por lo que ambas acciones compiten:

1. **Conflicto rotar vs. trasladar.** Una zona de ~18 px alrededor de cada brazo decide si el arrastre rota o traslada. Un clic cercano al brazo rota el plano sin que el radiólogo lo pretenda, y el crosshair no queda donde se lo quería.
2. **Falta de precisión angular.** La rotación por brazos depende de la geometría de pantalla y no ofrece modo fino ni una lectura del ángulo; el radiólogo no puede saber ni repetir cuánto rotó.
3. **Sin retorno rápido a ortogonal.** Volver a Axial/Coronal/Sagital requiere el reset global de vista, que además reinicia cámaras, zoom y pan.

---

## Who (users & roles)

- **Médico radiólogo / especialista (`medico`):** rota los planos con precisión para seguir estructuras oblicuas.
- **Investigador (`investigador`) y `admin`:** misma funcionalidad.
- **Invitado (guest):** la visualización local es libre (constitución, principio I), por lo que el trackball funciona **sin sesión**. No hay gating por rol: es una herramienta de visualización puramente local.

---

## What (user stories)

- Como **radiólogo**, quiero un control tipo **trackball** (esfera virtual) en la barra de herramientas MPR para rotar el plano activo con precisión (Pitch/Yaw), separando rotar de trasladar el crosshair.
- Como **radiólogo**, quiero que el arrastre horizontal sobre la esfera controle el **Yaw** y el vertical el **Pitch**.
- Como **radiólogo**, quiero ver el **ángulo actual** de rotación en pantalla.
- Como **radiólogo**, quiero un botón **Reset** que me devuelva a los planos ortogonales originales (Axial, Coronal, Sagital).
- Como **usuario de teclado o lector de pantalla**, quiero operar la rotación sin arrastrar el mouse.

---

## Functional requirements

- **FR-1:** La barra de herramientas MPR MUST mostrar un control **trackball** mientras el visor está en modo MPR. MUST NOT mostrarse cuando el viewport activo es la vista 3D combinada.
- **FR-2:** Arrastrar la esfera MUST rotar el **triedro completo** de planos (Axial, Coronal y Sagital rotan rígidamente) alrededor de los ejes del **plano activo**: el desplazamiento **horizontal** controla el **Yaw** (eje vertical del plano activo) y el **vertical** controla el **Pitch** (eje horizontal del plano activo). Arrastre a la derecha ⇒ Yaw positivo; hacia abajo ⇒ Pitch positivo.
- **FR-3:** La tecla **Shift** durante el arrastre MUST reducir la sensibilidad a una décima (ajuste fino), y un único evento de puntero MUST NOT aplicar más de 15° de rotación.
- **FR-4:** El control MUST mostrar en pantalla el **ángulo actual** (Pitch y Yaw, en grados con un decimal), derivado de la rotación acumulada y actualizado durante el arrastre.
- **FR-5:** El botón **Reset** MUST restablecer los planos a los ejes anatómicos ortogonales (normales Axial (0,0,1), Coronal (0,1,0), Sagital (1,0,0)) y el readout a 0,0° · 0,0°. MUST conservar la posición del crosshair, el zoom y el pan.
- **FR-6:** La rotación angular de los planos MUST ser **exclusiva del trackball**. El arrastre de los brazos del crosshair sobre la imagen MUST NOT rotar los planos: con la herramienta `crosshair`, el arrastre izquierdo sólo **traslada** el crosshair.
- **FR-7:** Arrastrar el trackball MUST NOT mover el crosshair ni cambiar la herramienta activa.
- **FR-8:** El control MUST ofrecer una **alternativa por teclado** equivalente al arrastre (sliders de Pitch y Yaw) y MUST permanecer como un único tab stop.

---

## Acceptance criteria

Matriz completa en [`007-mpr-trackball.feature`](007-mpr-trackball.feature). Principales:

- **AC-1:** Dado un estudio en modo MPR, cuando arrastro la esfera hacia la derecha, entonces el Yaw del readout aumenta y las tres vistas 2D se actualizan sincronizadas.
- **AC-2:** Dado un estudio en modo MPR, cuando arrastro la esfera hacia abajo, entonces el Pitch del readout aumenta y el Yaw no cambia.
- **AC-3:** Dado que roté los planos, cuando activo **Reset**, entonces las normales vuelven a las canónicas, el readout muestra 0,0° · 0,0° y el crosshair queda en el mismo punto anatómico.
- **AC-4:** Dada la herramienta `crosshair`, cuando arrastro un brazo del crosshair en una vista 2D, entonces el crosshair se traslada y los planos **no** rotan.
- **AC-5:** Dado el foco en un slider, cuando presiono ←/→ o ↑/↓, entonces el valor cambia ±1° (±10° con Shift, ±15° con RePág/AvPág).
- **AC-6:** Dado un usuario sin sesión, el trackball funciona igual que con sesión.

---

## Out of scope

- La rotación de un **único plano** de forma independiente: el modelo sigue siendo el de US-50 (triedro rígido).
- El control de **Roll** (rotación en el plano de la imagen), que queda disponible sólo como lectura derivada interna.
- Cambios en el renderizado 3D volumétrico, el gizmo anatómico o los shaders (US-50).
- Cualquier cambio de backend o de contrato `/api/*`.
- Persistencia de la rotación entre estudios o sesiones.

---

## Non-functional requirements (the constitution's gates)

- **i18n:** copy nuevo en `es.ts` y `en.ts` (paridad verificada por `i18n.test.ts`). Claves: `viewer.mpr.trackball.label`, `.pitch`, `.yaw`, `.readout`, `.valueText`, `.reset`, `.resetAnnounce`, `.hint`. El separador decimal sigue el locale.
- **Accessibility:** el grupo es un único tab stop (`shared/roving.ts`); los sliders exponen `aria-valuetext` localizado; sólo el Reset anuncia (una vez, región `aria-live="polite"` existente); contraste no textual ≥ 3:1 (WCAG 1.4.11), objetivos ≥ 24 px (2.5.8) y alternativa al arrastre (2.5.7); respeta `prefers-reduced-motion`.
- **Security:** sin interpolación de datos DICOM ni de usuario en el markup nuevo; sin acceso a Postgres/Orthanc ni a `/api/*`.
- **Desktop parity:** el cambio vive en `web/src` + CSS + i18n y se vendorea en `desktop/src/renderer` sin modificaciones.
- **Performance / offline:** sin dependencias nuevas; un único render por frame durante el arrastre (objetivo 60 FPS); funciona sin red.

---

## Open questions

Ninguna pendiente. Resueltas por el Tech Lead el 2026-10-12:

- **Brazos del crosshair:** la rotación por arrastre de los brazos **se elimina**; el trackball es la única fuente de rotación angular (FR-6).
- **Alcance:** se rota el **triedro completo** alrededor de los ejes del plano activo (FR-2).

---

## Review checklist

- [x] No implementation detail (HOW) in this file — it lives in `plan.md`.
- [x] Every requirement is testable and unambiguous.
- [x] Role gating stated for each affected role.
- [x] Constitution gates (i18n, a11y, security, parity) addressed.
- [x] No unresolved `[NEEDS CLARIFICATION]` markers.
