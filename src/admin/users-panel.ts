// ── Admin users panel (DOM wiring) ───────────────────────────────────────────
//
// Binds the users-admin.ts core to the #panel-usuarios markup: loads the list,
// renders the table, and wires the create form, role change, block/enable and
// delete. All rendering goes through the escaped helpers in users-admin.ts.
// Re-renders on locale change so the (translated) role/status labels follow the
// language switch.

import {
  fetchUsers,
  createUser,
  setUserRole,
  setUserStatus,
  deleteUser,
  exportAuditLogCsv,
  usersTableHtml,
  validateNewUser,
  type AdminUser,
} from "./users-admin.js";
import { type Role } from "../auth/auth.js";
import { t } from "../i18n/i18n.js";
import { onLocaleChange } from "../i18n/i18n.js";
import { showToast } from "../shared/banner.js";
import { downloadBlob } from "../services/export-service.js";

export interface UsersPanelHandle {
  /** (Re)load the list from the server and render it. */
  reload(): Promise<void>;
}

export function mountUsersPanel(root: HTMLElement): UsersPanelHandle {
  const tbody = root.querySelector<HTMLElement>("[data-users-tbody]")!;
  const errorEl = root.querySelector<HTMLElement>("[data-users-error]")!;
  const form = root.querySelector<HTMLFormElement>("[data-user-create]")!;
  const nameEl = form.querySelector<HTMLInputElement>("[data-user-new-name]")!;
  const emailEl = form.querySelector<HTMLInputElement>("[data-user-new-email]")!;
  const roleEl = form.querySelector<HTMLSelectElement>("[data-user-new-role]")!;
  const formErr = form.querySelector<HTMLElement>("[data-user-new-error]")!;
  const exportBtn = root.querySelector<HTMLButtonElement>("[data-users-export]")!;

  let users: AdminUser[] = [];

  const showError = (msg: string): void => {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
  };
  const clearError = (): void => {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  };

  const render = (): void => {
    tbody.innerHTML = usersTableHtml(users);
  };

  async function reload(): Promise<void> {
    clearError();
    const result = await fetchUsers();
    if (!result.ok) {
      users = [];
      render();
      showError(
        result.status === 403 ? t("users.error.forbidden") : result.error,
      );
      return;
    }
    users = result.data;
    render();
  }

  // Re-render (translated labels) when the language changes.
  onLocaleChange(() => render());

  // ── Audit log CSV export (TK-06) ─────────────────────────────────────────────
  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    const result = await exportAuditLogCsv();
    exportBtn.disabled = false;

    if (!result.ok) {
      showToast(
        result.status === 403 ? t("users.error.forbidden") : result.error,
        "error",
      );
      return;
    }
    const saved = await downloadBlob(result.data, "audit-log.csv");
    if (!saved) showToast(t("export.saveCanceled"), "warning");
  });

  // ── Create ──────────────────────────────────────────────────────────────────
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formErr.classList.add("hidden");

    const check = validateNewUser({
      name: nameEl.value,
      email: emailEl.value,
      role: roleEl.value,
    });
    if (!check.ok) {
      formErr.textContent = check.error;
      formErr.classList.remove("hidden");
      return;
    }

    const submit = form.querySelector<HTMLButtonElement>("[data-user-new-submit]");
    if (submit) submit.disabled = true;
    const result = await createUser(check.value);
    if (submit) submit.disabled = false;

    if (!result.ok) {
      formErr.textContent = result.error;
      formErr.classList.remove("hidden");
      return;
    }
    form.reset();
    showToast(t("users.toast.created"), "success");
    await reload();
  });

  // ── Row actions (event delegation) ──────────────────────────────────────────
  const rowId = (el: HTMLElement): number =>
    Number(el.closest<HTMLElement>("[data-user-id]")?.dataset.userId);

  tbody.addEventListener("change", async (e) => {
    const select = (e.target as HTMLElement).closest<HTMLSelectElement>(
      "[data-user-role]",
    );
    if (!select) return;
    const result = await setUserRole(rowId(select), select.value as Role);
    if (!result.ok) {
      showToast(result.error, "error");
      await reload(); // revert the select to the server's truth
      return;
    }
    showToast(t("users.toast.roleChanged"), "success");
    await reload();
  });

  tbody.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;

    const toggle = target.closest<HTMLElement>("[data-user-toggle]");
    if (toggle) {
      const status = toggle.dataset.userToggle === "enable" ? "active" : "blocked";
      const result = await setUserStatus(rowId(toggle), status);
      if (!result.ok) showToast(result.error, "error");
      await reload();
      return;
    }

    const del = target.closest<HTMLElement>("[data-user-delete]");
    if (del) {
      if (!confirm(t("users.confirmDelete"))) return;
      const result = await deleteUser(rowId(del));
      if (!result.ok) showToast(result.error, "error");
      else showToast(t("users.toast.deleted"), "success");
      await reload();
    }
  });

  return { reload };
}
