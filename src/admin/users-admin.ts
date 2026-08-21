// ── Admin: user management (US-H04) ──────────────────────────────────────────
//
// The DOM-free core of the admin users panel: the API calls, plus pure helpers
// for validation, formatting and row markup. Kept free of `document` so it can
// be unit-tested under Node's bare test runner (no jsdom), the same way the
// rest of web/src separates logic from wiring. The DOM glue lives in
// users-panel.ts.

import { authFetch, API_BASE, type Role } from "../auth/auth.js";
import { t } from "../i18n/i18n.js";
import { escapeHtml, escapeAttr } from "../shared/dom.js";

export interface AdminUser {
  id: number;
  name: string | null;
  email: string;
  role: Role;
  status: "active" | "invited" | "blocked" | "deleted";
  has_password: boolean;
  last_login_at: string | null;
}

const USERS_URL = `${API_BASE}/v1/users`;

// ── API ──────────────────────────────────────────────────────────────────────

/** Discriminated result so callers can show a 403/forbidden message distinctly. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // fall through to a generic message
  }
  return t("users.error.generic");
}

async function request<T>(
  input: string,
  init: RequestInit,
  parse: (res: Response) => Promise<T>,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await authFetch(input, init);
  } catch {
    return { ok: false, status: 0, error: t("users.error.network") };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: await readError(res) };
  }
  return { ok: true, data: await parse(res) };
}

const json = { "Content-Type": "application/json" };

export function fetchUsers(): Promise<ApiResult<AdminUser[]>> {
  return request(USERS_URL, {}, (res) => res.json());
}

export function createUser(input: {
  name: string;
  email: string;
  role: Role;
}): Promise<ApiResult<AdminUser>> {
  return request(
    USERS_URL,
    { method: "POST", headers: json, body: JSON.stringify(input) },
    (res) => res.json(),
  );
}

export function setUserRole(
  id: number,
  role: Role,
): Promise<ApiResult<AdminUser>> {
  return request(
    `${USERS_URL}/${id}/role`,
    { method: "PATCH", headers: json, body: JSON.stringify({ role }) },
    (res) => res.json(),
  );
}

export function setUserStatus(
  id: number,
  status: "blocked" | "active",
): Promise<ApiResult<AdminUser>> {
  return request(
    `${USERS_URL}/${id}/status`,
    { method: "PATCH", headers: json, body: JSON.stringify({ status }) },
    (res) => res.json(),
  );
}

export function deleteUser(id: number): Promise<ApiResult<null>> {
  return request(
    `${USERS_URL}/${id}`,
    { method: "DELETE" },
    async () => null,
  );
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

export const ROLE_OPTIONS: readonly Role[] = ["admin", "medico", "investigador"];

/** Format last_login_at as "YYYY-MM-DD HH:MM" (UTC), or a dash when never. */
export function formatLastAccess(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

/** Validate the create-user form the same way the backend does. */
export function validateNewUser(input: {
  name: string;
  email: string;
  role: string;
}): { ok: true; value: { name: string; email: string; role: Role } } | {
  ok: false;
  error: string;
} {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) return { ok: false, error: t("users.error.nameRequired") };
  if (!email || !email.includes("@")) {
    return { ok: false, error: t("users.error.emailRequired") };
  }
  if (!ROLE_OPTIONS.includes(input.role as Role)) {
    return { ok: false, error: t("users.error.roleRequired") };
  }
  return { ok: true, value: { name, email, role: input.role as Role } };
}

/** The translated label for a status pill. */
export function statusLabel(status: AdminUser["status"]): string {
  return t(`users.status.${status}`);
}

/** One `<tr>` for the users table — every interpolated value is escaped. */
export function userRowHtml(u: AdminUser): string {
  const roleOptions = ROLE_OPTIONS.map(
    (r) =>
      `<option value="${r}"${r === u.role ? " selected" : ""}>${escapeHtml(
        t(`users.role.${r}`),
      )}</option>`,
  ).join("");

  const blocked = u.status === "blocked";
  const toggleAction = blocked ? "enable" : "block";
  const toggleLabel = t(`users.action.${toggleAction}`);

  return `<tr data-user-id="${u.id}">
    <td>${escapeHtml(u.name ?? "—")}</td>
    <td>${escapeHtml(u.email)}</td>
    <td>
      <select data-user-role aria-label="${escapeAttr(t("users.col.role"))}">
        ${roleOptions}
      </select>
    </td>
    <td><span class="user-status user-status--${u.status}">${escapeHtml(
      statusLabel(u.status),
    )}</span></td>
    <td>${escapeHtml(formatLastAccess(u.last_login_at))}</td>
    <td class="user-actions">
      <button type="button" class="btn btn--outline btn--sm" data-user-toggle="${toggleAction}">${escapeHtml(
        toggleLabel,
      )}</button>
      <button type="button" class="btn btn--outline btn--sm" data-user-delete>${escapeHtml(
        t("users.action.delete"),
      )}</button>
    </td>
  </tr>`;
}

/** The full `<tbody>` inner HTML, or an empty-state row. */
export function usersTableHtml(users: AdminUser[]): string {
  if (users.length === 0) {
    return `<tr class="user-empty"><td colspan="6">${escapeHtml(
      t("users.empty"),
    )}</td></tr>`;
  }
  return users.map(userRowHtml).join("");
}
