import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../../test/dom-setup.ts";
import { hideBanner } from "../../shared/banner.ts";

test.before(() => installDom());
test.after(() => uninstallDom());

let counter = 0;
async function freshUi(): Promise<typeof import("./segmentation-ui.ts")> {
  counter++;
  return (await import(
    `./segmentation-ui.ts?u=${counter}`
  )) as typeof import("./segmentation-ui.ts");
}

beforeEach(() => setBody('<div id="app-banner" class="hidden"></div>'));
afterEach(() => {
  hideBanner();
  document.body.innerHTML = "";
});

// US-45: la segmentación IA se genera desde Validaciones y se dibuja como
// polígono sobre la imagen real; `initSegmentation` ya no cablea controles.

test("initSegmentation is a no-op and does not throw", async () => {
  const ui = await freshUi();
  assert.doesNotThrow(() => ui.initSegmentation());
});

test("getLastSegmentation starts null", async () => {
  const ui = await freshUi();
  assert.equal(ui.getLastSegmentation(), null);
});
