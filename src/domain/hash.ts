/**
 * Fast non-cryptographic 32-bit string hash (FNV-1a style). Used for
 * deterministic artifact fingerprints and signature hashing only — NOT for
 * security-sensitive digests or integrity guarantees.
 *
 * Centralized here so every caller shares one implementation instead of
 * duplicating the same loop (previously copied in evaluation, learning,
 * experiments, and routing).
 */
export function hash32(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(16);
}
