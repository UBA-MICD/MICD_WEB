// loading.ts has two code paths per loader: a legacy single-canvas path (no
// ViewportManager) and a multi-viewport path that writes the active Viewport's
// data. loading.test.ts exercises the legacy path (no manager); this file runs
// the same loaders WITH a manager registered so the viewport branches — the
// per-viewport reset, sync-off-on-load, and displayParsed's vp path — are covered.
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { installDom, setBody, uninstallDom } from "../../test/dom-setup.ts";
import {
  viewerFixtureHtml,
  stubCanvas2DContext,
} from "../../test/viewer-fixture.ts";
import { initViewportManager } from "./viewport-registry.ts";
import { initFileInputs, loadStudyFromServer } from "./loading.ts";
import { state } from "./state.ts";
import { dicomCache } from "./cache.ts";
import { adoptSession, logout, type AuthUser } from "../auth/auth.ts";

test.before(() => {
  installDom();
  stubCanvas2DContext();
});
test.after(() => uninstallDom());

function withFakeDicomParser(dataSet: any, run: () => Promise<void>) {
  const previous = (globalThis as any).dicomParser;
  (globalThis as any).dicomParser = { parseDicom: () => dataSet };
  return run().finally(() => {
    (globalThis as any).dicomParser = previous;
  });
}

function fakeDataSet(): any {
  return {
    elements: { x7fe00010: { dataOffset: 0, length: 8 } },
    byteArray: new Uint8Array(64),
    string: (tag: string) =>
      (
        ({ x00280004: "MONOCHROME2", x00080060: "CT" }) as Record<
          string,
          string
        >
      )[tag],
    uint16: (tag: string) =>
      (
        ({
          x00280010: 2,
          x00280011: 2,
          x00280100: 16,
          x00280101: 12,
          x00280102: 11,
          x00280103: 0,
          x00280002: 1,
        }) as Record<string, number>
      )[tag],
    floatString: () => undefined,
  };
}

const testUser: AuthUser = {
  id: 1,
  email: "medico@micd.local",
  role: "medico",
};

beforeEach(() => {
  setBody(viewerFixtureHtml());
  dicomCache.clear();
  initViewportManager(
    document.getElementById("viewport-container") as HTMLElement,
  );
});

afterEach(async () => {
  delete (globalThis as any).fetch;
  await logout().catch(() => {});
});

test("loading local files populates the active viewport (manager path)", async () => {
  initFileInputs();
  const input = document.getElementById("open-files-input") as HTMLInputElement;
  const file = new File(["x"], "a.dcm");
  Object.defineProperty(input, "files", { value: [file], configurable: true });

  const { getViewportManager } = await import("./viewport-registry.ts");
  await withFakeDicomParser(fakeDataSet(), async () => {
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });

  const vp = getViewportManager()!.activeViewport!;
  assert.equal(vp.data.source, "local");
  assert.equal(vp.data.files.length, 1);
  // displayParsed recomputed a real window/level for the fresh viewport.
  assert.ok(vp.data.viewport.windowWidth > 0);
});

test("loading a server study resets and populates the active viewport", async () => {
  await adoptSession("tok", "ref", testUser);
  (globalThis as any).fetch = async (url: string) =>
    url.includes("/instances") && !url.includes("/file")
      ? new Response(JSON.stringify({ instances: [{ instanceId: "i1" }] }), {
          status: 200,
        })
      : new Response(new ArrayBuffer(8), { status: 200 });

  const { getViewportManager } = await import("./viewport-registry.ts");
  await withFakeDicomParser(fakeDataSet(), async () => {
    await loadStudyFromServer("study-1");
  });

  const vp = getViewportManager()!.activeViewport!;
  assert.equal(state.serverStudyId, "study-1");
  assert.equal(vp.data.source, "server");
  assert.ok(
    vp.data.viewport.windowWidth > 0,
    "viewport W/L recomputed for the new study",
  );
});
