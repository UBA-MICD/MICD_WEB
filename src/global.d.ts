declare global {
  interface Window {
    /**
     * Set synchronously by Electron's preload before page scripts run, so
     * auth.ts's module-load-time resolveApiOrigin() sees it. index.html sets
     * `window.MICD_API_ORIGIN ??= ""` so the browser build still resolves
     * same-origin without clobbering the desktop's stored value.
     */
    MICD_API_ORIGIN?: string;

    api?: {
      /** Electron menu events (`menu:open-files`, `menu:open-folder`). */
      on: (channel: string, callback: () => void) => void;
      /** safeStorage-backed persistence for the refresh token. See shared/token-store.ts. */
      secureStore: {
        get: (key: string) => Promise<string | undefined>;
        set: (key: string, value: string) => Promise<void>;
        delete: (key: string) => Promise<void>;
      };
      /** Native save dialog + disk write, in place of the browser's `<a download>`. */
      saveFile: (filename: string, data: ArrayBuffer) => Promise<boolean>;
      getApiOrigin: () => Promise<string>;
      setApiOrigin: (origin: string) => Promise<void>;
    };
  }
}

export {};
