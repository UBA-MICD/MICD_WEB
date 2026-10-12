# Spec: Study pathology classification (web)

> **Number:** 005 · **Slug:** `005-study-classification` · **Ticket:** US-NN _(to assign)_
> **Status:** Draft · **Author:** Nacho · categories defined by María Emilia Ruiz (Hospital) · **Date:** 2026-09-22
> **Repos affected:** MICD_WEB · desktop (via vendoring) _(paired with MICD_BACKEND spec `001-study-classification`)_

## Why (problem & motivation)

The upload flow (Cargar tab) lets the user pick DICOM files and send them, but offers no way to say
what pathology a study shows. The hospital wants each study classified at upload and the category
visible when browsing studies.

The category list is **not hardcoded in the client**: the backend owns a catalog of categories, each
with a stable `key`. The client fetches the catalog when opening the upload page, builds the selector
from it (option value = category **id**, label = the client's translation of the `key`), and sends
the chosen **id** on upload. Human labels for both languages live only in the client's i18n, keyed by
the backend `key`.

## Who (users & roles)

- **admin, medico:** see and use the classification selector on the Cargar tab (they can upload).
- **investigador:** read-only — sees the category badge in the studies listing, has no upload/selector.
- **guest:** lands on the server-screen auth card; no upload, no listing.

## What (user stories)

- As a **medico/admin**, I want the upload page to offer the current categories (fetched from the server) and to pick one so the study is tagged by id.
- As an **authenticated user**, I want each study to show its category label (or "Sin clasificar") in the listing, in my language.

## Functional requirements

- **FR-1:** On opening the Cargar tab, the client MUST fetch the category catalog (`GET /api/v1/pathologies`) and populate a single-select control with one option per category (option value = id, label = `t('classification.'+key)`), plus a blank default ("Sin clasificar").
- **FR-1a:** The selector MUST live in an in-app modal (not a browser `alert`/`confirm`) that opens after the user picks or drops files on the Cargar tab. It MUST open reset to the blank default, and nothing is sent until the user presses "Subir"; Cancel/Escape uploads nothing.
- **FR-2:** When a category is selected, the client MUST send its `classification_id` with each file's upload request.
- **FR-3:** When no category is selected, the client MUST send no `classification_id` — the field is **optional** (study stays unclassified).
- **FR-4:** The studies listing MUST render the study's category as a badge using `t('classification.'+classification_key)`; an unclassified study MUST render a muted "Sin clasificar" badge.
- **FR-5:** The client MUST hold a translation for each catalog `key` in **both** `es` and `en`; labels MUST update on locale switch (including the dynamically-built selector options). A key with no translation MUST fall back to the raw key (never blank/throw).
- **FR-6:** The selector MUST NOT appear on the Buscar/explorer quick-drop path (out of scope this iteration).
- **FR-7:** In the browser build the Cargar tab MUST NOT offer a folder picker (`<input webkitdirectory>` makes Chrome show its own "Upload N files to this site?" prompt, which the page cannot suppress). Folders MUST instead be accepted by drag-and-drop onto the drop zone, walking sub-folders without any browser prompt. The desktop (Electron) build keeps the folder button, where no such prompt exists.

> **Revision 2026-09-22 (UX):** physicians missed that the category had to be set _before_ adding files. The flow is now files first, classification second (FR-1a), and the browser folder picker is dropped (FR-7).

## Acceptance criteria

- **AC-1:** Given the Cargar tab opened, when the catalog loads, then the selector lists the 6 categories with translated labels and a blank default.
- **AC-2:** Given "Tumor" selected, when I upload a study, then it appears in Buscar/panel with a "Tumor" badge.
- **AC-3:** Given no category selected, when I upload, then the study appears with a "Sin clasificar" badge.
- **AC-4:** Given a classified study shown, when I switch locale to English, then both the selector options and the badge switch to the English terms.
- **AC-5:** Given the Buscar quick-drop upload, when I drop files, then no selector is shown and the study is unclassified.
- **AC-6:** Given the Cargar tab, when I pick or drop files, then the classify dialog opens reset to "Sin clasificar" and no upload request is sent until I press "Subir".
- **AC-7:** Given the classify dialog open, when I press Cancelar or Escape, then nothing is uploaded.
- **AC-8:** Given the browser build, when I open the Cargar tab, then there is no "Seleccionar carpeta" button; when I drop a folder with sub-folders, then every DICOM inside is queued with no browser prompt.

_(full matrix in `005-study-classification.feature`)_

## Out of scope

Backend catalog/persistence (spec `001`). A UI to manage categories. Editing a study's classification
after upload. Filtering Buscar by category. Classification on the Buscar/explorer quick-drop. The
validation-queue panel.

## Non-functional requirements (the constitution's gates)

- **i18n:** new keys in **both** `es.ts`/`en.ts` (parity test), one per catalog key: `classification.label`, `classification.none`, `classification.{acv,hemorragia,tumor,desmielinizante,normales,otros}`. `t()` already falls back to the key if a translation is missing.
- **Accessibility:** the selector is a labeled native `<select>` (keyboard-operable, screen-reader-named via its `<label>`) inside a modal built on `shared/dialog.ts` (`role="dialog"`, `aria-modal`, focus trap, Escape = cancel, focus restored); focus lands on the selector. The badge is decorative text, not a live region.
- **Security:** the selected value is a numeric id from a server-provided list; the badge renders through the existing `t()`/escaping path (no raw user data). No new direct data-store access — still via `/api/*` (`authFetch`).
- **Desktop parity:** all changes land in `web/src/` and vendor into `desktop/src/renderer/` unchanged (`diff -r` must stay clean); the catalog fetch uses the existing `API_BASE`/`authFetch` seam.
- **Performance / offline:** the catalog is fetched once and cached; if the fetch fails, the selector shows only the blank default (studies upload unclassified) — a graceful degradation, no blocking.

## Open questions

- `[NEEDS CLARIFICATION: ticket id]`
- `[NEEDS CLARIFICATION: English wording for the medical terms — proposed: Stroke / Hemorrhage / Tumor / Demyelinating / Normal / Other.]`
- `[NEEDS CLARIFICATION: exact trigger to fetch the catalog — on Cargar-tab activation vs first upload interaction. Proposed: lazily on first Cargar-tab open, cached.]`

## Review checklist

- [x] No implementation detail (no HOW) leaked in.
- [x] Every requirement is testable and unambiguous.
- [x] Role gating stated for each affected role.
- [x] Constitution gates (i18n, a11y, security, parity) addressed.
- [ ] `[NEEDS CLARIFICATION]` markers resolved (ticket id, EN wording, fetch trigger).
