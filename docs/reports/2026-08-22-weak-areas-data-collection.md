# Weak-areas data collection — 2026-08-22

Purpose: raw measurements against the low-scoring dimensions of the
2026-08-22 self-assessment, for owner analysis. Each finding lists evidence
and, where applicable, candidate optimizations. **No optimization decisions
are made here.**

---

## 1. 实际效果证明 (score 2/10)

### 1.1 Real-provider runs (openrouter-ox/stealth/ox-alpha)

| Run | Outcome | Latency | Notes |
|---|---|---|---|
| run_3e1e2ba1 (CLI) | **COMPLETED** | 31.9s | first real end-to-end run |
| PI_SMOKE suite | **pass** | 21.1s | after factory fix |
| 3 batch runs + 1 retry | FAILED ×4 | 1.5–1.7s each | upstream 429 (shared pool), see 1.3 |

### 1.2 Usage telemetry defect — FOUND & FIXED

- **Defect**: `translatePiEvent` dropped the assistant message's usage on
  `turn_end`; every invocation recorded `tokensIn/tokensOut: undefined`.
  Cost-quality gates (ADR-005) are impossible without this.
- **Fix**: extract `usage.{input,output}` on assistant `turn_end`
  (`pi-executor.ts`, regression-tested in `translate-usage.test.ts`).
- **Residual observations**:
  - Errored invocations (429) record `tokensIn: 0` from the error payload's
    zeroed usage — candidate: exclude non-SUCCESS invocations from cost
    aggregates.
  - The one COMPLETED run predates the fix → its tokens are undefined. Fresh
    token data requires new runs once the upstream pool recovers.

### 1.3 No retry/backoff on 429 — optimization candidate (high)

- A 429 fails the agent immediately; run limits (`maxAttemptsPerTask: 3`)
  did not re-drive the executor. Evidence: 4 consecutive FAILED runs at
  ~1.6s, while `curl` confirmed upstream recovery ~20 min later.
- Candidate: 429-aware backoff (respect `remedy_hint`/Retry-After) at the
  executor or supervisor layer.

### 1.4 Outcome-supported remains 0 (by design)

- F-SIM machinery exists and is tested (`r1-shadow-report`,
  `comparison-report`, `simulation-holdout`), but zero production outcome
  rows exist. F-PROD needs: P0 sign-off (done pending owner) ✓, provider
  smoke (done) ✓, holdout data source (open).

---

## 2. 生产就绪 (score 3/10)

### 2.1 Package composition (npm pack --dry-run)

- tarball 542.7 kB, unpacked **2.6 MB**, **839 files**, of which **412 are
  .js.map**. Candidate: strip sourcemaps from the published package or ship
  a separate source-map artifact.

### 2.2 Legacy layout migration — fail-closed confirmed

- Flat pre-2026-08-22 data (`feedback/records.jsonl`,
  `runs/<id>/events.jsonl` at the state root) is **invisible** to the new
  plane-aware code (verified live: readFeedback → [], EventStore → []).
- Consequence: any external user upgrading loses access to old data with no
  error. Candidate: one-shot `pi-sparkle migrate-legacy` command, or a
  startup warning when legacy paths exist.

### 2.3 Retention is unbounded (Q3 accepted, numbers for context)

- Measured: ~4.9 KB/run, ~1.1 KB/episode file pair, ~200 B/invocation.
- 14 runs + 28 episode files + 4 invocations ≈ 100 KB total. Small per unit,
  unbounded over time.

### 2.4 doctor output contract unfrozen (confirmed)

- No `--json` flag; output is prose only. Any tooling that wants machine
  output today must parse text. Candidate: freeze a JSON contract + add
  `--json`.

---

## 3. 功能完整度 (score 8/10)

### 3.1 `compileChildrenToFlowchart` — status-matrix row was STALE

- Wired at `src/cli/main.ts:718` (and `src/track/loop.ts`). The status
  matrix row "Wired=no" is outdated and has been corrected.

### 3.2 Real-provider coverage of `--children` / `--track` paths

- Only the single-task `run --executor pi` path has real-provider evidence.
  `--children` with `--executor pi` and `--track` with real routing are
  untested against a live model (blocked by the 429 window today).
  Candidate: rerun the matrix when the upstream pool recovers.

---

## 4. 隐私设计 (score 8.5 → real gap found)

### 4.1 `redactPII` is a NO-OP label — probe results

Probe: 12 sample bodies through `redactFeedback` with
`{ redactPII: true, maxBodyChars: 400, forbiddenSubstrings: [sk-, api_key,
API_KEY, BEGIN PRIVATE] }`:

| Sample | classes | body after |
|---|---|---|
| `sk-proj-abc…` key | secret, pii | `proj-abc…` **key body survives** |
| `api_key=abc123` | secret, pii | `=abc123` **value survives** |
| `BEGIN PRIVATE KEY` block | secret, pii | header stripped, **base64 body survives** |
| email | pii | **unchanged** |
| IPv4 | pii | **unchanged** |
| phone (+1-555…) | pii | **unchanged** |
| CN phone 138… | pii | **unchanged** |
| credit card 4111… | pii | **unchanged** |
| `/home/john/.ssh/id_rsa` | pii | **unchanged** |
| >400 char body | pii, oversized | stripped ✓ |

Root cause (`src/feedback/redaction.ts`): `if (policy.redactPII) {
classes.add("pii"); }` — the flag only labels, never transforms.
`stripForbidden` removes literal substrings only. `path` and
`prompt-injection` classes are declared in the type but have no
implementation anywhere.

Candidates (owner decision): (a) real PII regex pass (email/IP/phone/card/
CN-mobile), (b) value-aware secret stripping (`key[:=]\s*\S+` patterns),
(c) implement `path` class, (d) or demote the claim: rename the flag to
`labelPII` and document that dataset hygiene relies on body exclusion.

### 4.2 Everything else holds

- Plane isolation, tombstones, delete cascade: verified live (§8 of the
  review package). Completeness/boundary guards green (12/12).

---

## 5. Data files

Raw probe outputs are reproduced inline above; live state-root metrics:
`runtime/` 47 files / ~100 KB, `adaptation/feedback/` 2 files.
