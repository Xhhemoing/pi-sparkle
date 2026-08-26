# Loop 5 · Round 1 — Comprehensive review

Reviewer: Round 1 comprehensive reviewer (claude-fable-5-thinking-xhigh). Analysis only; no `src/` edits, no commit by this agent.

Reviewed at HEAD `679553e` (`feat(cli): dispatch list and init from the main CLI`) on `cursor/pi-sparkle-sota-opt-0da8`, working tree clean at review time. Note: the parent landed `3bfdc65` (README rows + D6 resolution) and `679553e` (list/init dispatch + `main-dispatch.test.ts`) **while this review was running**, and as the review closed an uncommitted parent diff appeared fixing the §2.2 validate-catalog finding. Everything below is measured against `679553e` unless marked in-flight; the Fable reports saw an earlier mid-flight tree.

Inputs: `docs/agent-progress.md`, `docs/agent-decisions.md`, all seven `.agent_workspace/loop5-r1-*.md` reports, git log/diffs of the six Round 1 landing commits, and direct reads of `src/cli/main.ts`, `validate.ts`, `list.ts`, `init-examples.ts`, `children-spec.ts`, `flowchart-io.ts`, `model-catalog.ts`, `src/run/inventory.ts`, and the five new test files.

Verification run at HEAD: `pnpm typecheck` clean; the five new-command test files pass (40/40); the nine USAGE-consumer / source-pin freeze tests from GPT-frozen §4 pass (82/82); `cli.test.ts` + doctor + inspect-summary + terminal-replay freeze + live-isolation + pi-manifest pass (67/67); `main-dispatch.test.ts` passes (5/5).

---

## 1. What Round 1 completed vs still unwired

### Completed and verified

| Deliverable | State | Evidence |
|---|---|---|
| `validate` (children + flowchart) | **Shipped, dispatched, tested** | `fbc8d13` merged at `2c23a2c`; `case "validate"` in the switch; tests drive it *through* `main()`; exact-shape `VALIDATE_OK` pins for both kinds; no-write proven by an empty-`HOME` assertion; failure prints nothing on stdout |
| `parseChildSpec` extraction | **Done, one decoder** | Moved to `src/cli/children-spec.ts`; `main.ts` and `validate.ts` both import it; no `main ⇄ validate` cycle; no second schema language (the D4 seam Fable-cli flagged as blocking was resolved exactly as recommended) |
| `list` (runs + episodes) | **Shipped, dispatched, tested** | `1fef2b4` + dispatch in `679553e`; all eight `RunStatus` values via shipped `replayRun`; empty log skipped (no `replayRun([])`); unreadable records surfaced on stderr and in `errors[]`; `RUN_LIST`/`EPISODE_LIST` pinned; read-only |
| `init` | **Shipped, dispatched, tested; D6 resolved KEEP** | Rescued from untracked into `c40539c` ("Preserve the unwired init example module so it cannot be lost to a clean"), dispatched in `679553e` **after** D6 was resolved in `3bfdc65` — the "do not wire until synthesis" ordering was respected. Embedded-constant design; refuses overwrite before writing either target; `examples/` byte-identity pinned |
| Dispatch regression coverage | **Done** | `test/unit/cli/main-dispatch.test.ts` (in `679553e`) pins that `list`/`init`/`validate` reach their own commands and unknown commands still get the routed report. Without this, no test would have failed if a merge dropped a switch case (list/init unit tests call their command functions directly) |
| README discoverability (partial) | **Done for the big items** | `3bfdc65` adds rows for `list`, `validate`, `init`, **`unblock`** (Fable-map gap #2, previously zero README occurrences), and `adapt eval`/`adapt rollback`; `679553e` adds `adapt eval` and `adapt rollback` lines to the exported `USAGE` (Fable-adapt G3 / Fable-cli G5, partially) |
| Contract discipline | **Held** | `VALIDATE_OK`, `RUN_LIST`/`EPISODE_LIST`, `INIT_EXAMPLES` are all non-event, `preview: true`, key-pinned day one, per D3. INSPECT_SUMMARY, doctor JSON/routes, eight-member `RunStatus`, live-isolation closure, four-executor pin, blocked-next source pins: all freeze tests green at HEAD |

Slot accounting: Opus-validate delivered in full. Opus-list and Opus-init delivered modules + tests but never produced `loop5-r1-*.md` reports and never wired dispatch (their one-case grant went unused); the parent wired both. Fable-runtime's F1/F2 ("finished, tested, unreachable / one `git clean` from vanishing") were accurate when written and are now fully resolved.

### Still unwired / not delivered

- **Nothing from the three bets remains unwired.** The one Round 1 deliverable-shaped gap: Opus-list/Opus-init reports are missing from `.agent_workspace/`, so their design rationale exists only in code comments and commit messages.
- `docs/status-matrix.md` has no rows for the three new verbs (last touched pre-Loop-5). Minor docs drift, not a Round 1 obligation.
- Everything in §3 "open problems" below was analyzed but deliberately not built this round.

---

## 2. Duplicate / conflict / regression risks

1. **PR #12 is still OPEN — the merge-order collision GPT-challenge §5 predicted is now live in both directions.** [PR #12](https://github.com/Xhhemoing/pi-sparkle/pull/12) edits `main.ts`, README, `adapt.ts`, `package.json`, `ci.yml`, and adds `readme-command-parity.test.ts`; this branch's [PR #13](https://github.com/Xhhemoing/pi-sparkle/pull/13) now edits the same `main.ts` import/USAGE/switch regions and README table. Whichever merges second must keep all sibling USAGE lines, all README rows, `--max-cost-usd`, and `inspect --follow`. Mitigating: the new verbs already have README rows, so #12's parity test should pass post-reconciliation — but the conflict resolution itself is the risk to supervise. No duplication occurred (verified: nothing here touches inspection follow, cost caps, or `package.json`).
2. **`validate --flowchart` overclaimed run parity — a shipped honesty gap, not caught by any Round 1 report; fix in flight as this review closed.** At `679553e`, `VALIDATE_USAGE` said the flowchart path "runs … the same CLI catalog check run --flowchart applies, so a node naming a model outside the catalog fails." In code, `validateCommand` called `parseFlowchartFile(path)` with no catalog ids, so `assertFlowchartModelsInCatalog` defaulted to the static `["cheap", "premium"]` catalog (`model-catalog.ts:83-86`), while `run --flowchart` checks against the **live** catalog from `buildLiveCatalogConfig(stateRoot)` (`main.ts:700-704`). Divergence was one-directional: a flowchart naming a real enabled model id (e.g. `anthropic/...`) **failed validate** with `CLI catalog: cheap, premium` **but runs fine**, because the live catalog contains the enabled ids plus cheap/premium aliases. So "validate green ⇒ run green" held, but "validate red ⇒ run red" did not — a symmetry the USAGE claimed and the code lacked. GPT-frozen's gate said "state the validation scope honestly"; the children half disclosed its catalog caveat correctly, the flowchart half did not. **Status while this review was being written:** an uncommitted parent diff on `validate.ts`/`validate.test.ts`/`main.ts`/README implements the strong fix — the flowchart path now loads `buildLiveCatalogConfig(stateRoot)` with a `--state-root` flag, the USAGE states the read honestly, and `VALIDATE_OK` gains `catalogSource`/`stateRoot` with pin updates in the same diff (legal frozen-additive). Verified against the modified tree: typecheck clean, `validate.test.ts` + `main-dispatch.test.ts` 17/17. Remaining before commit: confirm the no-write assertion still guards the new read path and re-run the broader freeze set once committed.
3. **`INIT_EXAMPLES --json` is the CLI's only pretty-printed machine object** (`JSON.stringify(..., null, 2)`), flagged by Fable-cli §3.3 fix 1 and shipped anyway. The test pins keys via `JSON.parse`, not line shape, so compacting later is pin-safe — but it should happen before external scripts ossify the multi-line form. Small, time-sensitive.
4. **Init test half-applies Fable-cli fix 3.** The flowchart example goes through the real `validateFlowchart`; the children example is only hand-shape-checked, never fed through `parseChildSpec`/`compileChildrenToFlowchart` (or through the now-available `validateCommand`). If children-spec validation ever tightens, the scaffold could emit a spec `validate` rejects and no test would notice. One-test fix.
5. **`list` default ordering shipped as lexicographic-by-id, not recency** — the contract decision Fable-cli asked to settle "deliberately" was settled by default. It is honest (USAGE says "ordered by id") and a future `--sort`/recency flag is additive, so this is accepted-with-eyes-open, not a defect. Do not churn the day-old contract now.
6. **Parent exceeded D4's letter, benignly.** `679553e` also added `adapt eval`/`adapt rollback` USAGE lines — owned by no Round 1 slot, but recommended by two reports, docs-true (both subcommands exist), and all pinned fragments (the exact `adapt promote` line, unblock lines, thinking levels, resume wrap) verified green. Record as a parent action so the audit trail matches the diff.
7. **No regression found in frozen surfaces.** Doctor stays PLANNING/RUNNING-only; `INSPECT_SUMMARY` untouched; no ninth status; no new event types; no executor construction in new commands; live-isolation closure unchanged; `package.json` untouched. The `main.ts` net diff is imports + switch cases + USAGE lines + the `parseChildSpec` block *removal* (moved out), which also kept `blocked-next.test.ts`'s body heuristics green.

---

## 3. Resolved vs open problems

### Resolved this round

- No untargeted run/episode discovery (Round 0 gap #1) → `list`.
- No no-write spec check (gap #2) → `validate`, with the parser seam closed by extraction, not duplication.
- No spec-authoring on-ramp / no `examples/` / flowchart JSON shape undocumented (gap #3) → `init` + committed `examples/` + README rows.
- D6 (`init` KEEP vs REPLACE) → resolved KEEP on the `files[]` packed-install argument, recorded in the decisions doc before wiring.
- `unblock` invisible in README (Fable-map #2) → row added.
- `adapt eval`/`rollback` hidden from top-level USAGE and README (Fable-adapt G3, part) → lines/rows added.
- `init`'s `next: pi-sparkle validate` cross-slot coupling (Fable-cli §3.3 fix 2) → resolved by landing order (validate wired first).
- Dispatch-drop regression risk → `main-dispatch.test.ts`.

### Open (verified still present at HEAD)

- **Track-clarification dead end** (Fable-runtime F4): `inspectRun` still collects questions only from `AGENT_MESSAGE`/`QUESTION` (`src/run/inspection.ts:136`); `track-questions.json` still has no reader outside the deletion residual scan; `answer --message --text` on a clarification run is still recorded and never consumed; continuation is still a fresh run that strands the old one in `WAITING_FOR_USER`. Now *more* visible, not less: `list` surfaces every stranded clarification run with no verb that resolves it.
- **Adapt promotion pipeline unusable through supported tooling** (Fable-adapt G1/G2): `src/cli/adapt.ts` untouched this loop; promote still needs a hand-extracted content blob, a hand-authored review file whose required `actorId` no command prints, and an eval dataset **nothing can produce**; active version/ledgers still invisible.
- **Delete disclosure overclaim** (Fable-persist F1): "a wait that runs out removes nothing" still at `main.ts:1889` and `docs/data-dictionary.md:114`, while the engine completes the invocation-log/feedback half before the lock wait by design. F4's `--lock-wait-ms` non-propagation to the invocation-log lock also unchanged.
- **USAGE drift remainder** (Fable-cli G5): the garbled `--track` paragraph (sentence ends "…spawn depth ≤ 2 / 4 per parent)." then restarts mid-sentence "predecessor artifacts, assigns other catalog models…") is still in `main.ts`; `episode close` still omits `[--outcome <id>]`; `pause`/`inject` value flags still placeholder-less; `run --children` line still omits `--primary-model`/`--fast-model`; `adapt learn/auto` lines still omit `--primary-model`.
- **Circular not-found remedies** (Fable-cli G6): `missingRun` and friends still answer "run X not found" with the command that just failed; none are pinned; `list` now exists as the correct retarget.
- Legacy pre-split state invisible to migrator/doctor, including the secret-bearing `auth.json` orphan (persist F2); migrated legacy copies invisible to delete/residual scan (F3); retention-probe unregistered with a misleading per-run metric and no doctor storage inventory (F5); no feedback list/per-record delete (F6); doctor learned-state inventory misses four fail-closed adaptation files (F7); residual-scan scope prose (F8); episode-delete → `pref list` pointer (F9).
- Runtime journey gaps (Fable-runtime F5–F12): BLOCKED recovery guidance print-once; approvals id-only; no stop verb / no SIGINT handler (kill → stale lock → manual rm); `pause` speaks flowchart-only on every plane; plain `resume` on a supervised run success-looking no-op; `answer` non-flowchart no next step; PAUSED exit-code divergence between planes; parent delete doesn't name surviving child runs.
- Stale `candidate` record-class sentence ("content is stored as hash, not body" vs persisted `contents[]` blobs) (Fable-adapt G5) — small but P0-adjacent.
- No cost/usage report verb (Fable-map #5) — cap (PR #12) without a report.
- Two error dialects across `auth`/`models`/`pref`/`adapt`/`commits`/`delete` arg paths (Fable-cli G4).
- New this review: the `validate --flowchart` catalog-parity overclaim (§2.2) and the `INIT_EXAMPLES` pretty-print (§2.3).

---

## 4. Modules still uncovered

Round 1 covered the CLI surface (Fable-map, Fable-cli), run/track/cluster journeys at the CLI seam (Fable-runtime), adaptation/learning (Fable-adapt), persist/privacy/telemetry stores (Fable-persist), and frozen contracts (GPT-frozen). Not audited by anyone this round:

- **`src/context/`** (context packets) and **`src/tracking/`** (gate/prescore) — only importer-traced, never UX-audited.
- **`src/cluster/`** internals (peer mail, spawn budget, dead-letter beyond the one stderr warning) — journey-level only.
- **`src/pi-adapter/` + `auth`/`models` UX depth** — touched only for error-dialect classification; no audit of the login/enable/set-default operator flow, `--from-env`/`--oauth` docs, or failure modes.
- **`commits` verb flow** and **`episode`/`inject` UX** — inventoried, not exercised.
- **`src/review/`, `src/rubric/`, `src/evaluation/`, `src/requirement/`, `src/protocol/`** — untouched by any report.
- **Windows behavior of the new verbs** — CI runs a Windows `cli-smoke`, but nothing establishes whether it exercises `list`/`validate`/`init` path handling (`list` builds paths with `join`, examples write with `resolve` — likely fine, unverified).
- **`list` at scale** — it replays every run's full event log per invocation; fine for a preview, but unmeasured and worth one line in a future bench pass, not a slot.
- **`docs/` beyond README** — status-matrix rows for the new verbs; the how-to/walkthrough layer generally (Fable-adapt item 4 is the one concrete proposal).

---

## 5. Ranked Round 2 priorities (high-value only)

1. **Close the track-clarification dead end** (Fable-runtime F4). The first-run interactive path strands runs with an invisible question, a dead `answer`, and no resume — and `list` now parades those stranded runs in front of the operator. The cheap, freeze-safe version per the runtime report: `inspect` renders the clarification question(s) + continuation guidance from `track-questions.json`/the `RUN_WAITING_FOR_USER` payload (additive lines, `--summary-json` untouched), and `answer` against a clarification run either refuses with the correct `run --track --answers` continuation or writes the answers file. A true resume of the *same* run is a bigger bet — do the refusal+guidance version first. Highest pain-to-risk ratio left in the tree.
2. **`adapt show --candidate` + `adapt dataset --run`** (Fable-adapt items 1+2). The only auto-proposed candidate kind cannot currently be promoted with supported tooling; these two read-only verbs convert a finished safety architecture into an operator workflow while changing zero policy semantics. `show` alone unblocks the content/review/`--expected` half; `dataset` closes the eval-file half and carries the one privacy caution (exported manifests hold objective text → new record-class entry + existing redaction posture; D3 adaptation-plane guard applies). If Round 2 has one adaptation slot, take `show`; if two, take both.
3. **Delete-disclosure honesty batch** (Fable-persist F1 + F4 rider). Correct `DELETE_USAGE` and `docs/data-dictionary.md` to state the real contract (adaptation/telemetry half completes first and stays completed; the lock-guarded removal is what a timeout refuses; re-delete idempotent), add the one pre-lock stderr disclosure line, and pass `options` through to `dropRunFromInvocationLog`. Verified unpinned (the "removes nothing" test uses a fixture with no invocation rows). A privacy surface making a false claim about itself outranks its small diff size; P0 sign-off is still open and this is exactly what a reviewer will find.
4. **`validate --flowchart` catalog honesty** (new, §2.2) — **being fixed in-flight by the parent as this review closed** (live-catalog stage + `--state-root` + honest USAGE + additive `catalogSource`/`stateRoot` keys; 17/17 targeted tests green on the modified tree). If that diff lands, this slot reduces to its riders: the `INIT_EXAMPLES` compact-JSON fix and the children-example-through-real-parser test (§2.3–2.4) — same "fix before ossification" clock.
5. **README/USAGE discoverability remainder** (Fable-cli G5 + G6, Fable-map #1). One docs-and-strings slot: fix the garbled `--track` paragraph (the duplication removal touches no pinned fragment — verified by Fable-cli §4.5); add `episode close [--outcome <id>]`, pause/inject placeholders, `run --children` model flags, `adapt learn/auto --primary-model`; retarget the circular `missingRun`/`pause`/`episode` not-found remedies onto `pnpm cli list` (unpinned, verified); add status-matrix rows for the three new verbs; fix the stale `candidate` record-class sentence (adapt G5 rides along). Constraint: leave every §4-pinned fragment byte-identical, and sequence README edits against PR #12's merge.
6. **Keep `init` wired — yes, affirm D6.** The KEEP decision is sound and this review found no reason to reopen it: the packed-install argument is real (`files[]` ships `dist`; a checkout-only `examples/` never reaches an installed binary), the GPT REPLACE position's strongest half (static examples for repo browsers) was *also* shipped, the verb is ~170 lines with a correct check-both-before-writing-either overwrite contract, and it is now load-bearing (README + USAGE + dispatch test + the `next:` chain from init → validate). Reversing it would be churn without a defect. The only follow-ups are slot 4's riders. Do not let it grow into a project cookiecutter (D6's own closing line).
7. **Legacy-state detection, secrets first** (Fable-persist F2, detection half). Extend `LEGACY_STATE_ENTRIES` so doctor names pre-split `auth.json` (with an explicit "may contain credentials; read by nothing" advisory), `preferences.json`, `providers.json`, `learning/`, `episodes/`, `invocations.jsonl`. Purely additive to an informational check. The migration half (`LEGACY_SOURCES` extension, auth policy) is a separate, larger decision. A plaintext-credential orphan that `auth logout` doesn't reach is the one item here with security weight.

Explicitly below the cut this round (real, not padded, but displaced by the above): cost/usage report verb (map #5 — good candidate once PR #12's cap lands and merge dust settles); SIGINT/stop handler (runtime F7 — posture-preserving but needs its own design review as a new lifecycle writer); doctor storage inventory (persist F5); feedback list (persist F6, list half); error-dialect unification (cli G4 — ~25 sites, per-site pin audit required); BLOCKED-recovery-in-inspect + approval labels (runtime F5/F6 — worthy riders if a runtime slot opens); doctor learned-state additions (persist F7).

---

## 6. Explicit NO_HIGH_VALUE_CHANGE_FOUND areas

- **Re-auditing frozen Loop 4 honesty contracts** — zero-slot by construction (D1); all freeze tests green at HEAD; nothing this round strained them.
- **The three Round 1 bets themselves** — delivered; no re-scoping or re-litigation warranted, including `init` KEEP (see §5.6) and `list`'s id-ordering default (honest, documented, additive-extensible; churning the day-old contract would be negative value).
- **Shell completions** (cli G8) — nothing exists; correctly deferred until a generated single-source command table exists; a third hand-maintained surface would recreate G5.
- **Shadow/R1/holdout/experiments CLI exposure** — blocked by Checkpoint F-PROD, ADR-005, and the live-isolation closure; a read-only shadow report remains low preview value. Parked.
- **Wiring `monitor`/`mutate`/`reflection`/`pareto`/`retirement`** (adapt G4) — would mint candidate kinds `adapt eval` cannot evaluate, creating promotable-without-eval pressure; the eval-first ordering is the guardrail. Parked with rationale recorded.
- **Retention bounding / gc / auto-cleanup** — accepted open policy (Q3); only diagnostics may move (persist F5 is the diagnostic, ranked below the cut, not a policy change).
- **Cluster dead-letter persistence** — runtime semantics change, not a usability slot; out of Loop 5 scope as Fable-map concluded.
- **Pi extension registration** — ADR-006 stays Proposed; no report challenged that.
- **SQLite/indexed run listing** — ADR-002's boundary holds; the filesystem inventory shipped and suffices at preview scale.
- **`package.json` edits of any kind** (probe aliases, `files[]`, dependencies) — frozen this campaign and collision-locked with PR #12; the probe-alias gap (map #9) stays deferred, not denied.
- **Auto-promotion, live `selectArm`, live topology** — no report proposed them; D3 held without strain in every diff this round.
