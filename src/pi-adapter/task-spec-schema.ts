import { Type } from "@earendil-works/pi-ai";

const text = (maximum: number) => Type.String({ maxLength: maximum, pattern: "^(?!\\s*$)[^\\u0000]*$" });
const identifier = Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]*$" });
const argument = Type.String({ maxLength: 2048, pattern: "^[^\\u0000]*$" });
const argumentsSchema = Type.Array(argument, { maxItems: 64 });

// Literal compatibility deliberately remains different from the strict pattern
// branch. Do not silently apply the newer selector grammar to context/recipes.
const literalPart = String.raw`(?!\.{1,2}(?:/|$))[^\u0000:\\*?\[\]/]+`;
const literalPath = Type.String({ minLength: 1, maxLength: 256,
  pattern: `^(?!\\s*$)(?!\\.git(?:/|$))${literalPart}(?:/${literalPart})*$`,
  description: "Safe literal relative prefix, matching the parser's existing literal compatibility rules. No glob expansion." });
const selectorPart = String.raw`(?!\.{1,2}(?:/|$))(?!\.[gG][iI][tT](?:/|$))(?:\*\*|(?![^/]*\*\*)[^\u0000-\u001f\u007f\\:\ufffd{}\[\]()/]+)`;
const patternedPath = Type.String({ minLength: 1, maxLength: 256,
  pattern: `^(?=.*[*?])${selectorPart}(?:/${selectorPart}){0,127}$`,
  description: "Case-sensitive slash-separated selector with segment * and ?, or whole-segment **; matching directories include their subtrees." });
const selectedPath = Type.Union([literalPath, patternedPath]);
const literalDependencies = Type.Array(literalPath, { maxItems: 16, uniqueItems: true });
const duration = Type.Number({ minimum: 0.001, maximum: 1800,
  description: "Seconds with whole-millisecond precision, enforced by the strict parser. No floating-point multipleOf constraint is used by this authoring schema." });
const expectation = Type.Union([
  Type.Object({ baseline: Type.Literal("pass") }, { additionalProperties: false }),
  Type.Object({ baseline: Type.Literal("fail"), failureAssertion: text(256) }, { additionalProperties: false })
]);
const check = Type.Object({
  id: identifier,
  command: text(512),
  args: argumentsSchema,
  verifierVersion: text(128),
  protectedPaths: Type.Optional(literalDependencies),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 40000, default: 5000 })),
  maxStdoutBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1048576, default: 2048 })),
  maxStderrBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1048576, default: 2048 })),
  visibleToWorker: Type.Optional(Type.Boolean({ default: true })),
  expect: expectation
}, { additionalProperties: false });

/** Experimental JSON authoring schema, not an execution or verification capability. */
export const developmentTaskSpecSchema = Type.Object({
  version: Type.Literal(1),
  limits: Type.Optional(Type.Object({
    context: Type.Object({ tokenBudget: Type.Integer({ minimum: 1, maximum: 32768 }),
      maxFiles: Type.Integer({ minimum: 1, maximum: 32 }), maxBytes: Type.Integer({ minimum: 1, maximum: 65536 }) }, { additionalProperties: false }),
    snapshot: Type.Object({ maxFiles: Type.Integer({ minimum: 1, maximum: 1024 }),
      maxBytes: Type.Integer({ minimum: 1, maximum: 16777216 }) }, { additionalProperties: false })
  }, { additionalProperties: false })),
  objective: { ...text(4096), description: "Objective text. Explicit [[file:relative/path]] declarations join required context; ordinary path-like prose is unchanged." },
  context: Type.Optional(Type.Array(literalPath, { maxItems: 32, default: [] })),
  write: Type.Object({
    allow: Type.Array(selectedPath, { minItems: 1, maxItems: 32, uniqueItems: true }),
    protect: Type.Array(selectedPath, { maxItems: 128, uniqueItems: true }),
    require: Type.Optional(Type.Array(literalPath, { maxItems: 32, uniqueItems: true, default: [], description: "Explicit required output locations. The parser requires each path within allow and outside protect; files need not exist yet. This grants no additional permission." }))
  }, { additionalProperties: false }),
  prepare: Type.Optional(Type.Array(Type.Object({ id: identifier, command: text(512), args: argumentsSchema,
    nodeOffline: Type.Optional(Type.Object({ nodeVersion: Type.String({ pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$", maxLength: 64 }),
      packageManagerVersion: Type.String({ pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$", maxLength: 64 }),
      storePath: text(4096), readOnlySharedStores: Type.Array(text(4096), { maxItems: 8 }) }, { additionalProperties: false })) },
    { additionalProperties: false }), { maxItems: 8, default: [] })),
  checks: Type.Array(check, { minItems: 1, maxItems: 8 }),
  budget: Type.Object({
    totalSeconds: duration, prepareSeconds: duration, checkSeconds: duration, workerSeconds: duration,
    workerTotalSeconds: Type.Optional(duration), checkTotalSeconds: Type.Optional(duration),
    usd: Type.Optional(Type.Number({ exclusiveMinimum: 0, description: "One positive finite model-reference USD allowance across all repair attempts in this invocation. Incomplete usage stops successors; this is not a provider bill or cross-process resume authority." }))
  }, { additionalProperties: false }),
  worker: Type.Optional(Type.Object({
    model: Type.Literal("inherit"), maxAttempts: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, default: 1 }))
  }, { additionalProperties: false, default: { model: "inherit" } }))
}, {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "pi-sparkle experimental TaskSpec v1 input",
  additionalProperties: false,
  description: "JSON authoring aid only. Defaults are annotations; the parser performs normalization. The strict parser additionally enforces own-data objects/arrays, Proxy/getter/hole refusal, UTF-8 JSON input <=64 KiB, whole-millisecond precision, unique preparation/check ids, combined recipe timeout <=40000 ms and complete structured-output capacity. Runtime checks enforce actual files/context, links, protection coverage and unchanged bytes, source freshness and the named business failure assertion. This schema proves no filesystem access, command safety, resource settlement or execution authority. String bounds follow parser UTF-16 lengths; JSON Schema consumers may count Unicode characters differently. Shell run fields are unsupported."
});
