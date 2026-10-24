# Prompt Tuning

Use this reference when task evidence points to instruction selection,
repetition, or conflict. Prompt length or a failed task alone does not establish
that instructions caused the problem.

## Diagnose before changing

- Identify the user's intended result and the exact instruction or omission
  that could change the agent's next decision.
- Check applicable project instructions and accepted decisions. Distinguish a
  real conflict from rules that apply at different stages: read-only analysis,
  implementation, verification, delivery, and release.
- Check whether a section serves the current project or was copied from another
  context. Reuse existing authoritative rules instead of restating them in
  several places. Keep project state in the project's existing state surfaces.
- Distinguish required rework after a changed candidate or new failure from
  repetition with unchanged inputs and no new question.

## Make a scoped correction

Prefer clarifying applicability, removing stale facts, or consolidating an
actual duplicate over adding another mandatory template or routing layer.
Remove text only after checking which required behavior it preserves; keep
privacy, authorization, safety, and unresolved acceptance obligations intact.
A missing scenario router, A/B system, or dynamic composition mechanism is
not by itself a defect or permission to build one.

Prompt edits require task authorization. Keep changes reviewable in the
existing version-control workflow. A live run must not rewrite active prompts
or routing policy as an inferred learning step, automatically promote a
candidate, or bypass an existing project freeze or owner decision.

## Check the result and stop

For an authorized text change, inspect the diff for preserved intent and
boundaries, check affected references, and use applicable existing validation.
Do not create tests that merely pin wording. Report static validation as such.

Claim an operational benefit only with relevant observed task evidence and
its limits. A single successful run or in-loop self-review is insufficient;
a comparison requires separate scope and authorization, including opt-in
provider or benchmark work. If the cause remains uncertain, record what
observation would distinguish it and stop the unsupported correction.
