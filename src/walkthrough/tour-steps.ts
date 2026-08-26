// ── Tour content catalog ───────────────────────────────────────────────────────
//
// The declarative, role-tagged step list the engine walks (see
// docs/walkthrough-guide-plan.md, TK-27). Kept separate from walkthrough.ts so
// the engine stays content-free and unit-testable on its own.
//
// Deliberately empty at this step: the wiring (Help button → engine) lands here
// (step 2); the actual steps arrive in later steps — common viewer core, then
// the investigador / medico / admin branches.

import type { TourStep } from "./walkthrough.js";

export const tourSteps: TourStep[] = [];
