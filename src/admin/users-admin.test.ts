/**
 * Tests for the DOM-free core of the admin users panel: validation, last-access
 * formatting, and escaped row markup. Run: npm test (Node's test runner, no
 * jsdom). escapeHtml/escapeAttr use document.createElement, so we stub a minimal
 * element that implements the real textContent→innerHTML escaping contract
 * (escapes & < >, leaves quotes) — enough to prove the helpers escape input.
 */
import test from "node:test";
import assert from "node:assert/strict";

// escapeHtml/escapeAttr are called lazily inside the tests below, so setting
// this stub at module top (before any test runs) is enough — no need to defer
// the import. It implements the real textContent→innerHTML contract.
(globalThis as { document?: unknown }).document = {
  createElement() {
    let text = "";
    return {
      set textContent(v: string) {
        text = v;
      },
      get innerHTML() {
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      },
    };
  },
};

import {
  formatLastAccess,
  validateNewUser,
  userRowHtml,
  usersTableHtml,
} from "./users-admin.ts";

test("formatLastAccess renders a dash when never logged in", () => {
  assert.equal(formatLastAccess(null), "—");
  assert.equal(formatLastAccess("not-a-date"), "—");
});

test("formatLastAccess renders YYYY-MM-DD HH:MM in UTC", () => {
  assert.equal(formatLastAccess("2026-08-19T10:05:30.000Z"), "2026-08-19 10:05");
});

test("validateNewUser trims name, lowercases email, and accepts a valid role", () => {
  const result = validateNewUser({
    name: "  Ada  ",
    email: "  ADA@micd.local ",
    role: "medico",
  });
  assert.deepEqual(result, {
    ok: true,
    value: { name: "Ada", email: "ada@micd.local", role: "medico" },
  });
});

test("validateNewUser rejects empty name, bad email, and unknown role", () => {
  assert.equal(validateNewUser({ name: " ", email: "a@b.co", role: "medico" }).ok, false);
  assert.equal(validateNewUser({ name: "X", email: "nope", role: "medico" }).ok, false);
  assert.equal(validateNewUser({ name: "X", email: "a@b.co", role: "root" }).ok, false);
});

const user = (over = {}) => ({
  id: 3,
  name: "Jane",
  email: "jane@micd.local",
  role: "medico" as const,
  status: "active" as const,
  has_password: true,
  last_login_at: "2026-08-19T10:00:00.000Z",
  ...over,
});

test("userRowHtml carries the user id and marks the current role selected", () => {
  const html = userRowHtml(user({ role: "investigador" }));
  assert.match(html, /data-user-id="3"/);
  assert.match(html, /<option value="investigador" selected>/);
  assert.match(html, /data-user-toggle="block"/); // active → offers Block
});

test("userRowHtml offers Enable for a blocked user", () => {
  const html = userRowHtml(user({ status: "blocked" }));
  assert.match(html, /data-user-toggle="enable"/);
});

test("userRowHtml escapes name and email (no XSS)", () => {
  const html = userRowHtml(
    user({ name: "<script>alert(1)</script>", email: "<b>@x" }),
  );
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;@x/);
});

test("usersTableHtml renders an empty-state row for no users", () => {
  const html = usersTableHtml([]);
  assert.match(html, /class="user-empty"/);
  assert.match(html, /colspan="6"/);
});
