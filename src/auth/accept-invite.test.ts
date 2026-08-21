/**
 * Tests for the pure parts of the accept-invite flow: reading the code from the
 * URL query string and validating the password. The fetch/DOM wiring is not
 * exercised here (no jsdom). Run: npm test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseInviteCode, validateInvitePassword } from "./accept-invite.ts";

test("parseInviteCode reads the invite query param", () => {
  assert.equal(parseInviteCode("?invite=abc123"), "abc123");
  assert.equal(parseInviteCode("?foo=1&invite=xyz&bar=2"), "xyz");
});

test("parseInviteCode returns null when absent or blank", () => {
  assert.equal(parseInviteCode(""), null);
  assert.equal(parseInviteCode("?foo=1"), null);
  assert.equal(parseInviteCode("?invite="), null);
  assert.equal(parseInviteCode("?invite=%20%20"), null); // whitespace only
});

test("parseInviteCode trims surrounding whitespace", () => {
  assert.equal(parseInviteCode("?invite=%20abc%20"), "abc");
});

test("validateInvitePassword rejects short passwords", () => {
  assert.equal(validateInvitePassword("short").ok, false);
  assert.equal(validateInvitePassword("1234567").ok, false); // 7 chars
});

test("validateInvitePassword accepts an 8+ char password", () => {
  assert.deepEqual(validateInvitePassword("12345678"), { ok: true });
});
