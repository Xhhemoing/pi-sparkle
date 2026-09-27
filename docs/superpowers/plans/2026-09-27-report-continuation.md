# Report continuation: staged A0 and B1 delivery

Task: TASK-20260927-report-continuation
Owner: implementation agent; maintainer owns independent acceptance
State: in-progress
Baseline: `696fc3b2173a342c18a64b3a3e1e608b0d142253` on PR #46

## Authorization and boundaries

The user requested continued implementation of the attached plan with staged GitHub synchronization. Deliver reviewable commits as each bounded package has evidence; do not wait for all A-E packages. This does not authorize a main merge, production apply, live-provider experiments, online learning activation, credentials/global-config changes or closure of existing human gates. Read the existing AGENTS/workflow/task records. The main branch and PR were unchanged at intake. Existing O02 ownership is not reassigned.

## A0-root: establish the Windows failure, then fix narrowly

1. Add a same-runner baseline/current preflight probe using the pinned original main and one identical temporary Git fixture. Record requested path, Git top-level, native real paths and directory identities. Baseline results are observations, not a presumed failure. No provider calls or candidate execution.
2. Run new repository-root regression tests before the implementation. They must preserve normal roots, spaces and equivalent path syntax while refusing subdirectories and symbolic-link/junction aliases, including links in ancestor components.
3. After observing the actual difference, change only the root identity seam and directly affected expectations. Never delete the root check, lower-case all paths, or accept arbitrary aliases solely because realpath matches. Preserve staged/unstaged/untracked/ignored checks, source branch/revision and candidate binding.
4. Run focused root/preflight/apply suites on Windows and Linux plus the existing quality/security/Pi gates. Record exact revision, jobs and counts; baseline-versus-current evidence cannot be replaced by a Linux-only simulation.

Files: `src/native/write-preflight.ts`, optional small root-identity helper, focused native tests, `scripts/native-root-baseline-probe.mjs`, `.github/workflows/report-root-regression.yml`, this plan and a dated verification record. Touch apply identity only if a demonstrated downstream defect requires it and record the expanded boundary before editing.

Acceptance: normal platform-native root spellings work; subdirectories and link aliases are refused before any verification; clean-source and existing apply safety tests still pass; no mutating command is added to production preflight. A0-root is not acceptance of all O01-O11 reliability work.

## B1: optional bounded read-only task contract

Depends on A1 implementation and source review; may be authored while A0-root CI runs but delivered as a separate commit. Review the real native input/executor/persistence seam first. Reuse the existing RequirementContract, source and acceptance types, not a parallel authoritative store.

Files: native contract adapter/helper, `src/native/session.ts`, `extensions/pi-sparkle/index.ts`, native unit/integration tests, task/status documentation.

Acceptance: existing role/objective calls retain behavior; optional bounded scope/prohibitions/deliverables/acceptance/source references are validated before persistence and reach the actual child request; no authority or mutable tool is granted; invalid/oversized contracts start no run; parent/child persisted facts agree with displayed task contract; completion still discloses independent verification UNOBSERVED. Criteria are requirements, not proof of passing. No S0-min Outcome DTO, new verification commands, native writing or automatic promotion.

Keep arbitrary source text as untrusted data. A task contract may narrow the task but cannot widen the existing read-only profiles. Scope descriptions in a prompt are not a filesystem access-control guarantee.

## Evidence and staged publication

For behavior changes, establish RED first, implement, rerun adjacent tests, and retain output. A failing-test/probe commit is explicitly diagnostic and not merge-ready. Publish A0-root fix evidence separately from B1. Final delivery must list PASS/FAIL/SKIP/NOT RUN and explain unclosed gates. Keep PR Draft pending independent review. Revert these commits to roll back; no state migration, user data deletion or destructive workspace reset.

Local environment at intake: Node 22.16.0 / TypeScript 5.8.3, no pnpm, DNS unavailable for GitHub/npm. Hosted CI is the supported full-checkout verification path; do not represent local subset checks as a full gate. This is an environment observation, not a future promise.
