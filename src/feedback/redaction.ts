import type { FeedbackRecord } from "./types.js";

export type RedactionClass = "secret" | "pii" | "path" | "prompt-injection" | "oversized";

export interface RedactionPolicy {
  readonly redactPII: boolean;
  readonly maxBodyChars?: number | undefined;
  readonly forbiddenSubstrings?: readonly string[] | undefined;
}

export interface RedactionDecision {
  readonly redacted: boolean;
  readonly classes: readonly RedactionClass[];
  readonly droppedFields: readonly string[];
  readonly referenceOnly: boolean;
}

const CLASS_ORDER: readonly RedactionClass[] = [
  "secret",
  "pii",
  "path",
  "prompt-injection",
  "oversized"
];

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

  if (policy.redactPII) {
    classes.add("pii");
  }

  const redacted = classes.size > 0;
  if (!redacted) {
    return {
      feedback,
      decision: { redacted: false, classes: [], droppedFields: [], referenceOnly: false }
    };
  }

  return {
    feedback: copyFeedback(feedback, {
      redacted: true,
      ...(body !== undefined ? { body } : { omitBody: true }),
      ...(summary !== undefined ? { summary } : {})
    }),
    decision: {
      redacted: true,
      classes: CLASS_ORDER.filter((entry) => classes.has(entry)),
      droppedFields,
      referenceOnly
    }
  };
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
    createdAt: feedback.createdAt,
    ...(feedback.runId !== undefined ? { runId: feedback.runId } : {}),
    ...(feedback.taskId !== undefined ? { taskId: feedback.taskId } : {}),
    ...(nextBody !== undefined ? { body: nextBody } : {}),
    ...(nextSummary !== undefined ? { summary: nextSummary } : {})
  };
}
