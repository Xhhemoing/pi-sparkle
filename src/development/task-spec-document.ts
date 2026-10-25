import { isAlias, isPair, isScalar, parseAllDocuments, visit } from "yaml";
import { DomainValidationError } from "../domain/errors.js";
import { parseDevelopmentTaskSpec, snapshotDevelopmentTaskSpec, type DevelopmentTaskSpec } from "./task-spec.js";

function fail(message: string): never { throw new DomainValidationError("development TaskSpec document: " + message); }

/** Decode a host-reviewed text document; the ordinary-data TaskSpec parser remains authoritative. */
export function parseDevelopmentTaskDocument(text: string, format: "json" | "yaml" = "json"): DevelopmentTaskSpec {
  if (format === "json") return parseDevelopmentTaskSpec(text);
  if (format !== "yaml") fail("format must be json or yaml");
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > 64 * 1024) fail("YAML text must be at most 64 KiB UTF8");
  let value: unknown;
  try {
    // parseDocument with silent logging can ignore trailing documents. Inspect
    // the complete stream explicitly instead of accepting its first document.
    const documents = parseAllDocuments(text, { schema: "core", version: "1.2", uniqueKeys: true, merge: false,
      resolveKnownTags: false, customTags: [], prettyErrors: false, logLevel: "silent" });
    if (documents.length !== 1) fail("expected exactly one YAML document");
    const document = documents[0]!;
    if (document.errors.length > 0 || document.warnings.length > 0 || document.directives?.yaml.version !== "1.2") {
      fail("invalid or unsupported YAML 1.2 document");
    }
    visit(document, (_key, node, ancestors) => {
      if (ancestors.length > 32) fail("YAML nesting is too deep");
      if (isAlias(node)) fail("YAML aliases are unsupported");
      if (isPair(node) && (!isScalar(node.key) || typeof node.key.value !== "string" || node.key.value === "<<")) {
        fail("YAML mappings require string keys without merges");
      }
      if (isScalar(node) && typeof node.value === "number" && !Number.isFinite(node.value)) fail("YAML numbers must be finite");
    });
    value = document.toJS({ maxAliasCount: 0 }) as unknown;
  } catch (error) {
    if (error instanceof DomainValidationError) throw error;
    // Parser diagnostics may contain private source text or custom tag values.
    fail("invalid YAML document");
  }
  try { return snapshotDevelopmentTaskSpec(value); }
  catch { return fail("YAML fields do not satisfy the TaskSpec schema"); }
}
