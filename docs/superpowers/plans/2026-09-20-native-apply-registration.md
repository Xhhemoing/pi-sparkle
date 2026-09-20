# Task Plan: NativeApplySession host-facing registration (policy + thin tool)

## Identity

- ID: `TASK-20260920-native-apply-registration`
- Owner: main agent session (implementation); owner authorization required at gate G3
- State: `planned`
- Date opened: 2026-09-20
- Related: [ADR-006 Accepted](../../decisions/0006-pi-extension-reverse-adapter.md) (2026-09-18 amendment); [native Pi plan](2026-09-18-native-pi.md); [apply plan](2026-09-19-native-apply.md); [apply report](../../reports/2026-09-19-native-apply.md); PR #45 merged `abbf4461` closes the drift-rollback follow-up; [status matrix](../../status-matrix.md) native rows.

## Problem and Scope

### Problem

`NativeApplySession` is a verified library API (focused 34/34 after PR #45, full suite green, luna-fast independent review PASS) but is not reachable from a Pi session. The apply report's handoff requires three prerequisites before any host-facing registration: command-policy/environment boundary review, a disposal policy for retained candidates, and explicit human authorization. Without this slice the apply path remains dead code for hosts and the native line stalls at "library only".

### In scope

1. **Command-policy boundary** (documented, test-pinned): the only host-reachable verification command is the one snapshotted into the acceptance record at write time by `NativeWriteSession` (trusted host input). The registration must NOT accept `command`/`args` from model-controlled tool parameters; re-verification runs the frozen argv inside the candidate, exactly as `applyNativeCandidate` already enforces.
2. **Disposal policy** (documented decision, enforced in code): after a successful apply the candidate is retained (evidence) and disposal stays caller-invoked; the tool exposes disposal ONLY for candidate paths returned by the same session in this host session (session-scoped ownership), reusing `disposeNativeCandidate`'s managed-path check. Unmanaged/foreign paths are refused. Retention of run artifacts remains governed by the existing 90-day `retain` policy — no new retention class.
3. **Thin registration tool** `sparkle_apply_candidate` in `extensions/pi-sparkle/index.ts` (the same single-file adapter surface as `sparkle_delegate`), delegating to `NativeApplySession`:
   - tool parameters: `result` (the exact `NativeWriteSessionResult` previously returned by this session's write path — round-tripped, not re-typed from model text) and nothing else material;
   - the session keeps an in-memory map of results it issued this host session; a result that was not issued by this session is refused (`UNKNOWN_CANDIDATE`) — this is the host-side analogue of apply's `sourceRevision` staleness check;
   - no automatic write→apply chaining: the tool never invokes `NativeWriteSession` itself; write remains out of scope of this slice (see Out of scope);
   - `SPARKLE_NATIVE=0` disables the new tool exactly as it disables `sparkle_delegate` (single early return already present).
4. **Focused tests** for the registration boundary: issued-vs-foreign result refusal, accepted-only gating (FAILED/CANCELLED result refused), dispose session-scoping, SPARKLE_NATIVE=0 suppression, and a pinning test asserting the tool surface (name, parameter keys) so scope creep fails CI.

### Out of scope

- Registering `NativeWriteSession` as a host tool (automatic/invoked write) — requires its own boundary review and owner authorization; the apply tool consumes only results the host already holds.
- Global Pi configuration writes (option B allowlists beyond this tool), credentials/permissions/trust/tool-activation fields — hard non-goals per ADR-006 amendment.
- Live quality routing, F-PROD, Outcome-supported claims — unchanged and still gated.
- Any change to `src/native/apply.ts` apply/rollback semantics (frozen by PR #45 review).

## Acceptance Criteria

- [ ] A Pi session can apply a candidate by passing back the exact result object the session issued; the source fast-forwards and the frozen verification command passes at the source root (integration: adapter-level test with fake executor, no live LLM). Verification: focused integration suite command in Test-First Plan.
- [ ] A result object not issued by this session, or a non-accepted result, is refused before any git command (unit). Verification: `test/unit/extensions/native-apply-registration.test.ts` refusal cases.
- [ ] Disposal via the tool is refused for candidate paths not issued by this session (unit) and second-dispose refusal still holds (existing behavior, pinning test).
- [ ] `SPARKLE_NATIVE=0` suppresses the new tool; the extension registers exactly `sparkle_delegate`, `sparkle_apply_candidate`, `/sparkle-status` and nothing else (pinning test).
- [ ] `docs/status-matrix.md` native row updated to "Wired: yes (registration)" only after the above pass; apply report and this plan closed out with evidence links. Verification: `pnpm workflow:check` + checklist update.

## Implementation Slice

| File/symbol | Change | Owner | Dependency/risk |
|---|---|---|---|
| `extensions/pi-sparkle/index.ts` | add `sparkle_apply_candidate` tool + session-scoped issued-result map; zero changes to `sparkle_delegate` | main agent | must stay within thin-adapter rule (ADR-001/006): Pi types only in extension file |
| `test/unit/extensions/native-apply-registration.test.ts` | new: refusal matrix + surface pin | main agent | none; uses fake executor factory |
| `test/integration/extensions/native-apply-registration.test.ts` | new: round-trip apply on real git fixture (reuse apply integration fixture pattern) | main agent | Windows git plumbing — reuse `test/integration/native/apply.test.ts` fixtures |
| `docs/status-matrix.md` | native row wording after evidence | main agent | frozen-additive style; additive note only |
| `tasks/todo.md`, `tasks/plan.md`, `docs/reports/2026-09-20-native-apply-registration.md` | evidence + closeout | main agent | workflow:check must pass |

## Test-First Plan

- Red test: unit refusal matrix against the not-yet-registered tool (`UNKNOWN_CANDIDATE`, non-accepted result, foreign dispose) — confirm module/tool absence first, then GREEN.
- Focused command: `pnpm test test/unit/extensions/native-apply-registration.test.ts test/integration/extensions/native-apply-registration.test.ts`
- Regression command: focused native set (`test/unit/native` + `test/integration/native`) must stay 34/34.
- Negative and recovery cases: result mutated between issue and apply (hash mismatch → refuse, candidate retained); abort before first mutating call (no work); apply failure → rollback verified by existing integration suite, tool surfaces the durable error.

## Gates and Handoff

- Human/policy gate: **G3 — owner authorization** before merging: this is the first host-mutable registration. Package: this plan + test evidence + diff; owner reviews the tool surface line-by-line per development-workflow §6.
- Independent review: luna-fast single-turn dispatch (standing backup channel; grok-fast remains unavailable per relay 404/402 open item).
- Rollback or abort condition: any refusal weakens (e.g., accepting result objects not issued by the session) aborts the slice; revert to library-only status and record the reason.
- Required durable records: report under `docs/reports/`, status-matrix note, checklist updates in the same session as the work.
- Next command after handoff: `pnpm gate` on the slice branch; then PR with review package.

## Closeout

- Verified commit/date: pending.
- Commands and outcomes: pending.
- Open risks/follow-ups: write-tool registration (separate plan), global-config allowlists (option B), unified quality routing, live projection/recall.
- Evidence links: pending.
