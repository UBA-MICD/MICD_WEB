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
    <button id="tool-length" aria-pressed="false"></button>
    <button id="tool-ellipse" aria-pressed="false"></button>
    <button id="tool-polygon" aria-pressed="false"></button>
    <div id="measure-announce" class="sr-only"></div>
    <button id="tool-reset"></button>
    <button id="tool-metadata" aria-expanded="false"></button>
    <button id="tool-view-3d" disabled></button>
    <button id="tool-mpr" disabled></button>

    <input type="file" id="open-files-input" multiple class="hidden" />
    <input type="file" id="open-folder-input" class="hidden" />
    <button id="btn-open">Open</button>
    <button id="btn-open-folder">Open folder</button>

    <button id="btn-export-menu" disabled></button>

    <div id="view-3d-container" class="hidden">
      <canvas id="view-3d-canvas" class="view-3d-canvas"></canvas>
      <div class="view-3d-depth-slider-wrap hidden" id="view-3d-depth-slider-wrap">
        <span id="view-3d-depth-counter">Slice: 1/1</span>
        <input type="range" id="view-3d-depth-slider" min="0" max="0" value="0" />
      </div>
      <div class="view-3d-orientation-widget hidden" id="view-3d-orientation-widget">
        <button class="btn-orient active" id="btn-view-3d-axial" data-i18n="viewer.view3d.axial">Axial</button>
        <button class="btn-orient" id="btn-view-3d-sagittal" data-i18n="viewer.view3d.sagittal">Sagittal</button>
        <button class="btn-orient" id="btn-view-3d-coronal" data-i18n="viewer.view3d.coronal">Coronal</button>
        <button class="btn-orient" id="btn-view-3d-3d" data-i18n="viewer.view3d.volumetricView">3D</button>
      </div>
      <canvas id="view-3d-reference-cube"></canvas>
      <div class="view-3d-sliders-panel" id="view-3d-sliders-panel">
        <label for="view-3d-scroll-axial" data-i18n="viewer.view3d.axial">Axial</label>
        <input type="range" id="view-3d-scroll-axial" min="0" max="0" value="0" />
        <span id="view-3d-val-axial">0</span>
        <label for="view-3d-scroll-sagittal" data-i18n="viewer.view3d.sagittal">Sagittal</label>
        <input type="range" id="view-3d-scroll-sagittal" min="0" max="0" value="0" />
        <span id="view-3d-val-sagittal">0</span>
        <label for="view-3d-scroll-coronal" data-i18n="viewer.view3d.coronal">Coronal</label>
        <input type="range" id="view-3d-scroll-coronal" min="0" max="0" value="0" />
        <span id="view-3d-val-coronal">0</span>
      </div>
    </div>

    <div class="mpr-depth-slider-wrap hidden" id="mpr-depth-slider-wrap">
      <span id="mpr-depth-counter">Slice: 1/1</span>
      <input type="range" id="mpr-depth-slider" min="0" max="0" value="0" />
    </div>
    <div class="mpr-orientation-widget hidden" id="mpr-orientation-widget">
      <button class="btn-orient active" id="btn-view-axial" data-i18n="viewer.view3d.axial">Axial</button>
      <button class="btn-orient" id="btn-view-sagittal" data-i18n="viewer.view3d.sagittal">Sagittal</button>
      <button class="btn-orient" id="btn-view-coronal" data-i18n="viewer.view3d.coronal">Coronal</button>
      <button class="btn-orient" id="btn-view-3d" data-i18n="viewer.view3d.volumetricView">3D</button>
    </div>

    <div class="viewport-container cursor-wl" id="viewport-container">
      <canvas id="dicom-canvas"></canvas>
      <canvas id="annotation-overlay" class="annotation-overlay"></canvas>
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

    <aside class="wl-panel" id="measure-panel">
      <button id="btn-unit-mm" data-unit="mm"></button>
      <button id="btn-unit-cm" data-unit="cm"></button>
      <select id="select-measure-unit">
        <option value="mm" selected>mm</option>
        <option value="cm">cm</option>
      </select>
      <input type="range" id="slider-measure-width" min="1" max="5" step="1" value="2" />
      <span id="val-measure-width">2px</span>
      <button id="btn-toggle-annotations"></button>
      <button id="btn-save-annotations"></button>
      <button id="btn-export-segmentation"></button>
      <button id="btn-clear-measurements"></button>
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
      font: "10px sans-serif",
      fillStyle: "#000",
      strokeStyle: "#000",
      lineWidth: 1,
      lineCap: "butt",
      textAlign: "left",
      textBaseline: "alphabetic",
      shadowColor: "transparent",
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      createImageData(w: number, h: number) {
        return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
      },
      putImageData() {},
      clearRect() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fill() {},
      arc() {},
      ellipse() {},
      translate() {},
      scale() {},
      rotate() {},
      setTransform() {},
      save() {},
      restore() {},
      fillRect() {},
      strokeRect() {},
      fillText() {},
      strokeText() {},
      setLineDash() {},
      measureText(text: string) {
        return { width: (text || "").length * 7 };
      },
      roundRect() {},
    };
  };
}
