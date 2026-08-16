// ── Modal dialogs ────────────────────────────────────────────────────────────
//
// The app's dialogs were previously just `.hidden` toggles: focus stayed
// wherever it was, Tab walked straight out into the page behind, and a screen
// reader could browse content the user could not see. This module owns the
// behaviour every modal needs — initial focus, a Tab trap, Escape, inerting
// the background, and putting focus back where it came from.
//
// Markup keeps the ARIA: the `.dialog` element carries role="dialog",
// aria-modal="true" and aria-labelledby. This module only moves focus.

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface OpenDialog {
  overlay: HTMLElement;
  opener: HTMLElement | null;
  inerted: HTMLElement[];
  onKeydown: (e: KeyboardEvent) => void;
}

// A stack, not a single value: the duplicate-upload confirmation can open on
// top of the server screen, and each layer has to restore what it changed.
const stack: OpenDialog[] = [];

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Marks everything outside `keep` inert, so neither Tab nor a screen reader's
 * virtual cursor can reach the page behind the dialog. Returns only the
 * elements this call changed, so nested dialogs don't clear each other's work.
 */
function inertBackground(keep: HTMLElement): HTMLElement[] {
  const changed: HTMLElement[] = [];
  Array.from(document.body.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    if (child === keep || child.contains(keep)) return;
    if (child.inert) return; // already inert — someone else owns it
    child.inert = true;
    changed.push(child);
  });
  return changed;
}

export function isDialogOpen(overlay: HTMLElement): boolean {
  return stack.some((d) => d.overlay === overlay);
}

/**
 * True while any modal is on screen. Global keyboard shortcuts check this:
 * the background is inert, but a document-level keydown listener still sees
 * every key, so "m" inside a dialog would otherwise toggle the panel behind it.
 */
export function anyDialogOpen(): boolean {
  return stack.length > 0;
}

/**
 * Shows a dialog and takes focus into it.
 *
 * `opener` is where focus returns on close; it defaults to whatever was
 * focused at the time, which is right for click-triggered dialogs.
 *
 * Escape closes unless the overlay carries `data-dialog-busy="true"` — used
 * while a login request is in flight, so the user can't dismiss a dialog whose
 * result is still coming.
 */
export function openDialog(
  overlay: HTMLElement,
  opener?: HTMLElement | null,
): void {
  if (isDialogOpen(overlay)) return;

  const restoreTo =
    opener ??
    (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);

  overlay.classList.remove("hidden");

  const entry: OpenDialog = {
    overlay,
    opener: restoreTo,
    inerted: inertBackground(overlay),
    onKeydown: (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (overlay.dataset.dialogBusy === "true") return;
        e.preventDefault();
        closeDialog(overlay);
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusable(overlay);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Wrap at the ends so Tab can never leave the dialog.
      if (e.shiftKey && (active === first || !overlay.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (
        !e.shiftKey &&
        (active === last || !overlay.contains(active))
      ) {
        e.preventDefault();
        first.focus();
      }
    },
  };

  overlay.addEventListener("keydown", entry.onKeydown);
  stack.push(entry);

  // Prefer an explicitly marked field, otherwise the first focusable thing.
  const initial =
    overlay.querySelector<HTMLElement>("[data-dialog-autofocus]") ??
    focusable(overlay)[0];
  initial?.focus();
}

/** Hides a dialog, un-inerts the background and restores focus to the opener. */
export function closeDialog(overlay: HTMLElement): void {
  const index = stack.findIndex((d) => d.overlay === overlay);
  if (index === -1) return;

  const [entry] = stack.splice(index, 1);
  overlay.removeEventListener("keydown", entry.onKeydown);
  entry.inerted.forEach((el) => {
    el.inert = false;
  });
  overlay.classList.add("hidden");

  // Callers that need to settle a promise (the login gate) listen for this
  // rather than wrapping every close path themselves.
  overlay.dispatchEvent(new CustomEvent("dialog:close", { bubbles: false }));

  // Only restore focus if it is still inside the dialog we just closed —
  // otherwise we'd yank it away from wherever the close handler moved it.
  if (
    entry.opener?.isConnected &&
    (document.activeElement === document.body ||
      overlay.contains(document.activeElement))
  ) {
    entry.opener.focus();
  }
}
