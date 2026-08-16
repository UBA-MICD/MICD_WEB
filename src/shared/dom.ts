// ── DOM References ───────────────────────────────────────────────────────────

export function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

// ── UI Helpers ───────────────────────────────────────────────────────────────

export function showLoading(show: boolean): void {
  $("loading-indicator").classList.toggle("hidden", !show);
}

export function showError(message: string): void {
  showLoading(false);
  const el = $("error-message");
  el.textContent = message;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 5000);
}

export function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// escapeHtml does not encode double-quotes; use this for HTML attribute values.
export function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

export function formatDate(raw: string): string {
  if (!raw || raw.length !== 8) return raw || "—";
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}
