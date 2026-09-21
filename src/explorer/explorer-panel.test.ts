/**
 * Tests for explorer-panel.ts — the "Estudios en servidor" panel's collapse
 * toggle, drag-resize handle, and file-drop upload zone. Uses jsdom via
 * test/dom-setup.ts.
 */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import { initExplorerPanel } from "./explorer-panel.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

/**
 * jsdom does not implement DragEvent/DataTransfer (see its README's "not
 * supported" list), so drag-and-drop tests build a plain Event and attach
 * `dataTransfer`/`relatedTarget` directly — explorer-panel.ts only reads
 * those two properties off the event, never anything DragEvent-specific.
 */
function dragEvent(
  type: string,
  opts: {
    dataTransfer?: { files: File[] };
    relatedTarget?: EventTarget | null;
  } = {},
): Event {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  if ("dataTransfer" in opts) {
    Object.defineProperty(evt, "dataTransfer", {
      value: opts.dataTransfer,
      configurable: true,
    });
  }
  if ("relatedTarget" in opts) {
    Object.defineProperty(evt, "relatedTarget", {
      value: opts.relatedTarget,
      configurable: true,
    });
  }
  return evt;
}

beforeEach(() => {
  localStorage.clear();
  setBody(`
    <div id="app-banner" class="hidden"></div>
    <div id="toast-container"></div>
    <button id="btn-toggle-explorer"></button>
    <button id="btn-export-explorer"></button>
    <div id="explorer-panel" style="width: 300px;">
      <div id="explorer-resize-handle"></div>
      <div id="explorer-upload-status" class="hidden"></div>
    </div>
  `);
});

test("initExplorerPanel starts with the panel collapsed", () => {
  initExplorerPanel();
  const btn = document.getElementById("btn-toggle-explorer")!;
  const panel = document.getElementById("explorer-panel")!;
  assert.equal(panel.classList.contains("explorer-panel--collapsed"), true);
  assert.equal(btn.classList.contains("active"), false);
  assert.equal(btn.getAttribute("aria-expanded"), "false");
});

test("clicking the toggle button expands and re-collapses the panel", () => {
  initExplorerPanel();
  const btn = document.getElementById("btn-toggle-explorer")!;
  const panel = document.getElementById("explorer-panel")!;

  btn.click();
  assert.equal(panel.classList.contains("explorer-panel--collapsed"), false);
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.equal(btn.classList.contains("active"), true);

  btn.click();
  assert.equal(panel.classList.contains("explorer-panel--collapsed"), true);
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(btn.classList.contains("active"), false);
});

test("clicking export does not throw with no study loaded", () => {
  initExplorerPanel();
  const btn = document.getElementById("btn-export-explorer")!;
  assert.doesNotThrow(() => btn.click());
});

test("initExplorerPanel restores a saved width from localStorage", () => {
  localStorage.setItem("micd_explorer_width", "450");
  initExplorerPanel();
  assert.equal(document.getElementById("explorer-panel")!.style.width, "450px");
});

test("a saved width below the minimum is ignored", () => {
  localStorage.setItem("micd_explorer_width", "10");
  initExplorerPanel();
  // untouched from the fixture's inline style
  assert.equal(document.getElementById("explorer-panel")!.style.width, "300px");
});

test("dragging the resize handle updates the panel width and persists it", () => {
  initExplorerPanel();
  // The handle ignores drags while collapsed, so open the panel first.
  document.getElementById("btn-toggle-explorer")!.click();
  const handle = document.getElementById("explorer-resize-handle")!;
  const panel = document.getElementById("explorer-panel")!;

  handle.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 500,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(
    handle.classList.contains("explorer-panel__resize-handle--dragging"),
    true,
  );
  assert.equal(document.body.style.cursor, "ew-resize");

  // Dragging left (smaller clientX) grows the panel (it's anchored on the right).
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 450, bubbles: true }),
  );
  // jsdom reports offsetWidth as 0 (no layout engine), so startWidth is 0 and
  // the new width is clamped to MIN_WIDTH (220).
  assert.equal(panel.style.width, "220px");

  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  assert.equal(
    handle.classList.contains("explorer-panel__resize-handle--dragging"),
    false,
  );
  assert.equal(document.body.style.cursor, "");
  assert.equal(
    localStorage.getItem("micd_explorer_width"),
    String(panel.offsetWidth),
  );
});

test("mousedown on the resize handle while collapsed is a no-op", () => {
  initExplorerPanel(); // starts collapsed
  const handle = document.getElementById("explorer-resize-handle")!;

  handle.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: 500,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(
    handle.classList.contains("explorer-panel__resize-handle--dragging"),
    false,
  );
});

test("dragover/dragenter add drag-over, dragleave outside the panel removes it", () => {
  initExplorerPanel();
  const panel = document.getElementById("explorer-panel")!;

  panel.dispatchEvent(dragEvent("dragover"));
  assert.equal(panel.classList.contains("drag-over"), true);

  panel.dispatchEvent(dragEvent("dragleave"));
  assert.equal(panel.classList.contains("drag-over"), false);

  panel.dispatchEvent(dragEvent("dragenter"));
  assert.equal(panel.classList.contains("drag-over"), true);
});

test("dragleave onto a still-contained related target keeps drag-over", () => {
  initExplorerPanel();
  const panel = document.getElementById("explorer-panel")!;
  const inner = document.getElementById("explorer-resize-handle")!;

  panel.dispatchEvent(dragEvent("dragover"));
  panel.dispatchEvent(dragEvent("dragleave", { relatedTarget: inner }));
  assert.equal(panel.classList.contains("drag-over"), true);
});

test("dropping only unsupported files shows an error toast and stays collapsed of upload", async () => {
  setBody(`
    <button id="btn-toggle-explorer"></button>
    <button id="btn-export-explorer"></button>
    <div id="explorer-panel" style="width: 300px;">
      <div id="explorer-resize-handle"></div>
      <div id="explorer-upload-status" class="hidden"></div>
    </div>
    <div id="toast-container"></div>
  `);
  initExplorerPanel();
  const panel = document.getElementById("explorer-panel")!;

  const dt = { files: [new File(["x"], "notes.txt", { type: "text/plain" })] };
  panel.dispatchEvent(dragEvent("drop", { dataTransfer: dt }));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(panel.classList.contains("drag-over"), false);
  const toast = document.querySelector("#toast-container .toast--error");
  assert.ok(toast, "expected an error toast for an all-rejected drop");
});

test("dropping a mix of valid and rejected files warns about the rejected ones", async () => {
  setBody(`
    <button id="btn-toggle-explorer"></button>
    <button id="btn-export-explorer"></button>
    <div id="explorer-panel" style="width: 300px;">
      <div id="explorer-resize-handle"></div>
      <div id="explorer-upload-status" class="hidden"></div>
    </div>
    <div id="toast-container"></div>
  `);
  initExplorerPanel();
  const panel = document.getElementById("explorer-panel")!;

  const dt = {
    files: [
      new File(["x"], "image1.dcm"),
      new File(["x"], "notes.txt", { type: "text/plain" }),
    ],
  };
  panel.dispatchEvent(dragEvent("drop", { dataTransfer: dt }));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  const warning = document.querySelector("#toast-container .toast--warning");
  assert.ok(warning, "expected a warning toast for the mixed drop");
});

test("dropping nothing (no files) does not throw", async () => {
  initExplorerPanel();
  const panel = document.getElementById("explorer-panel")!;
  const dt = { files: [] as File[] };
  assert.doesNotThrow(() =>
    panel.dispatchEvent(dragEvent("drop", { dataTransfer: dt })),
  );
  await Promise.resolve();
});
