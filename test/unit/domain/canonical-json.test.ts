import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STABLE_JSON_CONTRACT,
  STABLE_JSON_INTEGRITY_MODE,
  canonicalizeStableJson,
  parseStableJsonBytes,
} from "../../../src/domain/canonical-json.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("pi-sparkle-stable-json-v1", () => {
  it("pins the project contract and preserves sorted-key bytes", () => {
    assert.equal(STABLE_JSON_CONTRACT, "pi-sparkle-stable-json-v1");
    assert.equal(STABLE_JSON_INTEGRITY_MODE, "local-weak-exact-bytes");
    assert.equal(
      canonicalizeStableJson({ b: 1, a: { z: 2, y: [3, 1] } }),
      '{"a":{"y":[3,1],"z":2},"b":1}'
    );
  });

  it("rejects values outside the strict JSON data model", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse = [1, 2];
    delete sparse[0];
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "value", { enumerable: true, get: () => 1 });
    for (const value of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      () => 1,
      Symbol("x"),
      1n,
      sparse,
      cyclic,
      new Date(0),
      accessor,
      "\ud800"
    ]) {
      assert.throws(() => canonicalizeStableJson(value), /stable JSON|finite|surrogate|cycle|plain|accessor|sparse/i);
    }
  });

  it("parses only exact canonical UTF-8 bytes", () => {
    assert.deepEqual(parseStableJsonBytes(bytes('{"a":[true,null,2],"b":"ok"}')), {
      a: [true, null, 2],
      b: "ok"
    });
  });

  it("refuses duplicate keys before ordinary parsing can erase them", () => {
    assert.throws(() => parseStableJsonBytes(bytes('{"a":1,"a":2}')), /duplicate object key/i);
  });

  it("refuses invalid UTF-8, BOM, whitespace, trailing data, and non-canonical bytes", () => {
    const invalidUtf8 = Uint8Array.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xc3, 0x28, 0x7d]);
    for (const value of [
      invalidUtf8,
      Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes('{"a":1}')]),
      bytes(' {"a":1}'),
      bytes('{"a":1}\n'),
      bytes('{"a":1}x'),
      bytes('{"b":2,"a":1}'),
      bytes('{"a":"\\ud800"}')
    ]) {
      assert.throws(() => parseStableJsonBytes(value), /UTF-8|BOM|canonical|trailing|surrogate|JSON/i);
    }
  });
});
