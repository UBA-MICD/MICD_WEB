/**
 * global.d.ts — Augments the Window interface so the renderer gets
 * full IntelliSense on window.api without importing from the preload.
 */
import type { ElectronAPI } from '../main/preload';

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
