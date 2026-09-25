import { DomainValidationError } from "./errors.js";

export const STABLE_JSON_CONTRACT = "pi-sparkle-stable-json-v1" as const;
export const STABLE_JSON_INTEGRITY_MODE = "local-weak-exact-bytes" as const;

function fail(message: string): never {
  throw new DomainValidationError(`stable JSON: ${message}`);
}

function assertValidUnicode(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail(`${label} contains an unpaired Unicode surrogate`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail(`${label} contains an unpaired Unicode surrogate`);
    }
  }
}

function serialize(value: unknown, ancestors: Set<object>, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    assertValidUnicode(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} must be a finite number`);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value !== "object") {
    fail(`${path} contains a non-JSON ${typeof value} value`);
  }
  if (ancestors.has(value)) fail(`${path} contains a cycle`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail(`${path} contains a sparse array slot`);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
          fail(`${path}[${index}] is an accessor property`);
        }
      }
      for (const key of ownKeys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          fail(`${path} contains a non-JSON array property`);
        }
      }
      return `[${value.map((item, index) => serialize(item, ancestors, `${path}[${index}]`)).join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(`${path} must be a plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      fail(`${path} contains a symbol-keyed property`);
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (Object.getOwnPropertyNames(record).length !== keys.length) {
      fail(`${path} contains a non-enumerable property`);
    }
    const parts = keys.map((key) => {
      assertValidUnicode(key, `${path} key`);
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
        fail(`${path}.${key} is an accessor property`);
      }
      return `${JSON.stringify(key)}:${serialize(record[key], ancestors, `${path}.${key}`)}`;
    });
    return `{${parts.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * The one project-owned deterministic JSON serializer. This is a versioned
 * local byte contract, not RFC 8785/JCS and not a cryptographic integrity
 * mechanism.
 */
export function canonicalizeStableJson(value: unknown): string {
  return serialize(value, new Set<object>(), "$root");
}

/**
 * Compatibility export for existing experiment identities. Valid JSON values
 * use the strict project contract byte-for-byte. Historical invalid inputs keep
 * their pre-contract behavior until their callers are migrated; they are never
 * accepted by parseStableJsonBytes or the versioned contract.
 */
export function stableStringify(value: unknown): string {
  try {
    return canonicalizeStableJson(value);
  } catch (error) {
    if (!(error instanceof DomainValidationError)) throw error;
    return legacyStableStringify(value);
  }
}

function legacyStableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) as string;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => legacyStableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${legacyStableStringify(record[key])}`);
  return `{${parts.join(",")}}`;
}

class JsonParser {
  private index = 0;

  public constructor(private readonly text: string) {}

  public parse(): unknown {
    const value = this.parseValue();
    if (this.index !== this.text.length) fail("trailing bytes or whitespace are forbidden");
    return value;
  }

  private parseValue(): unknown {
    const current = this.text[this.index];
    if (current === '"') return this.parseString();
    if (current === "{") return this.parseObject();
    if (current === "[") return this.parseArray();
    if (this.text.startsWith("true", this.index)) {
      this.index += 4;
      return true;
    }
    if (this.text.startsWith("false", this.index)) {
      this.index += 5;
      return false;
    }
    if (this.text.startsWith("null", this.index)) {
      this.index += 4;
      return null;
    }
    return this.parseNumber();
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (!escaped && code === 0x22) {
        this.index += 1;
        const raw = this.text.slice(start, this.index);
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          fail("invalid JSON string");
        }
        if (typeof value !== "string") fail("invalid JSON string");
        assertValidUnicode(value, "string");
        return value;
      }
      if (!escaped && code < 0x20) fail("unescaped control character in string");
      if (!escaped && code === 0x5c) {
        escaped = true;
      } else {
        escaped = false;
      }
      this.index += 1;
    }
    return fail("unterminated JSON string");
  }

  private parseObject(): Record<string, unknown> {
    this.index += 1;
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (true) {
      if (this.text[this.index] !== '"') fail("object key must be a JSON string");
      const key = this.parseString();
      if (keys.has(key)) fail(`duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      if (this.text[this.index] !== ":") fail("object key must be followed by ':'");
      this.index += 1;
      Object.defineProperty(result, key, {
        value: this.parseValue(),
        enumerable: true,
        configurable: true,
        writable: true
      });
      const separator = this.text[this.index];
      if (separator === "}") {
        this.index += 1;
        return result;
      }
      if (separator !== ",") fail("object entries must be separated by ','");
      this.index += 1;
    }
  }

  private parseArray(): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    if (this.text[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (true) {
      result.push(this.parseValue());
      const separator = this.text[this.index];
      if (separator === "]") {
        this.index += 1;
        return result;
      }
      if (separator !== ",") fail("array entries must be separated by ','");
      this.index += 1;
    }
  }

  private parseNumber(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.text.slice(this.index)
    );
    if (match === null) fail("invalid JSON value");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail("number must be finite");
    return value;
  }
}

/** Parse only canonical UTF-8 for the project contract, failing closed. */
export function parseStableJsonBytes(bytes: Uint8Array): unknown {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail("UTF-8 BOM is forbidden");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("invalid UTF-8");
  }
  const parsed = new JsonParser(text).parse();
  if (canonicalizeStableJson(parsed) !== text) {
    fail("bytes do not match the canonical project serialization");
  }
  return parsed;
}
