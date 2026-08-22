import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertExpectedActive,
  casActivePointer,
  resourceIdentityKey
} from "../../../src/adaptation/active-pointer.js";
import type { ResourceVersion } from "../../../src/adaptation/resource.js";
import type { ResourceVersionId } from "../../../src/domain/ids.js";
import {
  createProjectId,
  createResourceVersionId
} from "../../../src/domain/ids.js";
import { parseIsoTimestamp } from "../../../src/domain/timestamp.js";

const UUID = () => "01234567-89ab-cdef-0123-456789abcdef";
const BASE = "01234567-89ab-cdef-0123-456789abcdef";

const identity = {
  kind: "prompt",
  name: "worker-prompt",
  scope: { kind: "project", projectId: createProjectId(UUID) }
} as const;

function version(id: string): ResourceVersion {
  return {
    versionId: id as ResourceVersionId,
    identity,
    contentHash: "abc123",
    author: { kind: "human", identity: "tester" },
    parentVersionId: undefined,
    createdAt: parseIsoTimestamp("2026-08-21T08:00:00.000Z")
  };
}

test("resourceIdentityKey separates project scopes from user-global", () => {
  const key = resourceIdentityKey(identity);
  assert.ok(key.startsWith("prompt|worker-prompt|project:"));
  const globalKey = resourceIdentityKey({
    kind: "prompt",
    name: "worker-prompt",
    scope: { kind: "user-global" }
  });
  assert.ok(globalKey.endsWith("|user-global"));
  assert.notEqual(key, globalKey, "project and user-global scopes must not collide");
});

test("assertExpectedActive fails closed on a missing or stale version", () => {
  assert.throws(
    () => assertExpectedActive(undefined, createResourceVersionId(UUID)),
    /unknown expected version/
  );
  const stale = version(createResourceVersionId(UUID));
  assert.throws(
    () =>
      assertExpectedActive(stale, createResourceVersionId(() => `${BASE.slice(0, 34)}ff`)),
    /CAS failed/
  );
  assert.doesNotThrow(() => assertExpectedActive(stale, stale.versionId));
});

test("casActivePointer swaps only on an exact expected version and never creates keys", () => {
  const activeByKey = new Map<string, ResourceVersionId>();
  const v1 = createResourceVersionId(UUID);
  const v2 = createResourceVersionId(() => `${BASE.slice(0, 34)}01`);
  const v3 = createResourceVersionId(() => `${BASE.slice(0, 34)}02`);
  const key = resourceIdentityKey(identity);

  // CAS against an absent pointer must not create it.
  assert.throws(
    () => casActivePointer(activeByKey, identity, v1, v2),
    /unknown expected version/
  );
  assert.equal(activeByKey.size, 0);

  activeByKey.set(key, v1);
  casActivePointer(activeByKey, identity, v1, v2);
  assert.equal(activeByKey.get(key), v2);

  // Stale expectation (v1) fails closed; the pointer stays at v2.
  assert.throws(
    () => casActivePointer(activeByKey, identity, v1, v3),
    /CAS failed: active version .* does not match expected/
  );
  assert.equal(activeByKey.get(key), v2);

  casActivePointer(activeByKey, identity, v2, v3);
  assert.equal(activeByKey.get(key), v3);
});
