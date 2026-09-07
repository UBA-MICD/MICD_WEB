/**
 * Tests for system-panel.ts — renderLoading, renderStats (storage bar with
 * various pct/alert states), renderError, and the reload() async flow.
 *
 * No jsdom needed: the functions only set container.innerHTML. authFetch is
 * driven by the globalThis.fetch stub (authFetch calls fetch directly without
 * checking for a session first; it only escalates on 401, so a 200 mock needs
 * no auth setup). escapeHtml needs a minimal document.createElement stub.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mountSystemPanel } from "./system-panel.ts";

// escapeHtml uses document.createElement — stub the real textContent→innerHTML
// escaping contract (& < > only — same as users-admin.test.ts).
(globalThis as { document?: unknown }).document = {
  createElement() {
    let text = "";
    return {
      set textContent(v: string) {
        text = v;
      },
      get innerHTML() {
        return text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      },
    };
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

interface Stats {
  disk_used_mb: number;
  disk_max_mb: number | null;
  disk_used_pct: number | null;
  alert: boolean | null;
  count_studies: number;
  count_series: number;
  count_instances: number;
}

const base: Stats = {
  disk_used_mb: 512,
  disk_max_mb: 1024,
  disk_used_pct: 50,
  alert: false,
  count_studies: 3,
  count_series: 12,
  count_instances: 88,
};

function fetchOk(stats: Stats): void {
  (globalThis as { fetch?: unknown }).fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => stats,
  });
}

function fetchError(status = 503): void {
  (globalThis as { fetch?: unknown }).fetch = async () => ({
    ok: false,
    status,
  });
}

function fetchThrows(): void {
  (globalThis as { fetch?: unknown }).fetch = async (): Promise<never> => {
    throw new Error("network error");
  };
}

function box(): { innerHTML: string } {
  return { innerHTML: "" };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test("reload() renders loading skeleton synchronously then replaces with stats", async () => {
  fetchOk(base);
  const c = box();
  const { reload } = mountSystemPanel(c as unknown as HTMLElement);

  // renderLoading fires before the first await in reload(), so the loading
  // HTML is in place the moment reload() yields control back to the caller.
  const p = reload();
  assert.match(c.innerHTML, /sys-skeleton/);
  assert.match(c.innerHTML, /sys-skeleton--bar/);

  await p;
  assert.match(c.innerHTML, /sys-stats-grid/);
});

test("renderStats renders storage bar with fill when disk_max_mb is set", async () => {
  fetchOk({ ...base, disk_used_pct: 50 });
  const c = box();
  const { reload } = mountSystemPanel(c as unknown as HTMLElement);
  await reload();

  assert.match(c.innerHTML, /sys-storage__track/);
  assert.match(c.innerHTML, /sys-storage__fill/);
  assert.match(c.innerHTML, /50\.0%/);
  assert.match(c.innerHTML, /var\(--accent\)/); // pct ≤ 70 → accent colour
});

test("storageBar renders without fill bar when disk_max_mb is null", async () => {
  fetchOk({ ...base, disk_max_mb: null, disk_used_pct: null });
  const c = box();
  const { reload } = mountSystemPanel(c as unknown as HTMLElement);
  await reload();

  assert.match(c.innerHTML, /sys-storage/);
  assert.ok(
    !c.innerHTML.includes("sys-storage__fill"),
    "should not render fill bar",
  );
  assert.ok(
    !c.innerHTML.includes("sys-storage__track"),
    "should not render progress track",
  );
});

test("renderStats shows alert banner and --alert modifier when alert is true", async () => {
  fetchOk({ ...base, alert: true, disk_used_pct: 92 });
  const c = box();
  const { reload } = mountSystemPanel(c as unknown as HTMLElement);
  await reload();

  assert.match(c.innerHTML, /class="sys-alert"/);
  assert.match(c.innerHTML, /role="alert"/);
  assert.match(c.innerHTML, /sys-storage__bar--alert/);
  assert.match(c.innerHTML, /#e74c3c/); // pct > 90 → red
});

test("storageBar uses orange colour when 70 < pct ≤ 90", async () => {
  fetchOk({ ...base, disk_used_pct: 80 });
  const c = box();
  const { reload } = mountSystemPanel(c as unknown as HTMLElement);
  await reload();

  assert.match(c.innerHTML, /#f39c12/);
});

test("formatMb formats values ≥ 1024 MB as GB", async () => {
  fetchOk({
    ...base,
    disk_used_mb: 2048,
    disk_max_mb: 4096,
    disk_used_pct: 50,
  });
  const c = box();
  const { reload } = mountSystemPanel(c as unknown as HTMLElement);
  await reload();

  assert.match(c.innerHTML, /2\.0 GB/);
  assert.match(c.innerHTML, /4\.0 GB/);
});

test("renderStats renders study / series / instance counts", async () => {
  fetchOk(base);
  const c = box();
  const { reload } = mountSystemPanel(c as unknown as HTMLElement);
  await reload();

  assert.match(c.innerHTML, /sys-stat/);
  // The grid renders count_studies (3), count_series (12), count_instances (88)
  assert.match(c.innerHTML, />3</);
  assert.match(c.innerHTML, />12</);
  assert.match(c.innerHTML, />88</);
});

test("reload() renders error element when response is not ok", async () => {
  fetchError(503);
  const c = box();
  const { reload } = mountSystemPanel(c as unknown as HTMLElement);
  await reload();

  assert.match(c.innerHTML, /sys-error/);
  assert.ok(
    !c.innerHTML.includes("sys-stats-grid"),
    "should not render stats on error",
  );
});

test("reload() renders error element when fetch throws", async () => {
  fetchThrows();
  const c = box();
  const { reload } = mountSystemPanel(c as unknown as HTMLElement);
  await reload();

  assert.match(c.innerHTML, /sys-error/);
});
