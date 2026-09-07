/**
 * Shared fixture for src/zenodo/zenodo-panel.test.ts's split test files: the
 * real zenodo-panel markup (trimmed from src/index.html so selectors stay in
 * sync with what the app actually ships), a JWT builder matching auth.ts's
 * decodeToken() expectations, and a URL-routed fetch mock for authFetch.
 */

export function jwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.sig`;
}

/** Renders the zenodo panel + its toolbar opener + one selected explorer study. */
export function zenodoPanelHtml(): string {
  return `
    <button id="btn-open-zenodo" aria-expanded="false" aria-controls="zenodo-panel">Zenodo</button>

    <div class="study-item" data-id="study-123" aria-current="true">
      <span class="study-item__name">CT Torax</span>
    </div>

    <aside class="zenodo-panel zenodo-panel--closed" id="zenodo-panel">
      <div class="zenodo-panel__resize-handle" id="zenodo-resize-handle" aria-hidden="true"></div>
      <div class="z-panel-header">
        <div class="z-tabs">
          <button class="z-tab z-tab--active" data-tab="search">Buscar</button>
          <button class="z-tab" data-tab="publish">Publicar</button>
          <button class="z-tab" data-tab="config">Config</button>
          <button class="z-tab" data-tab="logs">Logs</button>
        </div>
        <button class="icon-btn z-panel-close" id="btn-close-zenodo" title="Cerrar">x</button>
      </div>

      <div class="z-tab-panel" id="z-tab-search">
        <div class="z-doi-bar">
          <input type="text" id="z-doi-input" class="z-search-input" autocomplete="off" />
          <button class="btn btn--secondary btn--sm" id="btn-z-resolve-doi">Importar por DOI</button>
        </div>
        <div class="z-search-bar">
          <input type="text" id="z-search-input" class="z-search-input" autocomplete="off" />
          <button class="btn btn--accent btn--sm" id="btn-z-search"><span>Buscar</span></button>
        </div>
        <div class="z-search-filters">
          <div class="filter-chips" id="z-filter-chips">
            <button class="filter-chip filter-chip--active" data-type="">Todos</button>
            <button class="filter-chip" data-type="dcm">DCM</button>
            <button class="filter-chip" data-type="zip">ZIP</button>
          </div>
          <div class="z-env-toggle" id="z-env-toggle">
            <button class="z-env-btn active" data-env="sandbox">Sandbox</button>
            <button class="z-env-btn" data-env="production">Producción</button>
          </div>
        </div>
        <div id="z-results" class="z-results">
          <div class="z-empty-state"><p>Buscá datasets</p></div>
        </div>
        <div class="z-pagination">
          <button class="icon-btn" id="z-prev" disabled title="Anterior"></button>
          <span id="z-pagination-info" class="z-pagination-info">—</span>
          <button class="icon-btn" id="z-next" disabled title="Siguiente"></button>
        </div>
      </div>

      <div class="z-tab-panel hidden" id="z-tab-publish">
        <div class="z-publish-scroll" id="z-publish-content">
          <div class="z-empty-state"><p>Seleccioná un estudio</p></div>
        </div>
      </div>

      <div class="z-tab-panel hidden" id="z-tab-config">
        <div class="z-config-scroll" id="z-config-content">
          <div class="z-empty-state"><span>Abrí este tab para cargar la configuración</span></div>
        </div>
      </div>

      <div class="z-tab-panel hidden" id="z-tab-logs">
        <div class="activity-log-toolbar" id="activity-filters">
          <div class="activity-log-toolbar-row">
            <span class="activity-filter-label">Tipo</span>
            <button class="btn btn--secondary activity-export-btn" id="btn-export-activity">Descargar CSV</button>
          </div>
          <div class="activity-log-filters">
            <button class="filter-chip filter-chip--active" data-filter-action="">Todos</button>
            <button class="filter-chip" data-filter-action="ZENODO_STUDY_PUBLISHED,ZENODO_PUBLISH_FAILED">Publicación</button>
            <button class="filter-chip" data-filter-action="ZENODO_IMPORT_STARTED,ZENODO_IMPORT_COMPLETED">Importación</button>
          </div>
          <div class="activity-log-filters">
            <span class="activity-filter-label">Resultado</span>
            <button class="filter-chip filter-chip--active" data-filter-result="">Todos</button>
            <button class="filter-chip" data-filter-result="success">Éxito</button>
            <button class="filter-chip" data-filter-result="error">Error</button>
          </div>
        </div>
        <div class="activity-log-scroll" id="activity-log-content">
          <div class="z-empty-state"><span>cargando…</span></div>
        </div>
      </div>
    </aside>`;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  blob?: Blob;
}

export type RouteHandler = (url: string, init?: RequestInit) => MockResponse | Promise<MockResponse>;

interface Route {
  match: (url: string, init?: RequestInit) => boolean;
  handle: RouteHandler;
}

/**
 * Builds a fetch replacement that routes by URL/method, for exercising
 * authFetch()-driven code without a real network. Unmatched calls reject
 * loudly (rather than silently 404ing) so a missing route reads as a test
 * bug, not a mysterious empty-state render.
 */
export function createMockFetch() {
  const routes: Route[] = [];
  const calls: { url: string; init?: RequestInit }[] = [];

  function on(match: Route["match"], handle: RouteHandler): void {
    routes.push({ match, handle });
  }

  async function fetchImpl(input: string, init?: RequestInit): Promise<Response> {
    const url = String(input);
    calls.push({ url, init });
    const route = [...routes].reverse().find((r) => r.match(url, init));
    if (!route) {
      throw new Error(`No mock route for ${init?.method ?? "GET"} ${url}`);
    }
    const result = await route.handle(url, init);
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.body,
      text: async () => JSON.stringify(result.body),
      blob: async () => result.blob ?? new Blob([JSON.stringify(result.body ?? {})]),
    } as Response;
  }

  return { fetchImpl, on, calls };
}
