# Loop 5 · Round 2 — Fable-context: UX audit of `src/context/` and `src/tracking/`

Auditor: Fable-context (claude-fable-5). Analysis only; no `src/` edits, no commit.
Audited at HEAD `826a44a` (`docs(agent): close Loop 5 Round 1 review and start Round 2`), working tree clean apart from `.agent_workspace/` reports.

Charter: Round 1 covered these two modules only by importer-tracing (R1 review §4: "only importer-traced, never UX-audited"). This report maps **operator reachability** (what an operator can cause, see, and act on through shipped verbs), **gaps**, and **freeze collisions** (which pinned contracts any future fix must navigate). Everything below was verified by direct reads of the sources and their callers, not inferred from docs.

Verdict up front: **not** NO_HIGH_VALUE_CHANGE_FOUND. Both modules are internally disciplined — heavily commented, posture-pinned, deterministic — but they are *write-mostly* subsystems: the tracking gate blocks production runs while telling the operator only `ANALYSIS_QUEUED`, and the context packet that grounds every child is compiled, injected into a prompt, and gone. The high-value candidates are read-side and freeze-safe (§5).

---

## 1. What these modules are, and the one production path into each

### 1.1 `src/context/` (2 files, ~940 lines)

- `index.ts` — `buildProjectContextIndex(snapshot, options)`: derives a `ProjectContextIndex` (facts with trust/freshness, instruction precedence/ownership, validation routes, manifests, generated hints, dirty-unrelated paths, token-budgeted code map) from a `ProjectSnapshot`. Also `createEmptyContext`, `refreshProjectContextIndex` (stale-marking incremental rebuild).
- `packet.ts` — `compileContextPacket(request)`: rank-ordered, token-budgeted selection into a per-child `ContextPacket` (requiredFacts / relevantFiles / codeMap / omissions with reasons `token-budget|secret|unavailable|unrelated-dirty`); `formatPacketForPrompt` (the "Grounding (cite these; do not invent files or APIs):" block); `queryPacketGrounding` (M3-T5: answer downstream questions from the packet alone); `compilePacket` (empty-contract compat wrapper).

**Production call graph (complete):**

- `run/coordinator.ts:537` and `run/flowchart-run.ts:743` call `buildProjectContextIndex(project)` — **no options argument on either plane.**
- `run/child-grounding.ts::groundChildTask` calls `compileContextPacket` (budget always the default 2000; `secretEvidenceRefs` never supplied) from both planes' child dispatch.
- `run/child-prompt.ts::formatChildPrompt` renders the packet via `formatPacketForPrompt` into the child prompt.
- `tracking/isolation.ts` imports the `ContextPacket` type only.

The `project` snapshot always comes from `project/discovery.ts::discoverProject`, which reads **root-level files only**: `AGENTS.md`/`CLAUDE.md`, seven manifest names, five `package.json` scripts, and exactly two fact keys (`package_manager`, `git_root`), all `confidence: "HIGH"`. The full snapshot is durable in the `PROJECT_DISCOVERED` event.

### 1.2 `src/tracking/` (12 files, ~2620 lines)

The three-line scoring/gate kernel: `prescore.ts` (six dimensions → P), `human-score.ts` (bilingual regex extraction of H), `combined-score.ts`, `gates.ts` (hard/soft/none + 10 anomaly codes), `roller.ts` (rolling summary with fail-closed mandatory-omission), `turn.ts` (`runTrackingTurn` orchestrator), `from-child.ts` (the **sole production producer** of a `PrescoreInput`, via `assessChildObservation`), `analysis.ts` (anomaly → improvement candidate), `isolation.ts` (execution-may-not-read-summary), `config.ts`, `types.ts` (schemas + `parseTrackingAssessment`/`hashAssessment`/`hashSummary`).

**Production call graph (complete):**

- `run/child-tracking.ts::applyChildThreeLine` → `assessChildObservation` → `computePrescore` + `runTrackingTurn` — called from `run/coordinator.ts` (DAG plane) and `run/flowchart-run.ts` (flowchart plane; the `--track` journey reaches it through `track/loop.ts` → `startFlowchartRun`).
- `run/gate-apply.ts::applyTrackingGate` writes `TRACKING_ASSESSMENT` (full assessment, validated by `parseTrackingAssessment`) and, on a blocking directive, `GATE_TRANSITION` (with `reasonCode` = the leading anomaly code) plus `RUN_BLOCKED { reason: "ANALYSIS_QUEUED", requiredEvidence }` or `RUN_WAITING_FOR_USER`.
- `run/events.ts` validates payloads; `learning/signals.ts` deliberately *excludes* `TRACKING_ASSESSMENT` from `taskSuccess`.

Everything else exported by `src/tracking/index.ts` — `proposeFromAnomaly`, `sanitizePacketForAnalysis`, `bindExecutionContext`, `executionMayNotReadSummary`, `applyUserThreshold`, `trackingConfig` — has **zero production callers** (tests only). Same for `run/gate-apply.ts::executionAuthority`.

---

## 2. Operator reachability map

### 2.1 Input side: what an operator can influence

| Lever | Reachable? | Detail |
|---|---|---|
| What grounding a child gets | **Indirectly only** | Author root `AGENTS.md`/`CLAUDE.md`, manifests, `package.json` scripts. No flag inspects or adjusts it; packet token budget (2000) and index code-map budget (2000) are constants with no CLI/config path. |
| `inject --run --type fact` | **Reaches the wrong "facts"** | Injected facts go to `FlowchartSupervisor.applyInjection` → the supervisor's edge-condition fact map. They never enter the `ProjectContextIndex`, so a child re-dispatched after `unblock` gets a packet rebuilt from fresh root discovery — the injected fact is invisible to it. The BLOCKED remediation block suggests `inject` as remedy #2, which is honest for branch conditions and a dead end for "give the child the fact it was missing." |
| Human score (H) | **Unreachable** | `assessChildObservation` calls `runTrackingTurn` with `humanInput: {}` and a window with no `userText`. The entire `human-score.ts` machinery (CountableList ratio, ten-point `n/10`/`n分`, short-rule bilingual regexes) is production-dead; `combineScore`'s `0.7·min+0.3·max` blend is unreachable; H is always `UNOBSERVED`. |
| Tracking thresholds | **Unreachable** | `applyUserThreshold` — "user-authored threshold change" per its own comment — has no caller; no CLI verb, env var, or state file feeds `TrackingConfig`. `DEFAULT_TRACKING_CONFIG` is the only config production ever sees. |
| Gate facts beyond the child's verdict | **Unreachable** | `gateFacts` overrides exist on `TrackingTurnInput`, but the sole producer supplies only `deterministicFail` and `criterionUnmet`. `ownershipEscape`, `repeatedNoProgress`, `userRejectStop`, `safetyRejected` can never be true in production (synthetic tool record always `escaped: false`, `stalledTurns` always 0, human always unobserved). |
| Recovering a gate-blocked run | **Reachable and correctly routed** | `unblock` → `resume` is printed on the blocked report; matched-`RUN_UNBLOCKED` semantics verified in `gate-apply.ts::currentGateStatus` and pinned in `unblock-flow.test.ts`. This half works. |

### 2.2 Anomaly-code reachability (the gate's vocabulary vs what can fire)

Given the sole producer (`prescoreInputFromObservation`): `completedChecks` is a copy of `requiredChecks` when PASSED (else empty); `retainedConstraintIds` is a copy of constraint ids; `writePaths`/`ownedPaths` empty; the one synthetic tool record has `exitCode` 0/1 and `escaped: false`; `stalledTurns` 0; open minors always `[]`; `maxItems` never set. Consequences, each verified against the dimension/gate code:

| Anomaly code | Production-reachable? | Why |
|---|---|---|
| `deterministic-fail` | **Yes** | Verifier `FAILED` (incl. a pi child's own `sparkle_report_task_result`). |
| `claimed-verification-without-checks` | **Yes (rider only)** | Needs `requiredChecks` gap (only when FAILED + tester) *and* an `isSuccessClaim` summary — always accompanies `deterministic-fail`. |
| `unmet-acceptance-criterion` | **Yes** | A criterion the child reported FAILED (`unmetCriteriaOf`), even under whole-task PASSED. The R11-1 option-(a) channel. |
| `soft-threshold` | **No** | With a PASSED verdict the only FAIL-capable dimensions are progress (evidence can't fail: `exitCode 0` present). Worst case (worker, FAILURE outcome + PASSED verdict): quality 2/3, coverage 1 → P ≈ 0.667 > 0.55. `minorPDip` never applies (no minors). With FAILED, hard codes preempt the soft check. |
| `repeated-no-progress` | No | `stalledTurns` always 0; `gateFacts.repeatedNoProgress` never supplied. |
| `ownership-escape` | No | `escaped` always false; `writePaths` always empty. |
| `user-reject-stop`, `permission-security-reject` | No | Human signal always unobserved. |
| `minor-escalated` | No | Open minors always empty. |
| `mandatory-omission` | No | `failClosed` requires `maxItems`, never supplied; roller's fail-closed budget path is dead. |

So **every production gate outcome is either `none` or a hard block**, and every hard block maps to `queue_analysis` → `RUN_BLOCKED { reason: "ANALYSIS_QUEUED" }`. The `wait_user` directive, `RUN_WAITING_FOR_USER`-from-gate, `askUser`, and the `FAIL_CLOSED` reason code are all production-dormant. (Loop 4 R8-4 C7 "soft and hard both block" remains true as library semantics; no shipped plane can produce a soft block.)

### 2.3 Output side: what is durable vs what is rendered

Durable in `events.jsonl` (run-event record class):

- `TRACKING_ASSESSMENT` — the **full** assessment: prescore/quality/coverage, six per-dimension verdicts, gate kind + codes, evidenceRefs, hash, seq.
- `GATE_TRANSITION` — from/to, **`reasonCode` (the actual anomaly code)**, evidenceRefs, policyVersion, idempotencyKey.
- `RUN_BLOCKED` — `reason: "ANALYSIS_QUEUED"` (constant on the gate path), `requiredEvidence`.
- `CHILD_MESSAGE` (terminal `TASK_RESULT`) — the verification verdict and the full per-criterion array with per-criterion evidence ids.
- `PROJECT_DISCOVERED` — the full snapshot the context index derives from.

Rendered by shipped verbs:

- `run`/`resume`/`answer` on a BLOCKED exit: `formatBlockedRunReport` prints `reason:` (**`ANALYSIS_QUEUED`**, not the anomaly code), `required evidence:` (raw ids), and the three `next:` remedies.
- `inspect`: status, `requiredEvidence`, children with `result: outcome — summary`, artifacts, evidence ids. **Nothing** from `TRACKING_ASSESSMENT` or `GATE_TRANSITION`; no per-criterion outcomes; `--summary-json` is the frozen 4-key `INSPECT_SUMMARY`.
- `list`: status column only — a BLOCKED run shows `BLOCKED` with no reason.
- `unblock`: refusal/authorization mechanics only; it never says what blocked the run.

**Net: the gate's entire diagnostic output — which anomaly code, which dimensions failed, which criterion the child itself said it did not meet, the score — is durable and validated in the log, and invisible through every shipped verb.** The operator's remediation loop (`inspect` → `inject`/`unblock`) begins at a word (`ANALYSIS_QUEUED`) that names an internal queue, not a cause.

The context packet is worse than invisible — it is **ephemeral**: not on `TASK_REQUEST` (protocol carries objective/artifacts/criteria/limits only), not on any event, and the pi invocation record deliberately retains "No prompt or response body" (`pi-executor.ts::buildInvocation`). The packet's omission ledger (`omittedSummary`, per-item reasons — exactly the "what did the child *not* get told" record an operator debugging a hallucinating child needs) is rendered once, into the child's own prompt, and discarded.

---

## 3. Gaps

Ranked by operator pain × mismatch between what the subsystem records and what it shows.

**G1 — The gate blocks runs and withholds its reason (high).** Production-ordinary shape (status-matrix row 43: a pi child's evidence-backed FAILED, or a reported-FAILED criterion under whole-task PASSED) ends the run BLOCKED. The operator sees `reason: ANALYSIS_QUEUED` on stderr, `BLOCKED` in `list`, and `requiredEvidence` ids in `inspect`. The anomaly code sits unread in `GATE_TRANSITION.payload.reasonCode`; the failed dimension verdicts sit unread in `TRACKING_ASSESSMENT.payload`. No new event, no schema change, and no gate-authority change is needed to render them — this is a pure read-side gap.

**G2 — `ANALYSIS_QUEUED` names a consumer that does not exist (high, honesty).** `runTrackingTurn` builds the `AnomalyPacket` when `wakeAnalysis` is true; `assessChildObservation` returns it inside `turn`; `applyChildThreeLine` reads only `.assessment` and drops it. `analysis.ts::proposeFromAnomaly` — the thing that would consume a queued analysis — has no production caller. Nothing is queued, nothing will dequeue, and the only real remedy is the manual `unblock` the report already prints. The operator-facing string promises an automation that is dormant by design (D3/eval-first ordering). One honest word ("verification failed; analysis is not yet wired — unblock to proceed" or simply the anomaly code) would close it; alternatively this is a docs-level disclosure. Note the payload word itself is load-bearing in tests/fixtures (`unblock-flow`, `blocked-next`, replay) — the *formatter*, not the event, is the safe place to be honest.

**G3 — The blocking criterion is unnameable through any verb (high).** `unmet-acceptance-criterion` exists precisely so "a child that finished, said so, and is honest about the one thing it did not meet" blocks the run. `from-child.ts` documents that "which criterion it was stays readable from the child's own `CHILD_MESSAGE` row" — true only of the raw JSONL. `inspect` prints the terminal's outcome/summary/artifact/evidence ids but not `verification.criteria`, so the operator diagnosing this block must open `events.jsonl` by hand to learn which criterion failed and what evidence the child cited.

**G4 — Scoring skips are silent (medium).** `assessChildObservation` returns `{ apply: false }` — leaving zero durable or rendered trace — in four cases, including the sharp one: a FAIL-dimension assessment **with no evidence refs anywhere on the observation** is dropped whole (`from-child.ts:118-121`). For pi children the producer tool enforces evidence-backed FAILED, but the seam is executor-generic: any other executor's evidence-less FAILED bypasses the gate and the run proceeds as if never scored, with nothing recording that tracking looked and declined. An operator (or an auditor of P0 posture) cannot distinguish "gated and passed" from "not admitted to scoring."

**G5 — Child grounding is unauditable after the fact (medium).** The packet (facts chosen, files named, omission ledger, budget pressure) is ephemeral per §2.3. When a child invents an API or misses an instruction file, the operator cannot answer "was it told?" — the honest answer is reconstructible only by re-deriving the packet from `PROJECT_DISCOVERED` + the spec, which no verb does. Any fix has a genuine privacy/size trade-off (packets embed contract text), so this is a design slot, not a rider.

**G6 — Two "fact" vocabularies collide on the remediation path (medium).** §2.1: the blocked report's `inject --type fact` writes supervisor edge facts; child packets rebuild from root discovery. An operator who unblocks with `--retry-node` after injecting "the fact the child was missing" will watch the child re-fail without it. Nothing in USAGE distinguishes the two fact planes. (A third unrelated "contextFacts" lives in `TrackingWindow` — `["role X", "task Y"]` — and a fourth meaning in `src/track/` vs `src/tracking/`, which are unrelated subsystems one letter apart. Contributor-facing, but it misdirected Round 1's own importer-tracing.)

**G7 — Dead knobs presented as configuration (low).** `TrackingConfig.unobservedHighCap` (0.54) is declared, defaulted, and copied by `trackingConfig()`, and **no scoring or gate code reads it** — its only consumer is a test asserting P happens to land under it. Alongside: `softThreshold` is real but operator-unreachable (G2 in §2.1), and `hardFailCap` affects `displayPrescore` only, which nothing renders. The config module advertises four dials; production exposes zero.

**G8 — The context module's differentiating machinery is 100% option-gated and no production caller passes options (low each, large in aggregate).** With `buildProjectContextIndex(project)` bare on both planes and discovery root-only, all of the following are permanently inert in shipped runs: the code map (always empty; `RANK_CODE_MAP`, the packet's second budget loop, `PacketCodeMapOmission.source: "packet"` unreachable); freshness (`stale` unreachable — no `priorHashes`/`sourceHashes`; every fact `fresh`, every trust `HIGH`; `pickCanonical`'s trust ordering moot); `dirtyUnrelated` and the `unrelated-dirty` omission; `secret` omissions (`secretEvidenceRefs` never passed); `architecture.*`/`risk.*` facts (discovery never emits those keys, so `architecture`, `risks`, and `RANK_RISK` candidates are always empty); nested instruction precedence/ownership (discovery reads root files only, so `owner: "nested"` and depth-ordering are unreachable); `priorEpisodes`/`episodeId` (never populated); `refreshProjectContextIndex`, `createEmptyContext`, `compilePacket`, `queryPacketGrounding` (no production callers). **Docs drift rider:** `docs/status-matrix.md` row 162 lists "Context packet fidelity + grounding query" as wired "yes — packet compile path"; true for compile, an overclaim for the grounding query, which nothing outside tests invokes.

**G9 — Latent correctness quirks in the dormant surface (record, don't fix).** (a) `PacketCodeMap.tokenBudget` reports the *index* code-map budget while entries are actually charged against the shared *packet* budget — the reported constraint is not the operative one. (b) Code-map omission records carry rank 70, but entries are budget-charged after all rank-90 candidates, so the recorded rank misstates the effective priority. (c) `estimateCodeMapTokens` is duplicated verbatim in `index.ts` and `packet.ts` (`estimateCodeMapEntry`) — divergence would silently split budgets. (d) In production, manifest "hashes" fall back to `hash32(path)` — content-blind, so the freshness machinery could not detect a changed manifest even if a prior were supplied. (e) `hashSummary` covers a subset of `RollingSummary` (no `human`, `prescore`, `openMinors`, `evidenceRefs`, `failClosed`), so the `prevSummaryHash` chain (itself production-dead: `previous` is never passed) would not notice tampering with those fields. All are invisible today precisely because G8's machinery is inert; they become bugs the day someone wires options.

---

## 4. Freeze collisions

What any Round 3+ fix in this territory must navigate. All verified by reading the pin tests, not just their names.

| Frozen surface | Where pinned | Effect on fixes here |
|---|---|---|
| `INSPECT_SUMMARY` 4-key contract | `test/unit/run/inspection.test.ts`, `test/integration/cli/inspect-summary.test.ts`, comment at `main.ts` inspect | Gate/criterion info in `--summary-json` must be **additive keys with same-diff pin updates**; the four existing keys are untouchable. Human-readable `inspect` stdout is not exact-pinned — additive lines are the cheap path. |
| Blocked-report shape | `test/integration/cli/blocked-next.test.ts` | Pins **exactly three `next:` lines** ("inspect, inject and unblock are the only next lines"), anchored regexes on `^  reason: …$` and `^  required evidence: …$`, `--discard-executed` must stay a `note:`. A gate-cause disclosure must be a `note:`/new label, **not** a fourth `next:`; the `reason:` value for the stall path is pinned verbatim. Also: `formatBlockedRunReport` lives in `main.ts`, inside the PR #12 merge-collision zone Round 1 flagged. |
| `GateApplyResult.runStatus` has no reader; flowchart uses only `.events` | `test/unit/run/gate-status-posture.test.ts` (whole-src AST census + posture-prose pins on `GateApplyResult` and `currentGateStatus`) | Any visibility fix must read **the persisted log** (`GATE_TRANSITION`/`TRACKING_ASSESSMENT` events), never the in-memory gate result. Reading events is exactly what replay/inspect already do — legal. Deleting/altering the pinned posture comments breaks prose pins (rewrapping is safe; rewording is not). |
| `independentEvidence` has exactly one dereference (the discard) | `test/unit/tracking/independent-evidence-posture.test.ts` (whole-src census + prose pins + 144-cell inertness sweep) | Any **new src file** that dereferences the field breaks the census. Rendering `TrackingAssessment` payloads does not touch it (the field lives on `PrescoreInput`, not the assessment) — safe. Renaming the field or "tidying the `void`" is a pinned decision, not a cleanup. |
| Asked-for criteria move verdicts/prescore, never the directive; sole production path into scoring | `test/unit/tracking/criteria-are-guidance.test.ts` (sweep) + `test/unit/tracking/option-a-preconditions.test.ts` (five named pins, R10-2 meta-pin on their titles) + FAIL-unreachable tripwire for `coverageOutcome` in `test/unit/run/flowchart-run-abort.test.ts` | Fixing G4 by making skips *durable* must not admit new observations into scoring or add FAIL to `coverageOutcome`'s range. Anything touching `from-child.ts` admission logic or `prescoreInputFromObservation`'s request-derived copies collides with parent-signed R7-2/R11-1 and needs same-diff pin replacement per R8-4's rule. |
| Gate hard-code ordering; soft and hard both block | prose-adjacent comments in `gates.ts`/`gate-apply.ts`, behavior in `test/unit/run/gate-outcome.test.ts`, `test/integration/run/criteria-gate.test.ts`, `unblock-flow.test.ts` | Changing `RUN_BLOCKED.payload.reason` away from `ANALYSIS_QUEUED` would ripple through fixtures and the matched-unblock ledger tests; G2 should be fixed in the *formatter* (or docs), not the event payload. |
| Event vocabulary | `EVENT_TYPES` membership check in `events.ts::validateEvent`, `event-row-fuzz.test.ts`, campaign posture (R1 review §2.7: no new event types) | A "SCORING_SKIPPED" event for G4 is the natural design and is exactly the high-friction path; a first fix should prefer rendering what is already durable. Any new machine-readable CLI object must follow D3: non-event, `preview: true`, key-pinned day one. |
| Packet prompt block + determinism | `test/unit/context/packet.test.ts` ("tells the agent not to invent files", "same frozen inputs produce equal packets"), `test/integration/m3/packet-fidelity.test.ts`, `checkpoint-d.test.ts` | Rewording `formatPacketForPrompt`'s header or omission line collides; packet compilation must stay deterministic. Persisting packets (G5) is unconstrained by these but bounded by the invocation record's pinned "no prompt/response body" posture and the privacy plane tests. |
| Live-isolation / adaptation plane | `analysis.test.ts`, plane-boundary tests, D3 | Wiring `proposeFromAnomaly` into the live loop (making `ANALYSIS_QUEUED` true) is a **policy** change through the adaptation plane, not a UX slot; G2's honest-wording fix deliberately does not require it. |

---

## 5. Ranked recommendations (for the parent; nothing built this round)

1. **Gate-cause visibility batch (G1+G3, read-side only).** `inspect` renders, from the log it already reads: latest `GATE_TRANSITION` (`reasonCode`, from→to) + latest `TRACKING_ASSESSMENT` (score, failed dimensions) + per-criterion FAILED ids/evidence from the child's terminal `CHILD_MESSAGE`; `formatBlockedRunReport` gains one `note:` naming the anomaly code beside the existing `reason:` line. Additive stdout lines, additive `--summary-json` keys with same-diff pin updates, zero new events, zero gate-authority change. Collisions: blocked-next's three-`next:` pin (stay a note), INSPECT_SUMMARY additivity, PR #12 merge zone on `main.ts`.
2. **`ANALYSIS_QUEUED` honesty (G2).** Formatter/docs wording that says what is true today: verification-gate block, analysis pipeline not yet wired, `unblock` is the remedy. Do not touch the event payload.
3. **Fact-plane disambiguation (G6).** One sentence in `inject` USAGE and the blocked report's inject line scoping it to flowchart edge conditions; data-dictionary/README sentence distinguishing supervisor facts from context grounding. Pure strings; check blocked-next anchored regexes before editing the exact pinned lines.
4. **Docs truth riders (G7, G8-rider).** Status-matrix row 162 split (compile path wired; grounding query unwired); a recorded decision on `unobservedHighCap` (delete the knob or document it as reserved — it is unpinned either way); note that tracking config has no operator surface by design.
5. **Durable scoring-skip record (G4)** — flag for design review, not a rider: wants either a new event type (frozen-surface friction) or a checkpoint/assessment-seq side record, and must not disturb the R7-2/R11-1 admission pins. Worth doing only with the same care option (a) got.
6. **Packet persistence (G5)** — park behind an explicit privacy decision (packets embed contract/objective text; invocation log's "no prompt body" posture is pinned). The cheap intermediate: `inspect` could *recompute* and display the packet for a named task from durable inputs, at zero persistence cost — but note recomputation is only honest while `groundChildTask` stays deterministic from `PROJECT_DISCOVERED` + spec + predecessors.

Explicitly **not** recommended: wiring `proposeFromAnomaly`/analysis wake (adaptation-plane policy, eval-first ordering holds); wiring human-score/`gateFacts`/open-minors into production producers (each is a scoring-semantics change the posture pins exist to make deliberate); deleting the G8 dormant machinery (spec-backed M3 surface, deterministic, tested — inert code with living pins is cheap; churning it buys nothing); renaming `src/track/`/`src/tracking/` (import-wide churn, no operator gain).
