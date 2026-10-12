# Tasks: Control Trackball MPR (Pitch/Yaw)

> **Spec:** `specs/007-mpr-trackball/spec.md` · **Plan:** `specs/007-mpr-trackball/plan.md`

## Phase 0 — Setup

- [ ] T001 Rama de trabajo actual: `feat/rotator-tools` (web, desktop).
- [x] T002 Open questions resueltas (brazos del crosshair eliminados; triedro completo): reflejado en spec FR-2/FR-6 y plan §1.2/§3.3.

## Phase 1 — Acceptance

- [x] T010 Encode acceptance in `007-mpr-trackball.feature`.

## Phase 2 — Matemática (web)

- [ ] T020 [P] `src/viewer/mpr-rotation.ts`: cuaterniones, `orthonormalize`, `matrixToPitchYaw`, `applyPitchYawDelta`.
- [ ] T021 [P] `src/viewer/mpr-rotation.test.ts`: casos del plan (Rodrigues, ortonormalidad, round-trip, ±90°).
- [ ] T022 `src/viewer/mpr-coordinator.ts`: `rotatePitchYaw`, `getPitchYawDegrees`, `resetToOrthogonal`, `rotationQuat`.
- [ ] T023 `src/viewer/mpr-coordinator.test.ts`: reset conserva crosshair; normales ortogonales.

## Phase 3 — UI y Accesibilidad (web)

- [ ] T030 i18n: claves `viewer.mpr.trackball.*` en `es.ts` y `en.ts`.
- [ ] T031 `src/viewer/mpr-trackball.ts`: DOM, ARIA, sliders, Reset, readout, roving tabindex.
- [ ] T032 `src/styles.css`: bloque `.mpr-trackball*`, foco, reduced-motion, forced-colors, contraste medido (≥ 3:1).

## Phase 4 — Eventos (web)

- [ ] T040 `mpr-trackball.ts`: PointerEvents con captura, rAF, mapeo ΔX/ΔY→ángulos, Shift fino, clamp 15°.
- [ ] T041 `src/viewer/interaction.ts`: montaje del trackball y flag `isTrackballDragging`.
- [ ] T042 `src/viewer/interaction.ts`: retirar rotación por brazos (según T002).
- [ ] T043 `mpr-trackball.test.ts` + `interaction.test.ts`: aislamiento del crosshair, teclado, anuncio único del Reset.

## Phase 5 — Desktop parity

- [ ] T050 `make sync-web` in `desktop/`.
- [ ] T051 `make parity` prints match.
- [ ] T052 `npm run build` && `npm test` (desktop) green.

## Phase 6 — Verify & deliver

- [ ] T060 `npm run build` && `npm test` && `pre-commit run --all-files` (web) green.
- [ ] T061 Manual check de los escenarios del `.feature` (ambos temas, ES/EN, sólo teclado).
- [ ] T062 Commit (with required trailers) and push the branch(es).
