/**
 * Menu events the Electron main process broadcasts to the renderer. Mirrored
 * by `MenuChannel` in desktop/src/main/preload.ts — the two are separate
 * repos, so nothing but this comment ties them together: add a channel there
 * and it must be added here too, or the renderer can't subscribe to it.
 *
 * It's a union rather than `string` so that a typo'd channel is a compile
 * error here instead of a subscription preload silently drops (its own
 * whitelist check rejects anything not on this list).
 */
type MenuChannel = "menu:open-files" | "menu:open-folder" | "menu:api-server";

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
      /** Subscribe to an Electron menu event. See `MenuChannel` above. */
      on: (channel: MenuChannel, callback: () => void) => void;
      /** Drop every subscription to a menu channel. */
      removeAllListeners: (channel: MenuChannel) => void;
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
