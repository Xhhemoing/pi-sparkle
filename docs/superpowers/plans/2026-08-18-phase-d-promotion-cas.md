# Phase D: Proposal-first candidates and CAS

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `adapt auto` can collect and propose only. Promotion stays explicit human CAS. Rollback and the promotion ledger can rebuild the pointer. Replay cache keys include candidate and evaluator versions.

**Architecture:** Existing `promotion.ts`, `rollback.ts`, `comparison-report.ts`, and `HoldoutVault` already implement most of the ladder. This phase removes the installed auto-promote path that contradicts the final spec, and adds the remaining acceptance cases (22–25).

**Tech Stack:** TypeScript, `tsx --test`, existing registry lock / CAS.

**Spec:** [2026-08-18-three-line-final.md](../specs/2026-08-18-three-line-final.md) §6, §8 cases 22–25. Case 21 is in Phase C.

## Global Constraints

- Permission / security / credential never auto-promote (already true; keep tests).
- `SPARKLE_AUTO_ADAPT` may collect and propose; it must not CAS-promote.
- Do not close Checkpoint F from these tests.
- Do not add Temporal, OPA, or a new GateController.
- Commit only if the user asked for commits this session.

## Already green (do not rewrite)

- `promoteWithRegistry` CAS + ledger kinds `intent` / `promoted` / `rejected`
- Guardrail automatic rollback (`rollback.test.ts`)
- `validateComparisonReport` improvement claims require cost-delta CI **upper bound** ≤ `maxCostIncreaseUsd` (default 0)
- Bare `adapt promote` without `--approve` already refuses

---

### Task 1: `adapt auto` never CAS-promotes

**Files:**
- Modify: `src/learning/auto-loop.ts`, `src/cli/adapt.ts`, `src/adaptation/approval-profile.ts`
- Test: Modify `test/unit/learning/auto-loop.test.ts`, `test/unit/adaptation/approval-profile.test.ts`, CLI adapt tests if present

**Interfaces:**
- `runAutoAdaptLoop`: `promoted` is always `false`. Ignore `autoPromote: true`.
- `createInstalledAutoAdaptProfile`: `autoPromoteClasses: []`, `budget.maxAutoPromotions: 0`.
- `isAutoAdaptEnabled`: still a collect/propose kill switch (`0`/`false`/`off` disables the loop’s writes of **candidates** if you already treat it that way — keep collect-on, propose-on, promote-off). Document in the function comment: *collect + propose only*.
- `adapt status` text must not say routing-policy may auto-promote.

- [ ] **Step 1: Rewrite the existing auto-promote test**

```ts
test("repeated user and subagent failures propose a routing policy and do not promote", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "pi-sparkle-auto-"));
  const previous = process.env.SPARKLE_AUTO_ADAPT;
  process.env.SPARKLE_AUTO_ADAPT = "1";
  try {
    const projectId = createProjectId();
    const episodeId = createEpisodeId();
    const catalog = catalogFromPrimary({ primaryModelId: "premium", fastModelId: "cheap" });
    const assignments = assignTasks({
      catalog,
      tasks: [{ taskId: parseTaskId("tsk_impl"), role: "implementer", objective: "Implement the checkout parser" }]
    });
    const result = await runAutoAdaptLoop({
      stateRoot,
      projectRoot: "/tmp/proj-auto",
      projectId,
      primaryModelId: "premium",
      episodeId,
      assignments,
      extraSignals: failingPair(projectId, episodeId, "cheap"),
      autoPromote: true
    });
    assert.equal(result.promoted, false);
    assert.equal(result.created, true);
    assert.ok(result.candidateId);

    const registry = await loadAdaptationRegistry(stateRoot);
    const candidate = registry.getCandidate(result.candidateId as CandidateId);
    assert.ok(candidate);
    assert.equal(candidate.status, "proposed");
    const active = registry.getActiveVersion(candidate.identity);
    assert.equal(active?.versionId, candidate.parentVersionId);

    const learned = await loadLearnedRouting(stateRoot, "/tmp/proj-auto");
    assert.equal(learned, undefined);
  } finally {
    restoreEnv("SPARKLE_AUTO_ADAPT", previous);
    await rm(stateRoot, { recursive: true, force: true });
  }
});
```

Change `approval-profile.test.ts`:

```ts
it("installed plugin profile does not auto-promote routing-policy", () => {
  const profile = createInstalledAutoAdaptProfile();
  validateApprovalProfile(profile);
  assert.deepEqual(profile.autoPromoteClasses, []);
  assert.equal(canAutoPromote(profile, "routing-policy", 0), false);
  assert.equal(canAutoPromote(profile, "permission", 0), false);
});
```

- [ ] **Step 2: Run auto-loop + approval-profile tests — expect FAIL** (current code promotes)

- [ ] **Step 3: Set `promote: false` in `proposeAndMaybePromote`. Empty `autoPromoteClasses` on the installed profile. Update `adapt.ts` status strings and treat `--no-promote` as redundant (always off).**

- [ ] **Step 4: Run those tests + `test/integration/cli/cli.test.ts` if it asserts the old status line — expect PASS**

---

### Task 2: One resource boundary per candidate

**Files:**
- Modify: `src/adaptation/candidate.ts` (`candidateError` / `createCandidate` validation)
- Test: Modify `test/unit/adaptation/registry.test.ts` or `candidate` tests

**Interfaces:**
- Candidate `identity.kind` is the only resource kind. Reject content that declares a second kind.

```ts
export function assertSingleResourceBoundary(identity: ResourceIdentity, content: string): void;
```

Parse `content` as JSON when it is JSON. If it has `kinds: string[]` or `targetResource` + `extraKind`, throw `DomainValidationError`. Non-JSON prompt bodies are allowed (single kind from `identity`).

- [ ] **Step 1: Write the failing test**

```ts
it("rejects a candidate that names two resource kinds", () => {
  assert.throws(
    () =>
      registry.createCandidate({
        identity: { kind: "prompt", name: "x", scope },
        content: JSON.stringify({ kinds: ["prompt", "routing-policy"], text: "nope" }),
        parentVersionId: parent.versionId,
        author: { kind: "human", identity: "alice" },
        evaluationPlan: { stages: ["static"], metrics: ["safety"], planVersion: 1 }
      }),
    /one resource|single resource|boundary/i
  );
});
```

- [ ] **Step 2–4: RED / implement `assertSingleResourceBoundary` inside `createCandidate` / GREEN**

---

### Task 3: Replay cache key includes candidate and evaluator versions

**Files:**
- Modify: `src/experiments/replay.ts`
- Test: existing replay tests + new case 22

**Interfaces:**

```ts
export function replayCacheKey(input: {
  readonly runId: string;
  readonly candidateHash: string;
  readonly environmentVersion: string;
  readonly evaluatorVersion: string;
}): string;

export function replayPolicy(
  manifest: DatasetManifest,
  episodes: readonly FrozenEpisode[],
  policy: RoutingPolicy,
  outputRoot: string,
  cache?: { readonly candidateHash: string; readonly environmentVersion: string; readonly evaluatorVersion: string }
): ReplayResult;
```

`rerunHash` must include `cache` when provided. Two calls that differ only in `candidateHash` must not share `rerunHash`.

- [ ] **Step 1: Write the failing test (spec case 22)**

```ts
it("does not reuse a replay hash across candidate hashes", () => {
  const a = replayPolicy(manifest, episodes, policy, out, {
    candidateHash: "aaa",
    environmentVersion: "env-1",
    evaluatorVersion: "ev-1"
  });
  const b = replayPolicy(manifest, episodes, policy, out, {
    candidateHash: "bbb",
    environmentVersion: "env-1",
    evaluatorVersion: "ev-1"
  });
  assert.notEqual(a.rerunHash, b.rerunHash);
  assert.notEqual(
    replayCacheKey({ runId: "run_a", candidateHash: "aaa", environmentVersion: "env-1", evaluatorVersion: "ev-1" }),
    replayCacheKey({ runId: "run_a", candidateHash: "bbb", environmentVersion: "env-1", evaluatorVersion: "ev-1" })
  );
});
```

- [ ] **Step 2–4: RED / fold `cache` into the existing `stableStringify` hash / GREEN**

---

### Task 4: Cost CI upper bound blocks promotion claims

**Files:**
- Modify: none if `validateComparisonReport` already implements this
- Test: add an explicit case 23 next to existing comparison-report tests

- [ ] **Step 1: Write the test even if you expect it to pass (locks the spec)**

```ts
it("rejects improve when mean cost is fine but the cost CI upper bound exceeds the cap", () => {
  const records: PairedEvaluationRecord[] = [
    { episodeHash: "h1", taskFamily: "bugfix", baselineUtility: 0.3, candidateUtility: 0.7, baselineCostUsd: 1, candidateCostUsd: 0.5 },
    { episodeHash: "h2", taskFamily: "bugfix", baselineUtility: 0.3, candidateUtility: 0.7, baselineCostUsd: 1, candidateCostUsd: 0.5 },
    { episodeHash: "h3", taskFamily: "bugfix", baselineUtility: 0.3, candidateUtility: 0.7, baselineCostUsd: 1, candidateCostUsd: 0.5 },
    { episodeHash: "h4", taskFamily: "docs", baselineUtility: 0.3, candidateUtility: 0.7, baselineCostUsd: 1, candidateCostUsd: 0.5 },
    { episodeHash: "h5", taskFamily: "docs", baselineUtility: 0.3, candidateUtility: 0.7, baselineCostUsd: 1, candidateCostUsd: 2.5 }
  ];
  // cost deltas: -0.5,-0.5,-0.5,-0.5,+1.5 → mean -0.1, CI upper bound > 0
  const meanCandUtil = 0.7;
  const meanBaseCost = 1;
  const meanCandCost = (0.5 * 4 + 2.5) / 5;
  const evalCard = createEvaluationCard({
    ...CARD_BASE,
    baseline: { utility: 0.3, costUsd: meanBaseCost, uncertainty: 0.02 },
    candidate: { utility: meanCandUtil, costUsd: meanCandCost, uncertainty: 0.03 }
  });
  const report = computeComparisonReport(records, evalCard, ["adaptive is better"]);
  assert.ok((report.costDelta.mean ?? 0) <= 0);
  assert.ok((report.costDelta.confidenceInterval?.upper ?? 0) > 0);
  const v = validateComparisonReport(report);
  assert.equal(v.valid, false);
  assert.ok(v.reasons.some((r) => /cost/i.test(r)));
});
```

`CARD_BASE` is the existing helper in `test/unit/experiments/comparison-report.test.ts`. If this already passes, keep the test as the lock. If it fails because the validator uses the mean, change the gate to `costDelta.confidenceInterval.upper <= maxCostIncreaseUsd`.

---

### Task 5: Promotion ledger rebuilds the pointer

**Files:**
- Modify: `src/adaptation/promotion.ts` only if a rebuild helper is missing
- Test: Modify `test/unit/adaptation/promotion.test.ts`

**Interfaces:**

```ts
export function reconstructPromotion(ledger: readonly PromotionLedgerEntry[]): {
  readonly parentVersionId: ResourceVersionId;
  readonly candidateId: CandidateId;
  readonly expectedCurrentVersionId: ResourceVersionId;
  readonly toVersionId?: ResourceVersionId;
  readonly approvedBy?: AuthorIdentity;
  readonly rollbackVersionId?: ResourceVersionId;
};
```

Walk the ledger in order. Last successful `promoted` entry wins. `changeNote.rollbackVersionId` is the rollback target.

- [ ] **Step 1: Write the failing test (spec case 24)**

```ts
it("rebuilds parent, candidate, expected version, and rollback target from the ledger", () => {
  const reg = registry();
  const id = identity();
  const baseline = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
  const candidate = reg.createCandidate({
    identity: id,
    content: "v2",
    parentVersionId: baseline.versionId,
    author: AUTHOR,
    evaluationPlan: PLAN
  });
  const result = promoteWithRegistry(reg, promoteInput(candidate.candidateId, baseline.versionId, "v2"));
  assert.equal(result.ok, true);
  const rebuilt = reconstructPromotion(reg.ledger());
  assert.equal(rebuilt.candidateId, candidate.candidateId);
  assert.equal(rebuilt.expectedCurrentVersionId, baseline.versionId);
  assert.equal(rebuilt.toVersionId, reg.getActiveVersion(id)?.versionId);
  assert.equal(rebuilt.rollbackVersionId, baseline.versionId);
});
```

`registry`, `identity`, `promoteInput`, `AUTHOR`, `PLAN` are the existing helpers in `test/unit/adaptation/promotion.test.ts`.

- [ ] **Step 2–4: RED / implement / GREEN**

---

### Task 6: Rollback pointer matches the next execution

**Files:**
- Modify: none if `rollbackActive` already CAS-sets the pointer
- Test: `test/unit/adaptation/rollback.test.ts` + a small pointer read

- [ ] **Step 1: Write the failing test if missing (spec case 25)**

```ts
it("after rollback, getActiveVersion matches the rollback ledger target", () => {
  const reg = registry();
  const id = identity();
  const parent = reg.registerBaseline({ identity: id, content: "v1", author: AUTHOR });
  const candidate = reg.createCandidate({
    identity: id,
    content: "v2",
    parentVersionId: parent.versionId,
    author: AUTHOR,
    evaluationPlan: PLAN
  });
  const promoted = promoteWithRegistry(reg, promoteInput(candidate.candidateId, parent.versionId, "v2"));
  assert.equal(promoted.ok, true);
  const child = reg.getActiveVersion(id);
  assert.ok(child);
  const result = rollbackActive(reg, {
    identity: id,
    expectedCurrentVersionId: child.versionId,
    targetVersionId: parent.versionId,
    reason: "guardrail",
    evidence: ["guardrail-regression"],
    automatic: true
  });
  assert.equal(result.ok, true);
  assert.equal(reg.getActiveVersion(id)?.versionId, parent.versionId);
  assert.equal(result.ledger.at(-1)?.toVersionId, parent.versionId);
  assert.equal(result.ledger.at(-1)?.toVersionId, reg.getActiveVersion(id)?.versionId);
});
```

- [ ] **Step 2: Run. If already PASS, leave the test as the lock. If FAIL, fix `rollbackActive` so the in-memory active pointer and ledger `toVersionId` are the same value.**

---

### Task 7: Phase D quality gate

- [ ] **Step 1: Run** `corepack pnpm exec tsx --test test/unit/learning/auto-loop.test.ts test/unit/adaptation/approval-profile.test.ts test/unit/adaptation/promotion.test.ts test/unit/adaptation/rollback.test.ts test/unit/adaptation/registry.test.ts`

- [ ] **Step 2: Run** `corepack pnpm test` **and** `corepack pnpm run typecheck` **and** `corepack pnpm run lint`

- [ ] **Step 3: Confirm `adapt status` no longer advertises auto-promote. Confirm Checkpoint F / ADR-005 status is still Open.**

---

## Handoff

Program complete when A–D quality gates are green. Do not claim Outcome-supported routing. Next design work is only the still-open ADR-005 questions, not more implementation.
