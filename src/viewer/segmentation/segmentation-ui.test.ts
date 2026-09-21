import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../../test/dom-setup.ts";
import { hideBanner } from "../../shared/banner.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

/**
 * El módulo guarda el último resultado en una variable de módulo, así que cada
 * test lo reimporta fresco con un query distinto para partir sin estado.
 */
let counter = 0;
async function freshUi(): Promise<typeof import("./segmentation-ui.ts")> {
  counter++;
  return (await import(
    `./segmentation-ui.ts?u=${counter}`
  )) as typeof import("./segmentation-ui.ts");
}

function fixture(): void {
  setBody(`
    <div id="app-banner" class="hidden"></div>
    <div id="segmentation-status" class="hidden"></div>
    <div id="segmentation-badge" class="hidden"></div>
    <button id="tool-show-seg" aria-pressed="false"></button>
    <input type="checkbox" id="chk-segmentation-visible" disabled />
  `);
}

beforeEach(() => fixture());
afterEach(() => {
  // showBanner deja un timer de auto-cierre que tocaría el DOM después de que
  // el runner lo desmonta; hideBanner lo cancela.
  hideBanner();
  document.body.innerHTML = "";
});

// ── Sin segmentación en memoria ──────────────────────────────────────────────

test("without a segmentation, the button reports it on screen", async () => {
  const ui = await freshUi();
  ui.initSegmentation();

  document.getElementById("tool-show-seg")!.click();

  const banner = document.getElementById("app-banner")!;
  assert.ok(
    !banner.classList.contains("hidden"),
    "the message must be visible on screen",
  );
  assert.match(banner.textContent ?? "", /segmentaci/i);
});

test("without a segmentation, the button stays unpressed", async () => {
  const ui = await freshUi();
  ui.initSegmentation();

  document.getElementById("tool-show-seg")!.click();

  const btn = document.getElementById("tool-show-seg")!;
  assert.equal(btn.getAttribute("aria-pressed"), "false");
  assert.ok(!btn.classList.contains("active"));
});

test("without a segmentation, the layers checkbox stays disabled", async () => {
  const ui = await freshUi();
  ui.initSegmentation();

  document.getElementById("tool-show-seg")!.click();

  const toggle = document.getElementById(
    "chk-segmentation-visible",
  ) as HTMLInputElement;
  assert.equal(toggle.disabled, true);
  assert.equal(toggle.checked, false);
});

test("the button never triggers an inference on its own", async () => {
  // Si llamara al backend, este fetch explotaría el test.
  let fetched = false;
  (globalThis as { fetch?: unknown }).fetch = async () => {
    fetched = true;
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  };
  try {
    const ui = await freshUi();
    ui.initSegmentation();
    document.getElementById("tool-show-seg")!.click();
    assert.equal(fetched, false, "showing must not call the segmentation API");
  } finally {
    delete (globalThis as { fetch?: unknown }).fetch;
  }
});

// ── Init ─────────────────────────────────────────────────────────────────────

test("initSegmentation leaves both controls off", async () => {
  const ui = await freshUi();
  ui.initSegmentation();

  const toggle = document.getElementById(
    "chk-segmentation-visible",
  ) as HTMLInputElement;
  assert.equal(toggle.disabled, true);
  assert.equal(
    document.getElementById("tool-show-seg")!.getAttribute("aria-pressed"),
    "false",
  );
  assert.ok(
    document.getElementById("segmentation-badge")!.classList.contains("hidden"),
  );
});

test("initSegmentation survives a DOM without the segmentation controls", async () => {
  setBody('<div id="app-banner" class="hidden"></div>');
  const ui = await freshUi();
  assert.doesNotThrow(() => ui.initSegmentation());
});
