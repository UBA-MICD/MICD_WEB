# Reglas de Proyecto: MICD Web Client

Este archivo consolida las normas arquitectónicas, de desarrollo y gobernanza para el repositorio `web` (MICD Client), basadas en la Constitución del sistema (`.specify/memory/constitution.md`) y las pautas técnicas de `CLAUDE.md`.

## 1. Principios Constitucionales No Negociables

1. **Visor local libre y desacoplado:** Abrir y visualizar archivos DICOM locales no requiere sesión ni servidor (`startApp()` corre antes de cualquier chequeo de auth). Toda interacción con servidor ocurre tras el botón "Servidor" en su propia pantalla.
2. **Plataforma pura (Vanilla TS):** TypeScript compilado directamente a `dist/` con `tsc`. Cero frameworks, cero bundlers. No agregar nuevas dependencias en runtime sin un ADR aprobado (actualmente solo `dicom-parser` y `fflate`).
3. **Paridad con Desktop:** `web/src` es la única fuente de verdad. `desktop/src/renderer` es copia exacta. Cualquier comportamiento específico de Electron debe usar seams (`shared/token-store.ts`, `shared/desktop.ts`, `services/export-service.ts`, `window.MICD_API_ORIGIN`), nunca branches manuales de Electron en archivos de features.
4. **Bilingüe por construcción:** Interfaz completa en Español (default) e Inglés. Toda cadena visible pasa por `t()` o `data-i18n`. Las claves en `src/i18n/locales/es.ts` y `en.ts` deben ser idénticas (`npm test` valida esto).
5. **Accesibilidad (WCAG 2.2 AA):** Contraste medido y verificado en `styles.css`. Todo estado visual debe tener correspondencia programática (`aria-*`). Grupos navegables con un solo tab stop (`shared/roving.ts`). Modales con trampa de foco (`shared/dialog.ts`). Regiones activas (`aria-live`) racionadas.
6. **Seguridad:** Escapar todo dato proveniente de DICOM o usuario (`escapeHtml`/`escapeAttr`). El frontend solo se comunica con `/api/*` y `/auth/*` del backend, nunca directo con Postgres u Orthanc.
7. **Testing:** Lógica pura testeada con `node:test` / `tsx --test` sin dependencias de DOM siempre que sea posible.
8. **Decisiones inmutables y Especificaciones:** ADRs inmutables en `docs/adr/`. Especificaciones en `specs/` usando el flujo Spec-Driven Development (`.specify/`).

## 2. Pautas de Archivos y Compilación

- **Generación de `src/index.html`:** NUNCA editar `src/index.html` a mano; es un artefacto generado por `scripts/build-html.mjs` a partir de `src/html/index.template.html` y parciales en `src/html/partials/*.html`. Ejecutar `npm run build` o `npm run build:html`.
- **Entorno y Pruebas:**
  - Ejecutar tests: `npm test`
  - Build: `npm run build`
  - Validaciones de calidad: `make test`, `pre-commit run --all-files`
