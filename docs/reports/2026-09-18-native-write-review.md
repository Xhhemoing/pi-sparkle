# Native write delegation and main review

> Historical pre-implementation handoff. This report records the provider failures, rejected draft, and main-review findings from before the retained `NativeWriteSession` implementation. The implementation and current verification are recorded in [the 2026-09-18 native-write worker report](2026-09-18-native-write-worker.md); independent review and automatic application remain open.

## Identity

All implementation-state and handoff conclusions below are historical, as of this pre-implementation report. For current implementation and verification, use [the worker report](2026-09-18-native-write-worker.md).

- Task: TASK-20260918-native-pi, isolated-write follow-up.
- Date: 2026-09-18. Base: 13f954e plus previous uncommitted native readonly slice.
- Owner explicitly requested subagent implementation then main review, subsequently selected Grok over Luna. Use xhh/cursor-grok-4.6-fast for subsequent implementation; no silent fallback to Luna.
- State at report time: blocked on Grok provider availability; implementation was NOT accepted at that time.

## Delegation evidence

- `mu6y5s05-bfcf12b5` worker: failed before implementation, provider 402 budget pool exhausted.
- `mu6y6z9q-639ed1d2` luna-fast: aborted after partial plan/code/test writes; not a complete delivery.
- Created user `grok-worker` configuration at `C:/Users/86080/.pi/agent/agents/grok-worker.md`, model `xhh/cursor-grok-4.6-fast`, normal implementation tools. Discovery command confirmed name/model/tools. No credential or permission configuration modified.
- `mu6ycka2-95d32bd6` grok-worker: timed out at 600000ms, no implementation edits observed; tool history ended with source/docs reads.
- `mu6yr4dr-834bc272` grok-worker: upstream 504 `upstream_first_frame_timeout`, server attempted 3 times, elapsed 60015ms; upstream error reports `cursor-grok-4.6-high-fast` although configured model is `cursor-grok-4.6-fast`. No completed implementation. These errors establish transport/availability problems, not model quality.

## Owner-directed retry batches

Owner requested interval retries up to five times before reporting a subagent failure. Subsequent Grok calls explicitly use `retries: 5` (six total attempts). Current harness `runner.ts` uses exponential backoff of 250, 500, 1000, 2000 and 4000 ms; no global retry implementation was changed.

- `mu6zaqcw-571af907`: persisted result confirms `attempts: 6`, model `xhh/cursor-grok-4.6-fast`, final failure upstream 504 `upstream_first_frame_timeout`. No active write-session implementation created.
- After owner said continue, `mu71ljma-716e8b07`: persisted result confirms `attempts: 6`, final attempt `durationMs: 600083`, `Timed out after 600000ms`. Final tool history contains source reads/searches (registry, domain status, task template, acceptance, Pi executor); no completed code or verification delivery. Duration is the final attempt's duration, not a total for the batch.
- Main checked active source/test paths and worktree after the batch: only previous `src/native/session.ts` remains; rejected drafts remain archived. No new implementation is available to review. Stop this batch after the requested retry limit, preserve Grok preference, and do not silently switch models.

### Reduced preflight-only batch

After another owner continuation, dispatch `mu74bsrq-5cff7263` narrowed work to two new files (`src/native/write-preflight.ts`, `test/unit/native/write-preflight.test.ts`): read-only clean-source validation and immutable host-verification snapshot. Configured `retries: 5`, per-attempt timeout 300000ms. Persisted result confirms six attempts; final failure `Timed out after 300000ms`. Last recorded tools were reads/searches of paths, CLI commits and independent-check sources. Main verified both proposed files and the requested worker evidence file do not exist. No implementation/test result to review; current source unchanged. This batch also exhausted the requested retry allowance. Smaller scope alone did not resolve execution availability/latency; no conclusion about coding quality follows.

### Diagnostic follow-up: distinguish gateway errors from task timeout

Main inspected `C:/Users/86080/.pi/agent/extensions/subagent/runner.ts`: child startup passes `--mode json -p --no-session --model xhh/cursor-grok-4.6-fast`; each retry starts a fresh process/session. Retry results retain only the latest attempt, so aggregate history and total batch latency cannot be inferred from that result alone. Native tools are passed explicitly. No runner changes made.

Final-attempt evidence: `mu74bsrq-5cff7263` completed 11 assistant turns with 82,835 input / 4,115 output tokens (plus 161,408 cached tokens) before timeout; `mu71ljma-716e8b07` completed 14 turns, 184,615 input / 10,476 output (plus 265,600 cached). Tool messages show extensive successful source reads/searches. Thus those timeouts are not evidence of total provider unavailability: repeated context acquisition consumes the execution window. Fresh-session retries can repeat that work. This is an observed contributing mechanism, not a proven explanation of every delay.

- Minimal no-tools probe `mu78ps0m-ac069457`: configured Grok, response `GROK_READY`, first attempt success in 4,768ms. Establishes point-in-time connectivity only.
- Narrow test-only task `mu78qka3-f5743a27`: requested one preflight test file and RED run only, no implementation or broad exploration. Confirmed `attempts: 6`; final failure upstream nginx `502 Bad Gateway`, final-attempt duration 27,627ms. Main checked expected test and RED log: neither exists. This exhausted the authorized retry limit for this request.
- Two failure modes coexist: gateway instability (502/504), and task timeouts after successful multi-turn reads. Do not describe all failures as Grok being unavailable or as evidence of coding quality. No implementation accepted and no model fallback.

### Preflight slice delivered and independently reviewed

Grok microtask `mu820w7g-67b20f31` created `src/native/write-preflight.ts`; main review found no type or lint issue and added the focused test contract in the active plan. Main test initially ran 6/7: the ignored-user-code case failed because Git status omitted ignored paths. Grok targeted fix `mu832msg-253c9b0e` added `--ignored` to the read-only status argv. Main independently reran the focused test: **7 pass, 0 fail, 0 skip**, plus `pnpm typecheck`, `pnpm exec eslint src/native/write-preflight.ts test/unit/native/write-preflight.test.ts`, and `pnpm workflow:check`: all exit 0. This preflight-only slice is ready for main integration review, but the full NativeWriteSession is not implemented. Main final verification: `pnpm exec tsx --test test/unit/native/write-preflight.test.ts` = 7 pass / 0 fail / 0 skip; focused ESLint exit 0; `pnpm typecheck` exit 0; `pnpm workflow:check` exit 0; `git diff --check` exit 0 (only existing CRLF normalization warnings); `pnpm gate` exit 0 = 2786 tests, 2768 pass / 0 fail / 18 skip, build exit 0. Gate log: `.agent_workspace/research/native-write/gate-preflight-final.log`.

### Latest Grok model-route failures

Success-path RED dispatches `mu83ald8-a680879f`, `mu83c2g2-d392e49c`, `mu83dxg9-c2e773b1`, and `mu83m5j3-82da755b` each used configured `xhh/cursor-grok-4.6-fast` with `retries: 5` (six attempts). Every attempt failed immediately with upstream `404 model_not_found: Model "cursor-grok-4.6-fast" is not available for this group`; no file or log was produced. Connectivity probes `mu83hcki-bf282c00` and `mu83jkab-7708fd61` produced the same error, including after a 30-second wait. Direct `pi --mode json -p --no-session --no-tools --model xhh/cursor-grok-4.6-fast "Return exactly GROK_READY"` also returned the same 404, while `pi --list-models grok` still lists the model from the local catalog. Further six-attempt batches `mu83s9mq-fc8d747d` (after 60 seconds), `mu83tlhb-930a8f5d`, `mu840g8k-195714d9` (after 60 seconds), and `mu8442ue-8f30cc8e` all failed identically; each has `attempts: 6`, with no file or log produced. This differs from the earlier successful `mu820w7g-67b20f31` call and establishes an upstream group/catalog inconsistency, not a repository or task failure. No fallback model was used. The success-path RED test remains uncreated and the write session remains unaccepted.

## Main review findings (incomplete Luna draft)

- P1: `write-session.ts:86-91` only skips check for cancellation; FAILED/BLOCKED/WAITING_FOR_USER may still run successful verification and return accepted. Require successful execution before checking.
- P1: `write-session.ts:68-83` abort during async executor construction can be missed when listener is installed later; no shutdown/lifecycle ownership. Snapshot signal and own full operation until settlement.
- P1: `write-session.ts:90-91` verification fields read after worker execution; mutable caller data can change the host command. Snapshot trusted verification before first await.
- P2: `write-session.ts:10,19` Pi type import outside adapter and explicit any violate architecture/lint. Use an adapter-owned structural contract.
- P2: `write-session.test.ts:26-34,53` factory expects string but production supplies object; test writes using raw filesystem rather than supplied scoped tools, so cannot prove tool boundary.
- P2: exceptions before outcome lose durable run identity; no complete retained-failure evidence contract. Production also includes test-only retention assertion.

## Commands and disposition

- `pnpm exec tsx --test test/integration/native/write-session.test.ts`: FAIL, 1 test / 0 pass / 1 fail; `false !== true` at line 56. Log `.agent_workspace/research/native-write/main-review-focused.log`.
- `pnpm typecheck`: FAIL exit 2; TS2375 explicit assignedModel undefined, TS2379 args undefined, TS2322 incorrect executor factory signature. Log `main-review-typecheck.log`.
- Incomplete NEW draft source/test preserved by moving to `.agent_workspace/research/native-write/incomplete-luna/write-session.ts` and `write-session.test.ts`; no user/previous readonly implementation discarded. Plan remains in docs for continuation.
- After removing rejected drafts from active source/test discovery, `pnpm typecheck`: PASS. Log `restored-typecheck.log`.
- No full gate or live-provider experiment is claimed for this blocked follow-up. Earlier readonly-slice results remain historical evidence.

## Handoff At Report Time

Resume Grok when provider first-frame service recovers. Supply findings above plus retained drafts, then require actual RED→GREEN tests covering success, failed execution/check, dirty source, absent check, preabort, cancellation/shutdown and immutable host verification. Main must review resulting code and rerun applicable gates. No automatic apply/global settings or native write tool registration had been delivered at that time.

## Current Status

The retained `NativeWriteSession` implementation and preflight now exist and are locally verified. Current evidence is recorded in [the worker report](2026-09-18-native-write-worker.md). Automatic candidate application, independent reviewer approval, and live-provider acceptance remain open.
