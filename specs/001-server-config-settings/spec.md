# Spec: Admin-only server-config settings button

> **Number:** 001 · **Slug:** `001-server-config-settings` · **Ticket:** TK-29
> **Status:** Done · **Author:** MICD team · **Date:** 2026-09-08
> **Repos affected:** MICD_WEB (authored) · desktop (via vendoring)

## Why (problem & motivation)

The server-configuration modal (TK-29) lets a user set which PACS/API server the
client talks to. On `dev` it is triggered from the **Servidor** button on the main
(viewer) page: clicking it opens the config modal instead of taking the user to the
server interface.

Two problems follow from that:

1. **The main-page button no longer does what it says.** "Servidor" should take the
   user to the server interface (search / upload), the one deliberate step that
   leaves the local viewer — see constitution principle I. Instead it pops a
   configuration dialog.
2. **Anyone can re-point the server from the main page, which can cause an error.**
   Changing the active API origin mid-session — while a study is on screen, or by a
   non-admin who should never touch infrastructure — puts the app in an inconsistent
   state. Re-pointing the server is an administrative action and belongs to `admin`,
   inside the server area, not on the landing page.

## Who (users & roles)

- **guest / `investigador` / `medico`:** click **Servidor** → land on the server
  interface. They **cannot** change the server configuration; the settings control
  is not shown to them.
- **`admin`:** same navigation, **plus** a settings (gear) control **inside the
  server page** that opens the configuration modal. It is always visible to an admin
  on that screen.

## What (user stories)

- As **any user**, I want the **Servidor** button to take me to the server interface
  (search/upload), so the button matches its label and the local viewer is not
  interrupted by a dialog.
- As an **admin**, I want a settings button **within the server page** to configure
  the server URL, so re-pointing the server is a deliberate action in the right place.
- As a **non-admin**, I want to be unable to change the server from anywhere, so I
  cannot accidentally break my own session.

## Functional requirements

- **FR-1:** The main-page **Servidor** button MUST open the **server screen** on its
  default (Buscar) tab. It MUST NOT open the server-configuration modal.
- **FR-2:** The server screen MUST present a **settings control** that opens the
  existing server-configuration modal.
- **FR-3:** The settings control MUST be visible **only to `admin`** and, for an
  admin, MUST be visible whenever the server screen is shown. It MUST be hidden for
  guests, `investigador`, and `medico`, and it MUST re-evaluate on role change.
- **FR-4:** There MUST be **no path from the main/viewer page** to change the server
  configuration.
- **FR-5:** The configuration modal's own behaviour (validation, persistence,
  success/cancel, study reload) MUST be unchanged.

## Acceptance criteria

Full matrix in [`001-server-config-settings.feature`](001-server-config-settings.feature).
Headlines:

- **AC-1:** Given any user on the main page, when they click **Servidor**, then the
  server screen opens on Buscar and no configuration modal appears.
- **AC-2:** Given an `admin` on the server screen, then a settings/gear control is
  visible; when they activate it, the server-configuration modal opens.
- **AC-3:** Given a guest, `investigador`, or `medico` on the server screen, then no
  settings/gear control is present.
- **AC-4:** Given an admin who changed role away from admin, when the screen
  re-renders, then the settings control disappears (and vice-versa).

## Out of scope

- The **behaviour** of the configuration modal itself (validation, save, reload) —
  unchanged and already covered by `server-config-modal.test.ts`.
- The guest **"Configuración avanzada"** API-origin card on the auth screen
  (`.auth-card--settings`, `initApiOriginSetting()`) — a separate mechanism, left
  as-is.
- Any backend change.

## Non-functional requirements

- **i18n:** one new key, `server.configButton`, added to **both** `es.ts` and
  `en.ts` (es "Configurar servidor" / en "Configure server"). Used as the control's
  accessible name and tooltip.
- **Accessibility:** the settings control is a real `<button>` with a visible focus
  ring and an accessible name (it is icon-only); its SVG is `aria-hidden`. It is a
  normal tab stop in the server header.
- **Security / role gating:** visibility is gated by `isAdmin()` on the client;
  changing the server is an admin-only, in-context action. (Infrastructure the
  client points at is not privileged data, but the action is admin-scoped by design.)
- **Desktop parity:** the change is entirely in `web/src` + `index.html` + CSS +
  i18n and vendors into `desktop/src/renderer` unchanged.

## Open questions

None outstanding.

## Review checklist

- [x] No implementation detail (HOW) in this file — it lives in `plan.md`.
- [x] Every requirement is testable and unambiguous.
- [x] Role gating stated for each affected role.
- [x] Constitution gates (i18n, a11y, security, parity) addressed.
- [x] No unresolved `[NEEDS CLARIFICATION]` markers.
