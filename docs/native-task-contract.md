# Native read-only task contracts

Status: B1 implementation on the report-improvement branch; independent review remains separate. This is an optional input/requirements slice, not the S0-min host outcome or B2 completion-receipt feature.

## Usage

Existing `sparkle_delegate` calls with only `role` and `objective` are unchanged. Each of the existing 1-4 scout/reviewer tasks may additionally carry a bounded `contract`:

```json
{
  "tasks": [{
    "role": "scout",
    "objective": "Inspect the login timeout without modifying files",
    "contract": {
      "scope": ["src/auth/login.ts", "related authentication tests"],
      "prohibitions": ["Do not modify files or execute shell commands"],
      "deliverables": ["Report the observed timeout branch, evidence and uncertainties"],
      "acceptanceCriteria": [{
        "id": "timeout-evidence",
        "description": "Identify the timeout branch and related coverage",
        "observableCheck": "Cite source paths and distinguish observations from unverified conclusions"
      }],
      "sourceRefs": [{ "kind": "message", "ref": "current-task" }]
    }
  }]
}
```

Each array permits at most 8 items. Text fields permit 1-512 characters; criterion identifiers permit 1-64 ASCII letters, digits, underscores or hyphens and must be unique within the task. Source kinds reuse `message`, `file`, `git`, `spec`; an optional excerpt is bounded to 512 characters. Unknown fields, empty items, NUL, malformed nested objects and duplicate criterion ids are rejected. The objective plus the normalized contract must fit the existing 8000-character task limit. Overflow is refused, never silently truncated. All contracts are validated before a run is created, so one invalid sibling starts no partial delegation.

## Data flow and result

The adapter copies each input synchronously into the existing `RequirementContract` shape, with report deliverables, a fixed read-only profile constraint and an empty `authority` array. That task's normalized requirements are included in its existing persisted objective/request; observable checks also enter the existing child `acceptanceCriteria` array. There is no second store or new event type. Sibling scopes are not merged into a parent-wide contract.

A result includes optional `taskContracts`, each binding the snapshot to the actual child `taskId`. The text summary gives report/criterion counts. This is an input contract summary, not a verdict, progress percentage or evidence of satisfying a criterion. Calls without a contract do not acquire the new result field.

Source references supplied by a caller remain provenance claims. They are not authenticated approval and never grant authority. When no references are supplied, `native-task-N` identifies the input position; generated report/profile defaults carry an explicit assumption. Memory and repository text do not gain trust by being put in a contract.

## Boundaries

- The existing native executor remains read-only; no additional write or shell tool is exposed. Arbitrary scope/prohibition text is an instruction constraint (`enforceable: false`), not a new filesystem read allowlist or OS sandbox. The host executor and its existing tool policy remain responsible for execution permissions.
- `independentVerification` stays `UNOBSERVED`, including when a child reports success. An `observableCheck` is descriptive text; it is never parsed or executed as a shell command, and is not a trusted host verifier.
- The existing parent coverage gate is not newly wired by this slice. Native structured input, parent-wide coverage, host acceptance and candidate application are distinct capabilities.
- No live provider call, production apply, online adaptive selection, automatic promotion, credential change or state migration is introduced. Real-task quality/cost benefit remains unmeasured.

See [the staged plan](superpowers/plans/2026-09-27-report-continuation.md) and [verification record](reports/2026-09-27-report-continuation.md).
