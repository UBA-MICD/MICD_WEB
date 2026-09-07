/**
 * Shared jsdom bootstrap for tests that need a real DOM (event wiring, focus
 * management, aria attributes). Node's test runner isolates each *.test.ts
 * file in its own process, so installing globals here is safe — it never
 * leaks between files. Call `installDom()` once per file (e.g. in
 * `test.before`) and `resetDom()` between tests that need a clean document.
 */
import { JSDOM } from "jsdom";

let dom: JSDOM | undefined;

const GLOBAL_KEYS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLFormElement",
  "HTMLCanvasElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
  "HTMLAnchorElement",
  "HTMLImageElement",
  "Element",
  "Node",
  "EventTarget",
  "NodeFilter",
  "DocumentFragment",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "FocusEvent",
  "InputEvent",
  "ProgressEvent",
  "DragEvent",
  "FileReader",
  "File",
  "FileList",
  "DataTransfer",
  "Blob",
  "localStorage",
  "sessionStorage",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
  "ResizeObserver",
  "IntersectionObserver",
  "CSS",
] as const;

/**
 * Real jsdom has no layout engine, so `offsetParent` always returns null —
 * which breaks any "is this element visible" check (dialog focus trap,
 * roving tabindex, etc). This shim treats an element as "laid out" unless it
 * or an ancestor is explicitly hidden via the `hidden` attribute or an
 * inline `display:none`/`visibility:hidden` style, which is how this
 * codebase actually hides things (`.hidden { display: none }` toggled via
 * classList — see styles.css — plus the `hidden` attribute).
 */
function shimOffsetParent(window: JSDOM["window"]): void {
  Object.defineProperty(window.HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: InstanceType<typeof window.HTMLElement>) {
      let el: typeof this | null = this;
      while (el) {
        if (el.hidden) return null;
        const style = (el as any).style as CSSStyleDeclaration | undefined;
        if (
          style &&
          (style.display === "none" || style.visibility === "hidden")
        ) {
          return null;
        }
        el = el.parentElement as typeof this | null;
      }
      return this.ownerDocument.body;
    },
  });
}

function installStubs(window: JSDOM["window"]): void {
  if (!window.matchMedia) {
    (window as any).matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  if (!(window as any).ResizeObserver) {
    (window as any).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!(window as any).IntersectionObserver) {
    (window as any).IntersectionObserver = class IntersectionObserver {
      constructor(_cb: unknown, _opts?: unknown) {}
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
}

/** Creates a fresh jsdom Document/Window and installs it onto `globalThis`. */
export function installDom(
  html = "<!doctype html><html><body></body></html>",
  url = "http://localhost/",
): JSDOM {
  dom = new JSDOM(html, { url, pretendToBeVisual: true });
  const { window } = dom;
  shimOffsetParent(window);
  installStubs(window);

  for (const key of GLOBAL_KEYS) {
    const value = (window as any)[key];
    if (value === undefined) continue;
    // Plain assignment silently no-ops for globals Node itself defines as a
    // getter with no setter (e.g. the native `navigator` global added in
    // Node 21+) — defineProperty replaces the accessor outright.
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: true,
    });
  }
  Object.defineProperty(globalThis, "window", {
    value: window,
    configurable: true,
    writable: true,
    enumerable: true,
  });

  return dom;
}

/** Replaces the current document's contents without recreating globals. */
export function setBody(html: string): void {
  document.body.innerHTML = html;
}

/** Tears down the jsdom instance installed by `installDom`. */
export function uninstallDom(): void {
  for (const key of GLOBAL_KEYS) {
    delete (globalThis as any)[key];
  }
  dom?.window.close();
  dom = undefined;
}
