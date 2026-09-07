# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are medical researchers, data scientists, and academic research teams analyzing DICOM medical imaging studies, curating and sharing anonymized research datasets, and publishing to Zenodo. Secondary confirmed audiences include radiologists, healthcare professionals, and medical students/educators reviewing local studies in academic and clinical environments (UBA / FIUBA).

## Product Purpose

Provide a high-performance, distraction-free medical DICOM viewer and research data client delivered as a modern web application (PWA/SPA). It bridges immediate client-side local study exploration with collaborative server-backed workflows (Orthanc PACS exploration, secure study upload, anonymized PNG/ZIP exports, 3D/MPR reconstructions, and Zenodo dataset publication). Success means seamless, reliable DICOM visualization and data manipulation with zero friction and guaranteed data privacy.

## Positioning

An open, academic-grade web DICOM client (PWA/SPA) with client-side zero-install execution and offline capability via browser caching, integrated with open-science publishing (Zenodo) and clinical PACS backends, serving as the canonical upstream UI codebase adhering to strict behavioral and visual parity with its desktop counterpart (MICD_APP).

## Operating Context

- **Environments**: Modern standards-compliant web browsers (Chromium, Firefox, Safari, Edge) across desktop operating systems (Linux, macOS, Windows) and workstations in academic imaging labs, university hospitals, and research facilities. Served via containerized Nginx reverse proxy.
- **Workflows**: Opening local DICOM files and folders directly via drag-and-drop or browser file pickers without login; exploring and filtering remote studies via Orthanc backend API; performing windowing/leveling presets, measurements, slice navigation, and 3D/MPR reconstructions; exporting anonymized DICOM slices or series as PNG/ZIP; publishing research datasets to Zenodo.
- **Operating Conditions**: Fully functional in-browser for local file viewing without requiring authentication or backend connectivity; connects to backend servers over HTTP/HTTPS when configured.

## Capabilities and Constraints

- **Confirmed Capabilities**:
  - Local DICOM file and directory ingestion via HTML5 drag-and-drop and file input dialogues (`webkitdirectory`).
  - Window/level presets (lung, bone, brain, soft tissue, etc.), pan, zoom, invert, slice scroll, and playback.
  - Multi-planar reconstruction (MPR) and 3D volume visualization with WebGL2.
  - Remote study search, filtering, and retrieval via Orthanc backend API.
  - Anonymized export to PNG and ZIP (client-side in-memory compression via `fflate`).
  - Direct integration with Zenodo for research dataset publishing and imports.
  - Role-based administration panel (user management and system metrics).
  - Bilingual UI with runtime language switching (Spanish `es` and English `en`).
  - Client-side token storage (in-memory / secure cookies / session storage).
- **Confirmed Constraints**:
  - **Single Source of UI Truth**: This repository (`MICD_WEB`) is the canonical upstream source for the UI. Any UI layout, styling, and client component changes originate here and are downstream-vendored into `MICD_APP`.
  - **Browser Sandbox & Standards**: Operates strictly within browser sandbox constraints; platform-specific desktop APIs must be abstracted behind runtime feature detection (`window.api` detection) ensuring zero breakage in pure web execution.
  - **UI/UX Architecture**: Strict CSS Grid and Flexbox layouts, consistent design token usage, code-first component architecture without divergent styling hacks.
  - **Offline Resilience**: Local DICOM viewing must never require network connectivity or authentication.

## Brand Commitments

- **Identity**: MICD (Visor DICOM MICD / Medical Imaging Cloud Delivery), UBA-MICD, FIUBA.
- **Voice**: Technical, precise, professional, bilingual (Spanish/English), tailored to clinical and academic research standards.
- **Visual Foundation**: High-contrast dark theme optimized for radiological viewing (`--bg-base: #0d0f11`, emerald accent `#2ee6a8`), legible typography (Inter for UI, JetBrains Mono for metadata and coordinates), CSS Grid layouts.

## Evidence on Hand

- Production-grade codebase with mature design tokens in `src/styles.css` (measured WCAG AA compliance).
- Comprehensive unit test suite in `src/**/*.test.ts`.
- Dockerized deployment configuration via `Dockerfile`, `docker-compose.yml`, and `nginx.conf`.
- Parity synchronization targets with `MICD_APP`.
- Absences to preserve: No fabricated commercial marketing, testimonials, or pricing claims.

## Product Principles

1. **Clinical & Research Fidelity**: Exact, uncorrupted pixel representation and precise metadata display outrank decorative styling. Patient confidentiality and anonymization are non-negotiable.
2. **Zero-Friction Offline Access**: Local study viewing is immediate and requires no authentication, server connectivity, or onboarding hurdles.
3. **Single Source of UI Truth**: Serves as the upstream reference for all UI/UX components; desktop differences are isolated to environment detection and IPC hooks.
4. **Focused Ergonomics**: Dark, distraction-free environment tailored for prolonged image scrutiny, with high contrast, crisp typography, CSS Grid precision, and fast keyboard/mouse interactions.

## Accessibility & Inclusion

- WCAG AA contrast compliance across all text tokens against dark backgrounds (floor 4.78:1).
- Accessible keyboard navigation and skip links (`.skip-link`, `.sr-only`).
- Full bilingual internationalization support for Spanish and English (`i18n`).
