# [TK-27] Walkthrough guide — interactive, follow-along, role-aware onboarding

> **Ticket:** TK-27 — Tutorial tipo "follow along" en la aplicación. Manual/BDD
> test specs: `web/docs/tk-27-walkthrough-guide.feature` (full matrix) and
> `desktop/docs/tk-27-walkthrough-guide.feature` (Electron env-specific).

> **What this is.** The design + execution plan for an in-app interactive
> tutorial that guides a user step-by-step through MICD's features, spotlighting
> real UI elements and advancing as the user actually interacts with them
> (follow-along), not a static modal. It activates on first login, can be
> skipped/closed at any moment, and can be relaunched from a Help button. The
> tour content is **branched by role** (`admin` / `medico` / `investigador`) so
> each user only walks the features their role can actually use.

## Context — the constraints that shape the design

- **No framework, no new runtime dependency.** `web/package.json` has exactly
  two runtime deps (`dicom-parser`, `fflate`); the build is plain `tsc`. The
  RBAC work locked "**no new runtime dependency**" as a web gate, so we **build a
  small in-house tour engine** rather than vendor Shepherd/Intro.js/Driver.js.
  This is a feature, not a compromise: those libraries are heavier than the ~1
  file of logic we need and none of them speak our screen/tab model.
- **Two top-level screens + a screen registry.** `shared/screen.ts` owns
  `viewer` | `server` | `invite`; the hidden screen stays in the DOM but `inert`.
  Features are split across screens, so the engine must be able to **drive
  navigation** (open a screen/tab) as part of a step, not just point at things.
- **Server screen has role-gated tabs.** `server-screen.ts`: `buscar` (all),
  `cargar`/upload (staff = admin+medico), `usuarios` (admin). `canUseTab()`
  already hides what a role can't use — the tour must honor the same gating.
- **Roles are first-class on the client.** `auth/auth.ts` exposes
  `getCurrentRole()`, `isAdmin()`, `isStaff()`, and `onAuthChange()`. First
  login is observable via the `login-form` `onSuccess` and `onAuthChange`.
- **i18n is mandatory and parity-checked.** All copy goes through `t()` /
  `data-i18n`; `en.ts` and `es.ts` must carry **identical key sets**
  (`i18n.test.ts` fails otherwise), and dynamic markup re-renders on
  `onLocaleChange`.
- **A11y + safety gates.** Focus management on screen switches, roving tabindex
  patterns, `escapeHtml`/`escapeAttr` on every interpolation, tests via
  `tsx --test` (keep pure logic DOM-free; jsdom is available for DOM tests).
- **`localStorage` is available** (`shared/token-store.ts` uses it) — the
  "already seen the tour" flag lives there, guarded for absence.
- **Vendoring.** `web/src` is the source of truth; `desktop/src/renderer` is a
  verbatim rsync. Every FE change: edit `web/src` → in `desktop/` run
  `make sync-web` then `make parity` (must print nothing).

---

## Decisions (locked)

| Question                | Decision                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine                  | In-house, ~1 module. No new dependency.                                                                                                                                                                                                                           |
| Highlight technique     | Full-screen dimmer with a **cut-out spotlight** over the target (SVG mask or 4-rect overlay) + an outline ring; a **popover** anchored to the target.                                                                                                             |
| Advance model           | Per-step: **follow-along** (`advance: {on:"event"}`) waits for the real interaction; informational steps use a **Next** button (`advance:{on:"next"}`). This satisfies "highlights in real-time as the user interacts" while still allowing pure-explainer steps. |
| Cross-screen steps      | Each step may declare `screen`/`tab`; the engine navigates there (via `showScreen` / `openServerScreen` / tab switch) **before** spotlighting.                                                                                                                    |
| Role branching          | Every step tagged `roles: Role[]`. The active script is `steps.filter(s => s.roles.includes(currentRole))`, further skipping any step whose target is missing/hidden (`optional`).                                                                                |
| Trigger                 | First successful login **per role** (flag `micd.tour.seen.<role>` in `localStorage`) auto-launches; a persistent **Help (?) button** relaunches on demand for anyone.                                                                                             |
| Skip/close              | `X`, a **Skip tour** button, and **Esc** end it at any step; ending sets the seen-flag (with a "Show me again from Help" line).                                                                                                                                   |
| Persistence granularity | Per-role flag, so a user promoted `medico → admin` gets the admin-only additions on next login.                                                                                                                                                                   |
| Reduced motion          | Respect `prefers-reduced-motion`: no spotlight animation, instant repositioning.                                                                                                                                                                                  |
| Scope of v1             | Guided coverage of existing features only; no feature changes. Burned-in-pixel / backend behavior untouched.                                                                                                                                                      |

---

## Architecture — `web/src/walkthrough/`

```
walkthrough/
  walkthrough.ts          # engine: start/stop, step runner, navigation, keyboard
  overlay.ts              # spotlight dimmer + outline + popover positioning (DOM)
  tour-steps.ts           # declarative step catalog (the content), role-tagged
  tour-state.ts           # localStorage seen-flags — PURE, DOM-free, unit-tested
  walkthrough.test.ts     # engine logic: role filtering, advance, skip
  tour-state.test.ts      # seen-flag get/set/absent
  overlay.test.ts         # positioning math (jsdom)
```

Wired in `main.ts`:

- `initWalkthrough()` in `startApp()` (registers Help button + keyboard).
- In the login success path (`login-form` `onSuccess` and/or `onAuthChange`):
  `maybeAutoStartTour(getCurrentRole())` → launches iff `!hasSeenTour(role)`.

### Step shape

```ts
export interface TourStep {
  id: string;
  roles: Role[]; // who sees this step
  target: string; // element id ("#tool-wl") or CSS selector
  titleKey: string; // i18n key
  bodyKey: string; // i18n key
  screen?: ScreenName; // ensure this screen is active first
  tab?: ServerTab; // ensure this server tab is active first
  placement?: "top" | "bottom" | "left" | "right" | "center";
  advance:
    | { on: "next" } // informational → Next button
    | { on: "event"; event: string; selector?: string }; // follow-along
  optional?: boolean; // if target missing/hidden, skip silently
  onEnter?: () => void | Promise<void>;
  onExit?: () => void;
}
```

The engine, per step: resolve role list → run `onEnter` / navigate to
`screen`+`tab` → wait a frame for layout → find `target`; if absent and
`optional`, skip; otherwise spotlight + popover. For `advance.on==="event"` it
attaches a one-shot listener (`target.addEventListener(event, …, {once:true})`)
and advances when the user performs the action; for `"next"` it shows the Next
button. `X` / Skip / Esc call `stop()` at any time.

### Controls & a11y

Popover is a focus-trapped `role="dialog"` with `aria-modal`, an `aria-live`
region announcing "Step N of M", **Back / Next / Skip** buttons and a close `X`.
On stop, focus returns to the opener (the Help button or the element that had
focus). Escape closes. Reduced-motion disables transitions.

---

## Cross-screen orchestration

Because features live on different screens/tabs, the engine treats navigation as
part of a step:

- `screen: "server"` → `showScreen("server")` (or `openServerScreen(tab)`).
- `tab: "cargar"` → switch the server tab before highlighting.
- Returning to viewer-only steps → `showScreen("viewer")`.

Navigation is idempotent and uses the existing exported functions, so the tour
never reaches into internal state. Role gating is inherited for free: if a tab is
hidden for the role, its steps are `optional` and skip.

---

## The tour content — branched by role

Three scripts share a **common viewer core** (local viewing needs no session, so
it's the same for everyone) and then diverge. Steps are listed with their target
and advance mode. `▶` = follow-along (waits for the real interaction);
`▷` = informational (Next).

### A. Common core — viewer basics (all roles, pre- and post-login)

| #   | Target                                             | Teach                                         | Advance        |
| --- | -------------------------------------------------- | --------------------------------------------- | -------------- |
| 1   | center                                             | Welcome + "you can skip anytime (Esc)"        | ▷              |
| 2   | `#btn-open` / `#upload-drop`                       | Open a local DICOM (no login needed)          | ▶ open / drop  |
| 3   | `#tool-wl` + presets `#btn-preset-*`               | Window/Level + presets (bone/brain/lung/soft) | ▶ activate W/L |
| 4   | `#tool-zoom`, `#tool-pan`                          | Zoom & pan                                    | ▶ activate     |
| 5   | `#tool-mpr`, `#btn-view-axial/coronal/sagittal/3d` | MPR planes & 3D                               | ▷              |
| 6   | `#tool-metadata`                                   | Inspect DICOM tags                            | ▷              |
| 7   | `#tool-reset`                                      | Reset viewport                                | ▷              |
| 8   | `#btn-toggle-explorer` / `#explorer-panel`         | The study explorer rail                       | ▷              |
| 9   | `#locale-select`                                   | Switch language ES/EN                         | ▷              |
| 10  | `#btn-login` / `#btn-server`                       | "Sign in to reach server features"            | ▶ opens server |

> Steps 2–7 target the **viewer** screen; the engine ensures `screen:"viewer"`.

### B. `investigador` — read-only, PHI-free researcher

Everything in the core, then (server screen, `buscar` tab):

| #   | Target                                       | Teach                                                                                         | Advance       |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------- |
| I1  | `#tab-buscar` / `#server-search-studies`     | Search studies by patient/modality/date                                                       | ▶ type/search |
| I2  | `#server-date-from`,`#server-date-to`        | Date-range filter                                                                             | ▷             |
| I3  | `#study-list`                                | Results — **note: identity is anonymized for your role**                                      | ▷             |
| I4  | `#btn-open-selected` / `#study-detail-panel` | Open a study into the viewer                                                                  | ▶ open        |
| I5  | `#btn-export-explorer` / export dialog       | Export — **downloads are anonymized**                                                         | ▷             |
| I6  | `#btn-open-zenodo` → `#z-tab-search`         | Zenodo **public-corpus search** (the only Zenodo area a researcher sees)                      | ▷             |
| I7  | center                                       | "That's your toolkit — upload, user admin and publishing aren't part of the researcher role." | ▷             |

Explicitly **not shown** (hidden for role → `optional` skip): `cargar`,
`usuarios`, Zenodo config/logs/publish, activity log, delete.

### C. `medico` — clinical staff (adds write, full PHI)

Core + everything a researcher sees **without** the "anonymized" framing (medico
sees full PHI), plus:

| #   | Target                                        | Teach                                                                            | Advance           |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------- | ----------------- |
| M1  | `#tab-cargar` / `#upload-drop`                | Upload studies (drag-drop)                                                       | ▶ open upload tab |
| M2  | `#btn-upload-folder` / `#upload-folder-input` | Upload a whole folder                                                            | ▷                 |
| M3  | `#upload-rows` / `#upload-status`             | Progress & per-file status                                                       | ▷                 |
| M4  | `#btn-open-zenodo` → `#z-tab-search` + import | Search **and import** public datasets                                            | ▷                 |
| M5  | `#btn-export-explorer` / study-detail export  | Export a study (PNG / ZIP) with full metadata                                    | ▷                 |
| M6  | center                                        | "User management, Zenodo publishing/config and the activity log are admin-only." | ▷                 |

Not shown: `usuarios`, Zenodo `config`/`publish`, activity log, study delete.

### D. `admin` — full lifecycle

Core + all of medico's, plus the admin-only surfaces:

| #   | Target                                  | Teach                                                    | Advance    |
| --- | --------------------------------------- | -------------------------------------------------------- | ---------- |
| A1  | `#tab-usuarios` / `#panel-usuarios`     | The user-management panel                                | ▶ open tab |
| A2  | create-user form (name/email/role)      | Create a user → email invite is issued                   | ▷          |
| A3  | user row: role select                   | Assign / change roles                                    | ▷          |
| A4  | user row: block / enable                | Block & re-enable accounts                               | ▷          |
| A5  | user row: delete                        | **Soft-delete** (audit-preserving)                       | ▷          |
| A6  | last-access column                      | "Last login is tracked here"                             | ▷          |
| A7  | `#btn-activity` / `#activity-dialog`    | Audit log + `#btn-export-activity`                       | ▷          |
| A8  | `#btn-open-zenodo` → `#z-tab-config`    | Zenodo credentials & sync config                         | ▷          |
| A9  | `#z-tab-publish` / `#z-publish-content` | Publish a study to Zenodo (irreversible, outward-facing) | ▷          |
| A10 | `#z-tab-logs`                           | Sync logs / quota / status                               | ▷          |
| A11 | `#btn-help` (to add)                    | "Relaunch this tour anytime from here"                   | ▷          |

> A2–A6 target elements the `users-panel` renders from live data; those steps use
> selectors on the panel's own markup and are `optional` (skip cleanly if the
> list is empty). Confirm exact selectors/`data-*` hooks against
> `admin/users-panel.ts` when implementing; add stable `data-tour="…"` hooks
> where the panel lacks ids.

Every role ends on a short "You're set — reopen from the **?** button" step.

---

## Triggering & relaunch

- **First login (per role):** in the login `onSuccess` path, call
  `maybeAutoStartTour(role)`. Guarded by `hasSeenTour(role)` (localStorage
  `micd.tour.seen.<role>`), so it fires once per role and never for a returning
  user. A role change surfaced on refresh (via `onAuthChange`) that lands a
  never-seen role will offer the new-role tour on next login.
- **Help button (new):** add a `#btn-help` (**?**) to the top bar next to
  `#locale-select` / `#btn-login`, with `data-i18n` label + `aria-label`.
  Available signed-out too (runs the common core) and signed-in (runs the
  role script). This is the "manually relaunch" acceptance criterion.
- **Skip/close:** `X`, **Skip tour**, and **Esc** all `stop()` and set the seen
  flag. A subtle "You can reopen this from **?**" line reassures on exit.

---

## i18n

All titles/bodies/labels as keys in **both** `locales/en.ts` and `locales/es.ts`
(namespace `tour.*`, e.g. `tour.core.wl.title` / `.body`, `tour.investigador.…`,
`tour.medico.…`, `tour.admin.…`, plus `tour.controls.next/back/skip/close`,
`tour.progress` with `{n}`/`{total}` params). Keep the key sets identical
(i18n.test.ts). Popover copy re-renders on `onLocaleChange` mid-tour.
`escapeHtml`/`escapeAttr` on any interpolated value.

---

## Accessibility

- Popover is `role="dialog"` `aria-modal="true"`, focus-trapped, labelled by its
  title; **restore focus** to the opener on stop.
- `aria-live="polite"` step-progress announcements ("Step 3 of 9").
- Fully keyboard-driven: Tab within popover, Enter = Next, Esc = close; the
  spotlit target stays reachable for follow-along steps.
- `prefers-reduced-motion`: disable spotlight/popover transitions.
- Don't trap the user if a follow-along target disappears: a **Skip step** link
  is always present as an escape hatch.

---

## Testing

- `tour-state.test.ts` — seen-flag get/set and absent-`localStorage` safety
  (pure, DOM-free).
- `walkthrough.test.ts` — role filtering (each role → expected step ids),
  `optional` skipping when a target is missing, advance on `next` vs `event`,
  skip/close ends the run and sets the flag. Engine logic isolated from the DOM
  where possible; jsdom for the parts that need it.
- `overlay.test.ts` — spotlight/popover positioning math (jsdom).
- i18n parity: `tour.*` keys present in both locales.
- Coverage: web gate is 70% (Codecov).

---

## Delivery — sequenced, one commit per step

Branch `feat/walkthrough-guide`, one commit per step, plain imperative messages
(match web history), **no `Co-Authored-By`/Claude trailers**, and per FE commit
vendor to desktop (`make sync-web` + `make parity`).

| Step | Scope                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Engine skeleton: `walkthrough.ts` + `overlay.ts` + `tour-state.ts`, spotlight/popover, keyboard, Skip/Esc/X. No content yet. Unit tests for state + advance. |
| 2    | `#btn-help` in the top bar + `initWalkthrough()` wiring in `main.ts`; manual relaunch works.                                                                 |
| 3    | **Common core** steps (viewer basics) + i18n keys + tests.                                                                                                   |
| 4    | **investigador** script (search / view / anonymized export / Zenodo search).                                                                                 |
| 5    | **medico** script (upload, import, full-PHI export).                                                                                                         |
| 6    | **admin** script (users panel, activity log, Zenodo config/publish/logs); add `data-tour` hooks in `users-panel` where needed.                               |
| 7    | First-login auto-start (per-role flag) in the login success path.                                                                                            |
| 8    | Docs: short `web/docs/walkthrough.md` (how it works + how to add a step) and an ADR if the team wants the "in-house engine, no dep" decision recorded.       |

Each step vendored to `desktop` and green (`npm run build && npm test` in a
`node:22-alpine` container per repo convention).

---

## Resolved (was "open questions") — confirmed 2026-08-25

1. **Follow-along strictness → strict + Next fallback.** Interactive steps wait
   for the real action, but a **Next** button is always present so a user who
   can't perform it (no data to upload, etc.) is never stuck. This is the
   `advance:{on:"event"}` behavior with the Next control still rendered.
2. **Auto-start timing → first login, per role.** Fires once per role via
   `micd.tour.seen.<role>`. No signed-out auto-start; guests can still launch the
   common core from the **?** button.
3. **Dismiss → one-shot flag.** Skipping/finishing sets the seen-flag; never
   auto-shows again. No "don't show again" checkbox. Help button always
   relaunches.
4. **Help control → top-bar `?` icon.** Persistent `#btn-help` in the main top
   bar next to `#locale-select` / `#btn-login`, visible from any screen.

All four confirm the assumptions the Decisions table was already built on — no
plan changes required. Cleared to build.
