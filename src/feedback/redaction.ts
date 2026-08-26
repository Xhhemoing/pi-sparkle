import { REDACTION_CLASSES, type FeedbackRecord, type RedactionClass } from "./types.js";

export type { RedactionClass };

export interface RedactionPolicy {
  readonly redactPII: boolean;
  readonly maxBodyChars?: number | undefined;
  readonly forbiddenSubstrings?: readonly string[] | undefined;
}

export interface RedactionDecision {
  readonly redacted: boolean;
  /**
   * What *this* pass matched, canonically ordered. The returned record carries
   * the same classes in `redactionClasses` (unioned with any an earlier pass
   * already recorded), which is what `appendFeedback` persists.
   */
  readonly classes: readonly RedactionClass[];
  readonly droppedFields: readonly string[];
  readonly referenceOnly: boolean;
}

/** Stable placeholders: the value is gone but the shape stays reviewable. */
export const REDACTION_PLACEHOLDER = {
  secret: "[secret]",
  path: "[path]",
  email: "[email]",
  ipv4: "[ipv4]",
  ipv6: "[ipv6]",
  phone: "[phone]",
  card: "[card]",
  ssn: "[ssn]",
  nationalId: "[id-card]"
} as const;

export interface TextRedaction {
  readonly text: string;
  readonly classes: readonly RedactionClass[];
}

interface TextRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

const PLACEHOLDER_ALTERNATION = `\\[(?:${Object.values(REDACTION_PLACEHOLDER)
  .map((value) => value.slice(1, -1))
  .join("|")})\\]`;

const KEYED_SECRET_NAMES =
  "api[_-]?key|apikey|access[_-]?key(?:[_-]?id)?|secret(?:[_-]?access)?(?:[_-]?key)?|access[_-]?token|auth[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|private[_-]?key|token|password|passwd|pwd|passphrase";
// Real config keys are namespaced: `aws_secret_access_key`, `my_api_key`,
// `SPARKLE_CLIENT_SECRET`. A bare `\b` in front of the name class refuses all
// of them, because `_` is a word character and there is no boundary inside
// `aws_secret`. Each prefix segment is alphanumerics followed by a separator
// that the segment class excludes, so a run has exactly one way to split and
// the bounded repetition cannot backtrack combinatorially.
const KEYED_SECRET_PREFIX = "(?:[A-Za-z0-9]{1,32}[_-]){0,6}";
const KEYED_SECRET_LABEL = `\\b${KEYED_SECRET_PREFIX}(?:${KEYED_SECRET_NAMES})\\b`;

const SECRET_RULES: readonly TextRule[] = [
  // PEM blocks: the base64 body goes with the header, terminated or not.
  {
    pattern: /-{0,5}BEGIN [A-Z0-9 ]*PRIVATE KEY-{0,5}[\s\S]*?(?:-{0,5}END [A-Z0-9 ]*PRIVATE KEY-{0,5}|$)/g,
    replacement: REDACTION_PLACEHOLDER.secret
  },
  // Authorization headers keep the scheme so the shape stays readable.
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: `Bearer ${REDACTION_PLACEHOLDER.secret}`
  },
  // Vendor-prefixed keys. `sk-` covers `sk-proj-`/`sk-ant-`/`sk-or-v1-` because
  // the tail class consumes the sub-prefix as well.
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}/g, replacement: REDACTION_PLACEHOLDER.secret },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replacement: REDACTION_PLACEHOLDER.secret },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/g, replacement: REDACTION_PLACEHOLDER.secret },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: REDACTION_PLACEHOLDER.secret },
  { pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, replacement: REDACTION_PLACEHOLDER.secret },
  { pattern: /\bAIza[0-9A-Za-z_-]{20,}/g, replacement: REDACTION_PLACEHOLDER.secret },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replacement: REDACTION_PLACEHOLDER.secret
  },
  // URL userinfo (`https://user:password@host` / `http://token@host`). Bounded
  // classes keep the engine from backtracking; requiring `://` keeps ordinary
  // `user@domain` emails out of this rule.
  {
    pattern: /(https?:\/\/)(?:[^\s/@:]{1,128}:)?[^\s/@:]{1,256}@/gi,
    replacement: `$1${REDACTION_PLACEHOLDER.secret}@`
  },
  // `api_key: "value"` / `token='value'` — the quotes survive, the value does not.
  {
    pattern: new RegExp(`(${KEYED_SECRET_LABEL}"?'?\\s*[:=]\\s*)(["'])[^"'\\n]+\\2`, "gi"),
    replacement: `$1$2${REDACTION_PLACEHOLDER.secret}$2`
  },
  // `api_key=value` / `token: value` — unquoted run up to the next delimiter.
  // The lookahead keeps the pass idempotent: a value an earlier rule already
  // turned into a placeholder must not be re-wrapped.
  {
    pattern: new RegExp(
      `(${KEYED_SECRET_LABEL}"?'?\\s*[:=]\\s*)(?!${PLACEHOLDER_ALTERNATION})([^\\s"',;)}\\]]{4,})`,
      "gi"
    ),
    replacement: `$1${REDACTION_PLACEHOLDER.secret}`
  }
];

// `/` is excluded from the segment class so `(?:/segment)+` has exactly one way
// to split a path: overlapping alternatives are what make these patterns
// backtrack badly on hostile input.
const POSIX_SEGMENT = "[^\\s\"'`,;:*?<>|/]+";
const POSIX_SEGMENT_BOUNDED = "[^\\s\"'`,;:*?<>|/]{0,64}";
// A space only continues a path when the word after it is itself followed by
// another `/` segment ("Application Support/pi"), so ordinary prose after a
// path ("/home/x/y and then ...") is not swallowed.
const POSIX_SPACED_TAIL = `(?: +[^\\s"'\`,;:*?<>|/]+(?:/${POSIX_SEGMENT})+)*`;

const PATH_RULES: readonly TextRule[] = [
  // Home directories on unix-likes, including `~`-relative and spaced paths.
  {
    pattern: new RegExp(
      `(?:~|/home|/Users|/root)(?:/${POSIX_SEGMENT})+${POSIX_SPACED_TAIL}`,
      "g"
    ),
    replacement: REDACTION_PLACEHOLDER.path
  },
  // Any `.ssh` directory, wherever it lives. The leading segments are bounded
  // rather than open-ended: an unbounded prefix in front of a literal makes the
  // engine rescan the whole run from every position of a long slash-heavy body,
  // and no real `.ssh` path is 12 segments deep with 64-character names.
  {
    pattern: new RegExp(
      `(?:/${POSIX_SEGMENT_BOUNDED}){0,12}/\\.ssh(?:/${POSIX_SEGMENT_BOUNDED}){0,12}`,
      "g"
    ),
    replacement: REDACTION_PLACEHOLDER.path
  },
  // Windows UNC shares (`\\server\share\...`) before the drive-letter rule, so
  // a UNC path that happens to contain `Users\` is consumed whole.
  {
    pattern: /\\\\[A-Za-z0-9_.$-]+(?:\\[^\s\\/:*?"<>|]+)+/g,
    replacement: REDACTION_PLACEHOLDER.path
  },
  // Windows user profiles, with or without the drive letter.
  {
    pattern: /(?:[A-Za-z]:)?\\?\bUsers\\[^\s\\/:*?"<>|]+(?:\\[^\s\\/:*?"<>|]+)*/g,
    replacement: REDACTION_PLACEHOLDER.path
  }
];

// Two deliberate shapes here, both about backtracking rather than matching:
// the leading lookbehind stops every interior position of a long local-part-
// shaped run from restarting the scan, and the TLD is validated in code because
// spelling it as `(?:\.label)*\.[A-Za-z]{2,}` makes the last label ambiguous
// with the repeated group ("aaaa...@b.b.b.b." then costs O(n^2)).
const EMAIL = /(?<![A-Za-z0-9._%+_-])[A-Za-z0-9._%+_-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const EMAIL_TLD = /\.[A-Za-z]{2,}$/;
const IPV4 =
  /(?<![\w.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?![\w.])/g;
const IPV4_OCTETS = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
// IPv6 is matched as a flat candidate run and validated in code. Spelling the
// grammar out — eight groups, one optional `::` elision that may stand
// anywhere, an optional trailing dotted quad — needs overlapping alternatives,
// and overlapping alternatives are precisely what backtracks badly on hostile
// input. A single character class cannot. 45 is the longest legal form
// (`0000:…:255.255.255.255`); the dot is in the class so an embedded IPv4 is
// consumed with the address rather than left behind by it.
const IPV6_CANDIDATE = /(?<![\w:.])[0-9A-Fa-f:.]{2,45}(?![\w:.])/g;
const IPV6_GROUP = /^[0-9A-Fa-f]{1,4}$/;
// US SSN in both shapes. The bare nine-digit form is fenced by word bounds so
// it cannot bite the inside of a longer identifier — a card number, an epoch
// timestamp — which the card and phone rules classify far more precisely.
const SSN_DASHED = /(?<![\w-])\d{3}-\d{2}-\d{4}(?![\w-])/g;
const SSN_BARE = /(?<![\w-])\d{9}(?![\w-])/g;
// CN 身份证 (resident identity card), 18-character form: six-digit division
// code, birth date, three-digit sequence, and a check character that is a
// digit or `X`. The date is validated inside the pattern with fixed-width
// alternatives, which keeps ordinary 18-digit identifiers out of the class
// without a second validation pass.
const CN_NATIONAL_ID =
  /(?<![\w-])\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx](?![\w-])/g;
const PHONE_E164 = /(?<![\w+])\+\d[\d ().-]{6,17}\d(?!\w)/g;
const PHONE_CN_MOBILE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const CARD_CANDIDATE = /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g;
// Leading digits of the major issuer ranges. Excluding 0/1/7/8/9 keeps epoch
// milliseconds and similar 13-digit identifiers out of the card class.
const CARD_IIN = /^(?:4|5[1-5]|2[2-7]|3[04-9]|6[2456])/;

/**
 * prompt-injection is deliberately NOT detected here.
 *
 * Every cheap signature we tried ("ignore previous instructions", "system:",
 * "you are now") fires on ordinary review feedback about prompts — this repo's
 * own prompt/skill discussions would be mangled — and a redactor that eats
 * legitimate review text is worse than one that lets an injection string
 * through, because the injection is never executed from a feedback body: it is
 * stored data, and callers treat it as untrusted content. If that changes
 * (feedback bodies fed back into a model prompt), detection belongs at the
 * point of prompt assembly, not here. `RedactionClass` keeps the member so the
 * decision shape does not have to change when that day comes; today no rule
 * emits it, and a unit test pins that behaviour.
 */

/**
 * Remove secret/path/PII values from free text, replacing each with a stable
 * placeholder. Returns the classes that actually matched, so a caller can tell
 * "scanned and clean" from "scanned and stripped".
 */
export function redactSensitiveText(text: string): TextRedaction {
  const classes: RedactionClass[] = [];
  let out = text;

  const afterSecret = applyRules(out, SECRET_RULES);
  if (afterSecret !== out) classes.push("secret");
  out = afterSecret;

  const afterPath = applyRules(out, PATH_RULES);
  if (afterPath !== out) classes.push("path");
  out = afterPath;

  const afterPii = redactPersonalData(out);
  if (afterPii !== out) classes.push("pii");
  out = afterPii;

  return { text: out, classes };
}

function redactPersonalData(text: string): string {
  let out = text.replace(EMAIL, (match) =>
    EMAIL_TLD.test(match) ? REDACTION_PLACEHOLDER.email : match
  );
  // Before the card and IPv4 rules: the candidate class covers both of their
  // shapes, and a run that is not a valid address is handed straight back to
  // them.
  out = out.replace(IPV6_CANDIDATE, (match) =>
    looksLikeIpv6(match) ? REDACTION_PLACEHOLDER.ipv6 : match
  );
  // Before the card rule: an 18-character ID is long enough for the card
  // candidate to bite a Luhn-valid prefix out of it and leave the check
  // character stranded on its own.
  out = out.replace(CN_NATIONAL_ID, REDACTION_PLACEHOLDER.nationalId);
  out = out.replace(CARD_CANDIDATE, (match) =>
    looksLikeCard(match) ? REDACTION_PLACEHOLDER.card : match
  );
  out = out.replace(SSN_DASHED, REDACTION_PLACEHOLDER.ssn);
  out = out.replace(SSN_BARE, REDACTION_PLACEHOLDER.ssn);
  out = out.replace(IPV4, REDACTION_PLACEHOLDER.ipv4);
  out = out.replace(PHONE_E164, REDACTION_PLACEHOLDER.phone);
  out = out.replace(PHONE_CN_MOBILE, REDACTION_PLACEHOLDER.phone);
  return out;
}

/**
 * RFC 4291 presentation form: at most one `::`, groups of one to four hex
 * digits, and a dotted quad allowed only as the final (double-width) group.
 * A bare `::` is deliberately rejected — the unspecified address carries no
 * information, and `::` alone shows up in ordinary text.
 */
function looksLikeIpv6(candidate: string): boolean {
  const halves = candidate.split("::");
  if (halves.length > 2) return false;
  const compressed = halves.length === 2;
  const parts = halves.flatMap((half) => (half === "" ? [] : half.split(":")));

  let groups = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] as string;
    if (part.includes(".")) {
      // Only the last group may be a dotted quad, and it stands for two groups.
      if (index !== parts.length - 1 || !IPV4_OCTETS.test(part)) return false;
      groups += 2;
      continue;
    }
    if (!IPV6_GROUP.test(part)) return false;
    groups += 1;
  }
  return compressed ? groups >= 1 && groups <= 7 : groups === 8;
}

function looksLikeCard(candidate: string): boolean {
  const digits = candidate.replace(/[^\d]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  if (!CARD_IIN.test(digits)) return false;
  return luhnValid(digits);
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const digit = digits.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return false;
    const value = double ? digit * 2 : digit;
    sum += value > 9 ? value - 9 : value;
    double = !double;
  }
  return sum % 10 === 0;
}

function applyRules(text: string, rules: readonly TextRule[]): string {
  let out = text;
  for (const rule of rules) {
    out = out.replace(rule.pattern, rule.replacement);
  }
  return out;
}

export function applyRedaction(feedback: FeedbackRecord, policy: RedactionPolicy): FeedbackRecord {
  return redactFeedback(feedback, policy).feedback;
}

export function redactFeedback(
  feedback: FeedbackRecord,
  policy: RedactionPolicy
): { feedback: FeedbackRecord; decision: RedactionDecision } {
  const classes = new Set<RedactionClass>();
  const droppedFields: string[] = [];
  let body = feedback.body;
  let summary = feedback.summary;
  let referenceOnly = false;

  // Value-removing transforms run BEFORE the forbidden-substring strip: the
  // strip deletes markers like `sk-` in place, and a detector that has lost its
  // prefix can no longer recognise the key body that follows it.
  if (policy.redactPII) {
    // Enabling the policy always marks the record: `pii` means "the PII pass
    // ran over this record", while `secret`/`path` are added only on a match.
    classes.add("pii");
    if (body !== undefined) {
      const scanned = redactSensitiveText(body);
      body = scanned.text;
      for (const cls of scanned.classes) classes.add(cls);
    }
    if (summary !== undefined) {
      const scanned = redactSensitiveText(summary);
      summary = scanned.text;
      for (const cls of scanned.classes) classes.add(cls);
    }
  }

  const needles = [...(policy.forbiddenSubstrings ?? [])]
    .filter((needle) => needle.length > 0)
    .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));

  if (needles.length > 0) {
    const strippedBody = body !== undefined ? stripForbidden(body, needles) : undefined;
    const strippedSummary = summary !== undefined ? stripForbidden(summary, needles) : undefined;
    if (strippedBody !== body || strippedSummary !== summary) {
      classes.add("secret");
      body = strippedBody;
      summary = strippedSummary;
    }
  }

  if (policy.maxBodyChars !== undefined && body !== undefined && body.length > policy.maxBodyChars) {
    classes.add("oversized");
    droppedFields.push("body");
    body = undefined;
    referenceOnly = true;
  }

  const redacted = classes.size > 0;
  if (!redacted) {
    // Nothing to record: the input is returned untouched, including whatever
    // classes an earlier pass already stamped on it.
    return {
      feedback,
      decision: { redacted: false, classes: [], droppedFields: [], referenceOnly: false }
    };
  }

  const passClasses = REDACTION_CLASSES.filter((entry) => classes.has(entry));
  return {
    feedback: copyFeedback(feedback, {
      redacted: true,
      redactionClasses: mergeRedactionClasses(
        feedback.redactionClasses,
        passClasses,
        body !== undefined
      ),
      ...(body !== undefined ? { body } : { omitBody: true }),
      ...(summary !== undefined ? { summary } : {})
    }),
    decision: {
      redacted: true,
      classes: passClasses,
      droppedFields,
      referenceOnly
    }
  };
}

/**
 * `decision.classes` reports this pass; the class list stamped on the record
 * describes the record as it now stands, so re-redacting a stored record keeps
 * the provenance of the pass that first stripped it.
 *
 * The one subtraction: `oversized` asserts that the body was dropped. A record
 * that still has a body must not claim it, because readers treat the class as
 * authority to refuse a body (see `src/feedback/store.ts`).
 */
function mergeRedactionClasses(
  prior: readonly RedactionClass[] | undefined,
  pass: readonly RedactionClass[],
  hasBody: boolean
): readonly RedactionClass[] {
  const merged = new Set<RedactionClass>([...(prior ?? []), ...pass]);
  if (hasBody) merged.delete("oversized");
  return REDACTION_CLASSES.filter((entry) => merged.has(entry));
}

function stripForbidden(text: string, needles: readonly string[]): string {
  let out = text;
  for (const needle of needles) {
    out = out.split(needle).join("");
  }
  return out;
}

function copyFeedback(
  feedback: FeedbackRecord,
  patch: {
    redacted: boolean;
    redactionClasses: readonly RedactionClass[];
    body?: string | undefined;
    summary?: string | undefined;
    omitBody?: boolean | undefined;
  }
): FeedbackRecord {
  const nextBody = patch.omitBody === true ? undefined : (patch.body !== undefined ? patch.body : feedback.body);
  const nextSummary = patch.summary !== undefined ? patch.summary : feedback.summary;
  return {
    id: feedback.id,
    episodeId: feedback.episodeId,
    kind: feedback.kind,
    rubricVersion: feedback.rubricVersion,
    score: feedback.score,
    evidenceRefs: feedback.evidenceRefs,
    redacted: patch.redacted,
    redactionClasses: patch.redactionClasses,
    createdAt: feedback.createdAt,
    ...(feedback.runId !== undefined ? { runId: feedback.runId } : {}),
    ...(feedback.taskId !== undefined ? { taskId: feedback.taskId } : {}),
    ...(nextBody !== undefined ? { body: nextBody } : {}),
    ...(nextSummary !== undefined ? { summary: nextSummary } : {})
  };
}
