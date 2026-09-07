/**
 * Tests for the network layer of users-admin.ts (fetchUsers/createUser/
 * setUserRole/setUserStatus/deleteUser/readError), which users-admin.test.ts
 * deliberately skips (see its docstring). No DOM needed — authFetch only
 * touches a stubbed global `fetch`, same approach as auth.test.ts.
 */
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  fetchUsers,
  createUser,
  setUserRole,
  setUserStatus,
  deleteUser,
  exportAuditLogCsv,
} from "./users-admin.ts";
import { API_BASE } from "../auth/auth.ts";

const USERS_URL = `${API_BASE}/v1/users`;

let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  (globalThis as { fetch?: unknown }).fetch = (
    url: string,
    init?: RequestInit,
  ) => fetchImpl(url, init);
});

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

test("fetchUsers returns the list on success", async () => {
  const users = [{ id: 1, email: "a@b.co" }];
  fetchImpl = async (url, init) => {
    assert.equal(url, USERS_URL);
    assert.equal(init?.method, undefined);
    return jsonResponse(200, users);
  };
  const result = await fetchUsers();
  assert.deepEqual(result, { ok: true, data: users });
});

test("fetchUsers surfaces the server's error message and status on failure", async () => {
  fetchImpl = async () => jsonResponse(403, { error: "forbidden" });
  const result = await fetchUsers();
  assert.deepEqual(result, { ok: false, status: 403, error: "forbidden" });
});

test("fetchUsers falls back to a generic message when the error body has no `error` field", async () => {
  fetchImpl = async () => jsonResponse(500, { oops: true });
  const result = await fetchUsers();
  assert.equal(result.ok, false);
  assert.equal((result as { status: number }).status, 500);
  assert.notEqual((result as { error: string }).error, "");
});

test("fetchUsers falls back to a generic message when the error body isn't JSON", async () => {
  fetchImpl = async () =>
    ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    }) as Response;
  const result = await fetchUsers();
  assert.equal(result.ok, false);
});

test("fetchUsers reports a network error when fetch throws", async () => {
  fetchImpl = async () => {
    throw new Error("offline");
  };
  const result = await fetchUsers();
  assert.equal(result.ok, false);
  assert.equal((result as { status: number }).status, 0);
});

test("createUser POSTs the input and returns the created user", async () => {
  const input = {
    name: "Ada",
    email: "ada@micd.local",
    role: "medico" as const,
  };
  const created = { id: 9, ...input };
  fetchImpl = async (url, init) => {
    assert.equal(url, USERS_URL);
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(init!.body as string), input);
    return jsonResponse(201, created);
  };
  const result = await createUser(input);
  assert.deepEqual(result, { ok: true, data: created });
});

test("setUserRole PATCHes /:id/role", async () => {
  fetchImpl = async (url, init) => {
    assert.equal(url, `${USERS_URL}/5/role`);
    assert.equal(init?.method, "PATCH");
    assert.deepEqual(JSON.parse(init!.body as string), { role: "admin" });
    return jsonResponse(200, { id: 5, role: "admin" });
  };
  const result = await setUserRole(5, "admin");
  assert.equal(result.ok, true);
});

test("setUserStatus PATCHes /:id/status", async () => {
  fetchImpl = async (url, init) => {
    assert.equal(url, `${USERS_URL}/5/status`);
    assert.deepEqual(JSON.parse(init!.body as string), { status: "blocked" });
    return jsonResponse(200, { id: 5, status: "blocked" });
  };
  const result = await setUserStatus(5, "blocked");
  assert.equal(result.ok, true);
});

test("deleteUser DELETEs /:id and resolves null on success", async () => {
  fetchImpl = async (url, init) => {
    assert.equal(url, `${USERS_URL}/7`);
    assert.equal(init?.method, "DELETE");
    return jsonResponse(204, null);
  };
  const result = await deleteUser(7);
  assert.deepEqual(result, { ok: true, data: null });
});

test("exportAuditLogCsv GETs /v1/activity/export and resolves a blob on success", async () => {
  const csv = "timestamp,action,result,resource_id,user_id,ip,detail\n";
  fetchImpl = async (url, init) => {
    assert.equal(url, `${API_BASE}/v1/activity/export`);
    assert.equal(init?.method, undefined);
    return {
      ok: true,
      status: 200,
      blob: async () => new Blob([csv], { type: "text/csv" }),
    } as unknown as Response;
  };
  const result = await exportAuditLogCsv();
  assert.equal(result.ok, true);
  assert.equal(await (result as { data: Blob }).data.text(), csv);
});

test("exportAuditLogCsv surfaces 403 for a non-admin caller", async () => {
  fetchImpl = async () => jsonResponse(403, { error: "forbidden" });
  const result = await exportAuditLogCsv();
  assert.deepEqual(result, { ok: false, status: 403, error: "forbidden" });
});
