import test from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import { openDialog, closeDialog, isDialogOpen, anyDialogOpen } from "./dialog.ts";

// dialog.ts only touches `document` inside function bodies, never at module
// scope, so it's safe to import before the dom is installed.
test.before(() => installDom());
test.after(() => uninstallDom());

function dialogFixture(): { overlay: HTMLElement; opener: HTMLButtonElement } {
  setBody(`
    <button id="opener">Open</button>
    <div id="overlay" class="hidden">
      <div class="dialog" role="dialog" aria-modal="true">
        <button id="first">First</button>
        <input id="middle" />
        <button id="last">Last</button>
      </div>
    </div>
  `);
  return {
    overlay: document.getElementById("overlay") as HTMLElement,
    opener: document.getElementById("opener") as HTMLButtonElement,
  };
}

test("openDialog un-hides the overlay and focuses the first focusable element", () => {
  const { overlay } = dialogFixture();
  openDialog(overlay);
  assert.equal(overlay.classList.contains("hidden"), false);
  assert.equal(document.activeElement?.id, "first");
  closeDialog(overlay);
});

test("openDialog prefers an explicit [data-dialog-autofocus] target", () => {
  const { overlay } = dialogFixture();
  document.getElementById("middle")!.setAttribute("data-dialog-autofocus", "");
  openDialog(overlay);
  assert.equal(document.activeElement?.id, "middle");
  closeDialog(overlay);
});

test("isDialogOpen/anyDialogOpen reflect the stack", () => {
  const { overlay } = dialogFixture();
  assert.equal(isDialogOpen(overlay), false);
  assert.equal(anyDialogOpen(), false);
  openDialog(overlay);
  assert.equal(isDialogOpen(overlay), true);
  assert.equal(anyDialogOpen(), true);
  closeDialog(overlay);
  assert.equal(isDialogOpen(overlay), false);
  assert.equal(anyDialogOpen(), false);
});

test("openDialog is a no-op if the overlay is already open", () => {
  const { overlay } = dialogFixture();
  openDialog(overlay);
  document.getElementById("last")!.focus();
  openDialog(overlay); // should not reset focus to "first"
  assert.equal(document.activeElement?.id, "last");
  closeDialog(overlay);
});

test("openDialog inerts siblings and closeDialog restores them", () => {
  setBody(`
    <div id="behind">behind</div>
    <button id="opener">Open</button>
    <div id="overlay" class="hidden">
      <div class="dialog"><button id="first">First</button></div>
    </div>
  `);
  const overlay = document.getElementById("overlay") as HTMLElement;
  const behind = document.getElementById("behind") as HTMLElement;

  openDialog(overlay);
  assert.equal(behind.inert, true);
  assert.equal(overlay.hasAttribute("inert"), false);

  closeDialog(overlay);
  assert.equal(behind.inert, false);
});

test("closeDialog hides the overlay, fires dialog:close, and restores opener focus", () => {
  const { overlay, opener } = dialogFixture();
  opener.focus();
  openDialog(overlay);

  let closeFired = false;
  overlay.addEventListener("dialog:close", () => {
    closeFired = true;
  });

  closeDialog(overlay);
  assert.equal(overlay.classList.contains("hidden"), true);
  assert.equal(closeFired, true);
  assert.equal(document.activeElement, opener);
});

test("closeDialog on an overlay that isn't open is a no-op", () => {
  const { overlay } = dialogFixture();
  assert.doesNotThrow(() => closeDialog(overlay));
});

test("Escape closes the dialog unless data-dialog-busy is true", () => {
  const { overlay } = dialogFixture();
  openDialog(overlay);

  overlay.dataset.dialogBusy = "true";
  overlay.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  assert.equal(isDialogOpen(overlay), true);

  overlay.dataset.dialogBusy = "false";
  overlay.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  assert.equal(isDialogOpen(overlay), false);
});

test("Tab wraps from the last focusable element to the first", () => {
  const { overlay } = dialogFixture();
  openDialog(overlay);
  document.getElementById("last")!.focus();

  overlay.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
  );
  assert.equal(document.activeElement?.id, "first");
  closeDialog(overlay);
});

test("Shift+Tab wraps from the first focusable element to the last", () => {
  const { overlay } = dialogFixture();
  openDialog(overlay);
  document.getElementById("first")!.focus();

  overlay.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(document.activeElement?.id, "last");
  closeDialog(overlay);
});

test("Tab with no focusable elements just prevents default", () => {
  setBody(`
    <div id="overlay" class="hidden">
      <div class="dialog"><span>no controls here</span></div>
    </div>
  `);
  const overlay = document.getElementById("overlay") as HTMLElement;
  openDialog(overlay);

  const evt = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  overlay.dispatchEvent(evt);
  assert.equal(evt.defaultPrevented, true);
  closeDialog(overlay);
});

test("other keys are ignored by the trap", () => {
  const { overlay } = dialogFixture();
  openDialog(overlay);
  document.getElementById("first")!.focus();

  overlay.dispatchEvent(
    new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }),
  );
  assert.equal(document.activeElement?.id, "first");
  closeDialog(overlay);
});
