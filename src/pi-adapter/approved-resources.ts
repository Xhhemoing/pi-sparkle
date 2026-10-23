import { isPromise } from "node:util/types";

/** Explicit host-approved text only; paths are labels, never filesystem authority. */
export interface ApprovedResources {
  readonly contextFiles?: readonly { readonly path: string; readonly text: string }[];
  readonly skills?: readonly { readonly name: string; readonly description: string; readonly body: string }[];
}
export type ApprovedResourcesProvider = (input: { readonly cwd: string }) => ApprovedResources | undefined;
export const APPROVED_RESOURCE_MAX_BYTES = 64 * 1024;
export const APPROVED_RESOURCE_MAX_ENTRIES = 32;

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${label} must be a synchronous plain object`);
  }
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label} has unsupported field ${key}`);
  return value as Record<string, unknown>;
}
function list(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function text(value: unknown, label: string, nonempty = false): string {
  if (typeof value !== "string" || (nonempty && !value.trim())) throw new Error(`${label} must be ${nonempty ? "a nonempty" : "an explicit"} string`);
  return value;
}

/** Validate before SDK hooks run: SDK extension-handler exceptions are swallowed. */
export function prepareApprovedResources(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (isPromise(value)) {
    // Refuse async selection, but consume its rejection so configuration errors
    // cannot escape as unhandled host-process failures. Never await its result.
    void Promise.prototype.then.call(value, undefined, () => undefined);
    throw new Error("approved resources must be a synchronous plain object");
  }
  const input = record(value, ["contextFiles", "skills"], "approved resources");
  const files = list(input.contextFiles, "approved contextFiles"), skills = list(input.skills, "approved skills");
  if (files.length + skills.length > APPROVED_RESOURCE_MAX_ENTRIES) throw new Error(`approved resources exceed ${APPROVED_RESOURCE_MAX_ENTRIES} entries`);
  if (files.length + skills.length === 0) return undefined;
  // Copy each string value now; no host arrays or objects enter a worker/retry.
  const contextFiles = Array.from(files, (entry) => {
    const file = record(entry, ["path", "text"], "approved context file");
    return { path: text(file.path, "context path", true), text: text(file.text, "context text") };
  });
  const approvedSkills = Array.from(skills, (entry) => {
    const skill = record(entry, ["name", "description", "body"], "approved skill");
    return { name: text(skill.name, "skill name", true), description: text(skill.description, "skill description"), body: text(skill.body, "skill body") };
  });
  const strings = [...contextFiles.flatMap((file) => [file.path, file.text]),
    ...approvedSkills.flatMap((skill) => [skill.name, skill.description, skill.body])];
  if (strings.reduce((sum, part) => sum + Buffer.byteLength(part, "utf8"), 0) > APPROVED_RESOURCE_MAX_BYTES) {
    throw new Error(`approved resource payload exceeds ${APPROVED_RESOURCE_MAX_BYTES} UTF8 bytes`);
  }
  const payload = JSON.stringify({ contextFiles, skills: approvedSkills });
  assertApprovedResourcePayload(payload);
  return payload;
}

/** Internal string handoff remains bounded even for direct executor callers. */
export function assertApprovedResourcePayload(payload: string | undefined): void {
  if (payload !== undefined && (typeof payload !== "string" || Buffer.byteLength(payload, "utf8") > APPROVED_RESOURCE_MAX_BYTES)) {
    throw new Error(`approved resource payload must be text within ${APPROVED_RESOURCE_MAX_BYTES} UTF8 bytes`);
  }
}
