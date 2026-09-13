import type { ObservationRef, ObservationStore } from "./observation-store.js";

/** Eligibility floor: UTF-8 byte length must exceed this. */
export const OBSERVATION_ELIGIBILITY_MIN_BYTES = 10_240;
/** Placeholder payload must fit in this many UTF-8 bytes. */
export const OBSERVATION_PLACEHOLDER_MAX_BYTES = 2_048;
/**
 * Marker mirrored from SoL-Pi evidence receipts (`sol_pi_evidence_receipt_v1`)
 * without importing NVIDIA packages. Presence in text forces ineligibility.
 */
export const EVIDENCE_RECEIPT_MARKER = "sol_pi_evidence_receipt_v1";

export interface ObservationInput {
  readonly id: string;
  readonly toolName: string;
  readonly text: string;
  readonly isError: boolean;
  readonly pureText: boolean;
  readonly evidenceReceipt: boolean;
}

export interface ProjectionResult {
  readonly text: string;
  readonly packed: boolean;
  readonly ref?: ObservationRef;
  readonly reason: "disabled" | "ineligible" | "first-two" | "packed" | "storage-unavailable";
}

export interface ProjectObservationOptions {
  readonly enabled: boolean;
  readonly priorFullSends: number;
  readonly store: ObservationStore;
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function looksLikeEvidenceReceipt(input: ObservationInput): boolean {
  if (input.evidenceReceipt) return true;
  return input.text.includes(EVIDENCE_RECEIPT_MARKER);
}

function isEligible(input: ObservationInput): boolean {
  if (!input.pureText) return false;
  if (input.isError) return false;
  if (looksLikeEvidenceReceipt(input)) return false;
  return utf8Bytes(input.text) > OBSERVATION_ELIGIBILITY_MIN_BYTES;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) n += 1;
  }
  // Trailing newline does not add an extra empty line for the count we surface.
  if (text.endsWith("\n")) n -= 1;
  return Math.max(n, text.length === 0 ? 0 : 1);
}

function excerptHead(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function excerptTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

/**
 * Build a placeholder ≤2048 UTF-8 bytes with id/hash/byteLength/lines and
 * head/tail excerpts. No hidden chain-of-thought.
 */
export function buildObservationPlaceholder(
  input: ObservationInput,
  ref: ObservationRef
): string {
  const lines = countLines(input.text);
  const header =
    `[observation packed]\n` +
    `id: ${ref.id}\n` +
    `sha256: ${ref.sha256}\n` +
    `byteLength: ${ref.byteLength}\n` +
    `lines: ${lines}\n` +
    `toolName: ${input.toolName}\n` +
    `sourceId: ${input.id}\n`;

  // Budget the remainder for head/tail; shrink until the whole UTF-8 payload fits.
  let headBudget = 700;
  let tailBudget = 700;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const body =
      `head:\n${excerptHead(input.text, headBudget)}\n` +
      `tail:\n${excerptTail(input.text, tailBudget)}\n`;
    const candidate = header + body;
    if (utf8Bytes(candidate) <= OBSERVATION_PLACEHOLDER_MAX_BYTES) return candidate;
    headBudget = Math.max(80, Math.floor(headBudget * 0.7));
    tailBudget = Math.max(80, Math.floor(tailBudget * 0.7));
  }
  // Last resort: header only (still identifies the archived object).
  const minimal =
    header +
    `head:\n(truncated)\n` +
    `tail:\n(truncated)\n`;
  if (utf8Bytes(minimal) <= OBSERVATION_PLACEHOLDER_MAX_BYTES) return minimal;
  return `[observation packed]\nid: ${ref.id}\nsha256: ${ref.sha256}\nbyteLength: ${ref.byteLength}\n`;
}

/**
 * Offline projection: optionally archive an observation and replace later
 * full repeats with a compact placeholder. Pure store + pure projection —
 * no live Pi executor integration.
 *
 * Algorithm sketch inspired by SoL-Pi ObservationPack eligibility /
 * priorFullSends gating; reimplemented natively (MIT) without NVIDIA SPDX.
 */
export async function projectObservation(
  input: ObservationInput,
  options: ProjectObservationOptions
): Promise<ProjectionResult> {
  if (!options.enabled) {
    return { text: input.text, packed: false, reason: "disabled" };
  }
  if (!isEligible(input)) {
    return { text: input.text, packed: false, reason: "ineligible" };
  }

  const prior = options.priorFullSends;
  if (!Number.isSafeInteger(prior) || prior < 0) {
    // Invalid counter → fail closed: do not pack, do not invent evidence.
    return { text: input.text, packed: false, reason: "ineligible" };
  }

  let ref: ObservationRef;
  try {
    ref = await options.store.put(input.text);
  } catch {
    return { text: input.text, packed: false, reason: "storage-unavailable" };
  }

  if (prior <= 1) {
    return { text: input.text, packed: false, ref, reason: "first-two" };
  }

  const placeholder = buildObservationPlaceholder(input, ref);
  return { text: placeholder, packed: true, ref, reason: "packed" };
}
