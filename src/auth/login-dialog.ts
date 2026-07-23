import { login, isAuthenticated, getCurrentUser } from "./auth.js";
import { $ } from "../shared/dom.js";

// ── Login dialog (promise-based popup, injected into auth.ts) ────────────────

let loginResolve: ((ok: boolean) => void) | null = null;
let loginInFlight = false;

/** Shows the login dialog; resolves true on login, false on cancel/Escape. */
export function promptLogin(): Promise<boolean> {
  ($("login-form") as HTMLFormElement).reset();
  $("login-error").classList.add("hidden");
  $("login-screen").classList.remove("hidden");
  ($("login-email") as HTMLInputElement).focus();
  return new Promise<boolean>((resolve) => {
    loginResolve = resolve;
  });
}

function closeLoginDialog(ok: boolean): void {
  $("login-screen").classList.add("hidden");
  loginResolve?.(ok);
  loginResolve = null;
}

export function initLoginDialog(): void {
  const form = $("login-form") as HTMLFormElement;
  const errorEl = $("login-error");
  const submitBtn = $("login-submit") as HTMLButtonElement;
  const cancelBtn = $("login-cancel") as HTMLButtonElement;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.classList.add("hidden");
    submitBtn.disabled = true;
    cancelBtn.disabled = true; // don't let cancel race an in-flight login
    loginInFlight = true;

    const email = ($("login-email") as HTMLInputElement).value;
    const password = ($("login-password") as HTMLInputElement).value;
    const result = await login(email, password);

    loginInFlight = false;
    submitBtn.disabled = false;
    cancelBtn.disabled = false;
    if (!result.ok) {
      errorEl.textContent = result.error;
      errorEl.classList.remove("hidden");
      return;
    }
    form.reset();
    closeLoginDialog(true);
  });

  cancelBtn.addEventListener("click", () => closeLoginDialog(false));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("login-screen").classList.contains("hidden") || loginInFlight) return;
    closeLoginDialog(false);
  });
}

// ── Session UI (sidebar login/logout state) ──────────────────────────────────

export function updateAuthUI(): void {
  const authed = isAuthenticated();
  $("btn-login").classList.toggle("hidden", authed);
  $("btn-logout").classList.toggle("hidden", !authed);
  $("session-email").textContent =
    getCurrentUser()?.email ?? (authed ? "Sesión activa" : "");
  $("session-email").classList.toggle("hidden", !authed);
}
