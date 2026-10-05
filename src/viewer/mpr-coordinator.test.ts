import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { MPRGridCoordinator } from "./mpr-coordinator.js";

const dom = new JSDOM(
  `<!DOCTYPE html>
   <html>
     <body>
       <div id="viewport-container" class="viewport-container mpr-grid-container grid-layout-2x2">
         <div id="vp-0" class="viewport-cell viewport-cell--axial" data-viewport-id="vp-0"></div>
         <div id="vp-1" class="viewport-cell viewport-cell--coronal" data-viewport-id="vp-1"></div>
         <div id="vp-2" class="viewport-cell viewport-cell--sagittal" data-viewport-id="vp-2"></div>
         <div id="vp-3" class="viewport-cell viewport-cell--3d" data-viewport-id="vp-3"></div>
       </div>
     </body>
   </html>`,
);

globalThis.document = dom.window.document as any;
globalThis.HTMLElement = dom.window.HTMLElement as any;

test("MPRGridCoordinator: initFromVolume centers crosshair coordinates", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 200, 50);

  assert.deepEqual(coordinator.crosshair, {
    x: 50,
    y: 100,
    z: 25,
  });
});

test("MPRGridCoordinator: setCrosshair clamps coordinates within volume boundaries", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 50);

  // Set out-of-bounds coordinates
  coordinator.setCrosshair(-20, 150, 60);

  assert.equal(coordinator.crosshair.x, 0);
  assert.equal(coordinator.crosshair.y, 99);
  assert.equal(coordinator.crosshair.z, 49);
});

test("MPRGridCoordinator: setCrosshairFromNormalized maps 0..1 to voxel indices", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(101, 201, 51);

  coordinator.setCrosshairFromNormalized(0.5, 0.25, 1.0);

  assert.equal(coordinator.crosshair.x, 50);
  assert.equal(coordinator.crosshair.y, 50);
  assert.equal(coordinator.crosshair.z, 50);
});

test("MPRGridCoordinator: setSliceIndex updates individual orthogonal planes", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  coordinator.setSliceIndex("axial", 42);
  assert.equal(coordinator.getSliceIndex("axial"), 42);

  coordinator.setSliceIndex("coronal", 73);
  assert.equal(coordinator.getSliceIndex("coronal"), 73);

  coordinator.setSliceIndex("sagittal", 15);
  assert.equal(coordinator.getSliceIndex("sagittal"), 15);
});

test("MPRGridCoordinator: toggleMaximize applies 1x1 fullscreen CSS classes and toggles back", () => {
  const coordinator = new MPRGridCoordinator();
  const container = document.getElementById("viewport-container")!;
  const vp0 = document.getElementById("vp-0")!;
  const vp1 = document.getElementById("vp-1")!;
  const vp2 = document.getElementById("vp-2")!;
  const vp3 = document.getElementById("vp-3")!;

  // Maximize vp-0
  coordinator.toggleMaximize("vp-0");
  assert.equal(coordinator.maximizedQuadrant, "vp-0");
  assert.equal(container.classList.contains("mpr-has-maximized"), true);
  assert.equal(vp0.classList.contains("is-maximized"), true);
  assert.equal(vp0.classList.contains("is-hidden-by-maximize"), false);
  assert.equal(vp1.classList.contains("is-hidden-by-maximize"), true);
  assert.equal(vp2.classList.contains("is-hidden-by-maximize"), true);
  assert.equal(vp3.classList.contains("is-hidden-by-maximize"), true);

  // Toggle maximize again -> restores 2x2 grid
  coordinator.toggleMaximize("vp-0");
  assert.equal(coordinator.maximizedQuadrant, null);
  assert.equal(container.classList.contains("mpr-has-maximized"), false);
  assert.equal(vp0.classList.contains("is-maximized"), false);
  assert.equal(vp0.classList.contains("is-hidden-by-maximize"), false);
  assert.equal(vp1.classList.contains("is-hidden-by-maximize"), false);
  assert.equal(vp2.classList.contains("is-hidden-by-maximize"), false);
  assert.equal(vp3.classList.contains("is-hidden-by-maximize"), false);
});

test("MPRGridCoordinator: onCrosshairChange notifies listeners and unsubscribes cleanly", () => {
  const coordinator = new MPRGridCoordinator();
  coordinator.initFromVolume(100, 100, 100);

  let notified = 0;
  const unsubscribe = coordinator.onCrosshairChange((c) => {
    notified++;
    assert.equal(c.x, 30);
  });

  coordinator.setCrosshair(30, 40, 50);
  assert.equal(notified, 1);

  unsubscribe();
  coordinator.setCrosshair(20, 20, 20);
  assert.equal(notified, 1); // Not called after unsubscribe
});
