/**
 * Shared DOM fixture for viewer/interaction/loading/rendering tests — a
 * trimmed-down mirror of src/index.html's #viewer-screen markup, keeping
 * only the ids/attributes those modules actually query. Kept in test/ (not
 * src/) so it's never picked up by tsc's production build.
 */
export function viewerFixtureHtml(): string {
  return `
    <h1 class="topbar__title" id="topbar-title">DICOM Viewer</h1>

    <div class="series-nav hidden" id="series-nav">
      <button id="nav-prev">Prev</button>
      <input type="range" id="nav-slider" min="0" max="0" value="0" />
      <span id="nav-counter">1 / 1</span>
      <button id="nav-next">Next</button>
    </div>

    <button id="tool-wl" aria-pressed="false" aria-expanded="false"></button>
    <button id="tool-zoom" aria-pressed="false"></button>
    <button id="tool-pan" aria-pressed="false"></button>
    <button id="tool-crosshair" aria-pressed="false"></button>
    <button id="tool-reset"></button>
    <button id="tool-metadata" aria-expanded="false"></button>
    <button id="tool-mpr" disabled></button>

    <input type="file" id="open-files-input" multiple class="hidden" />
    <input type="file" id="open-folder-input" class="hidden" />
    <button id="btn-open">Open</button>
    <button id="btn-open-folder">Open folder</button>

    <button id="btn-export-menu" disabled></button>

    <div class="mpr-depth-slider-wrap hidden" id="mpr-depth-slider-wrap">
      <span id="mpr-depth-counter">Slice: 1/1</span>
      <input type="range" id="mpr-depth-slider" min="0" max="0" value="0" />
    </div>
    <div class="mpr-orientation-widget hidden" id="mpr-orientation-widget">
      <button class="btn-orient active" id="btn-view-axial">Axial</button>
      <button class="btn-orient" id="btn-view-sagittal">Sagittal</button>
      <button class="btn-orient" id="btn-view-coronal">Coronal</button>
      <button class="btn-orient" id="btn-view-3d">3D</button>
    </div>

    <div class="viewport-container cursor-wl" id="viewport-container">
      <canvas id="dicom-canvas"></canvas>
      <div class="overlay overlay--tl" id="overlay-tl"></div>
      <div class="overlay overlay--tr" id="overlay-tr"></div>
      <div class="overlay overlay--bl" id="overlay-bl"></div>
      <div class="overlay overlay--br" id="overlay-br"></div>
      <div class="drop-zone" id="drop-zone">
        <button id="drop-zone-open">Open</button>
      </div>
    </div>

    <div id="loading-indicator" class="hidden"></div>
    <div id="error-message" class="hidden"></div>

    <aside class="wl-panel" id="wl-panel">
      <span id="val-ww">0</span>
      <input type="range" id="slider-ww" min="1" max="4000" step="1" value="0" />
      <span id="val-wl">0</span>
      <input type="range" id="slider-wl" min="-1000" max="3000" step="1" value="0" />
      <button id="btn-preset-lung" data-preset="lung"></button>
      <button id="btn-preset-bone" data-preset="bone"></button>
      <button id="btn-preset-soft" data-preset="softTissue"></button>
      <button id="btn-preset-brain" data-preset="brain"></button>
    </aside>

    <aside class="zoom-panel" id="zoom-panel">
      <input type="range" id="slider-zoom" min="0.1" max="5" step="0.1" value="1" />
      <span id="val-zoom">1.0x</span>
      <button id="btn-zoom-fit"></button>
      <button id="btn-zoom-100"></button>
      <button id="btn-zoom-200"></button>
    </aside>

    <div id="mpr-orient-top" class="mpr-orient"></div>
    <div id="mpr-orient-bottom" class="mpr-orient"></div>
    <div id="mpr-orient-left" class="mpr-orient"></div>
    <div id="mpr-orient-right" class="mpr-orient"></div>
    <canvas id="mpr-reference-cube"></canvas>

    <aside class="metadata-panel" id="metadata-panel">
      <table><tbody id="metadata-tbody"></tbody></table>
    </aside>

    <div id="export-dialog" class="dialog-overlay hidden">
      <div class="dialog">
        <button id="btn-export-dialog-png">PNG</button>
        <button id="btn-export-dialog-zip">ZIP</button>
        <button id="export-dialog-cancel">Cancel</button>
      </div>
    </div>

    <div id="app-banner" class="hidden"></div>
    <div id="toast-container"></div>
  `;
}

/** Stubs HTMLCanvasElement#getContext("2d") with a minimal fake 2D context. */
export function stubCanvas2DContext(): void {
  (globalThis as any).HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    kind: string,
  ) {
    if (kind !== "2d") return null;
    return {
      canvas: this,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
      createImageData(w: number, h: number) {
        return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
      },
      putImageData() {},
      clearRect() {},
    };
  };
}
