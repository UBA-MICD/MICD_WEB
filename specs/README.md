# Specs — Spec-Driven Development for MICD

This directory holds the **feature specs** for the MICD system, following the
[GitHub Spec Kit](https://github.com/github/spec-kit) approach: every non-trivial
feature is described (WHAT/WHY), designed (HOW) and broken into tasks **before** it
is implemented. Code follows the spec, not the other way around.

The principles every spec must honour live in
[`.specify/memory/constitution.md`](../.specify/memory/constitution.md).

## The workflow

```
specify  →  plan  →  tasks  →  implement
 spec.md    plan.md   tasks.md    the code
 WHAT/WHY   HOW       ordered     follows the tasks
```

1. **`/specify` → `spec.md`** — requirements, user stories, acceptance criteria.
   No implementation detail. Unknowns are marked `[NEEDS CLARIFICATION]`.
2. **`/plan` → `plan.md`** — the technical design: files to touch, utilities to
   reuse, testing strategy, and a **constitution check**.
3. **`/tasks` → `tasks.md`** — an ordered, checkboxed task list (`[P]` = parallel).
4. **`/implement`** — execute the tasks; keep the spec/tasks updated if reality
   diverges.

> Templates for each artifact are in [`.specify/templates/`](../.specify/templates/).
> The slash commands above are the Spec Kit mental model; wiring the `specify` CLI
> is optional (see the root note in the constitution) — the artifacts stand on their
> own.

## Layout

```
specs/
  README.md                        # this file
  NNN-short-slug/
    spec.md                        # WHAT / WHY
    plan.md                        # HOW
    tasks.md                       # ordered tasks
    NNN-short-slug.feature         # Gherkin acceptance (optional but encouraged)
```

Folders are numbered sequentially (`001-…`, `002-…`); numbers are never reused.

## Index

| #                                         | Feature                                        | Status | Ticket |
| ----------------------------------------- | ---------------------------------------------- | ------ | ------ |
| [001](001-server-config-settings/spec.md) | Admin-only server-config settings button       | Done   | TK-29  |
| [002](002-measurement-tools/spec.md)      | Herramientas de medición (longitud y área)     | Draft  | TK-26  |
| [003](003-manual-marking/spec.md)         | Marcado manual ad hoc (regiones poligonales)   | Draft  | US-48  |
| [004](004-study-loading/spec.md)          | Pipeline de carga unificado y orientación RLPA | Draft  | US-49  |
| [007](007-mpr-trackball/spec.md)          | Control trackball MPR (Pitch/Yaw)              | Draft  | TK-30  |

## How this relates to ADRs and `.feature` files

- **ADRs** (`docs/adr/`) record _decisions_ and are immutable. **Specs** record
  _features_ and evolve until the feature ships. A spec may cite the ADRs that
  constrain it; a spec that needs to overturn a decision triggers a new ADR.
- **`.feature`** files are the acceptance layer. The house style already keeps them
  in `docs/`; new feature specs keep their `.feature` alongside the spec so WHAT and
  its acceptance travel together.

## Multi-repo rule

The **constitution and templates** (`.specify/`) are system-level and kept
**identical** across `web`, `backend` and `desktop`, like the ADRs.

Individual **feature specs** live in the repo that owns the feature:

- **Front-end** features are authored in **`web`** (the upstream source of truth) and
  are inherited by **`desktop`** automatically through renderer vendoring — no
  separate desktop spec.
- **Backend** features are authored in **`backend`**.
- A feature that genuinely spans both is mirrored across the repos it affects, like
  an ADR.
