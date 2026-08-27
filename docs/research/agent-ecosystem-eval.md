# Agent ecosystem evaluation and optimization plan — R3 final

Research input, not implementation authority. The status matrix, ADRs,
executable tests, and current repository code take precedence over every
sentence here. Public-vendor rows describe what those projects' own docs say on
the pages listed in §5; they are not a source audit of those products.

Round 1 cells were verified against branch `cursor/agent-market-eval-opt-cae9`
at commit `21b8dc9` (whose `src/`, `docs/`, and `test/` were byte-identical to
main HEAD `80eb0bd`). The Round 2 synthesis was written on 2026-08-25 against
commit `60ae1ea` plus Round-2 working-tree edits that were landing in parallel
and uncommitted at the time of writing. Those edits are now committed: Round 3
re-verified every §9 H0 status against the committed tree at `5c1421c`
("feat: close Round 2 H0 honesty and live-follow gaps", 2026-08-25), re-ran
the probes and the H0 tests green (§0), and this document is **final for the
2026-08-25 market-eval loop**. Changing its claims again requires a new loop,
not an edit.

## 0. Round-3 status of this document — final

This is the **Round 3 final** of a three-round loop: a Round 1 draft, promoted
to a Round 2 synthesis, now verified against the committed tree and closed.
Round 2 folded the six parallel Round-1 evidence files:

| Ref | File | What it contributed |
|---|---|---|
| E1 | [r1-fable-a.md](../../.agent_workspace/r1-fable-a.md) | 14-product architecture survey: four-layer extension stack, control-flow paradigms, steal/don't-steal patterns |
| E2 | [r1-fable-b.md](../../.agent_workspace/r1-fable-b.md) | Source-level scorecard of this repo; re-check of the six acceptance properties; found the property-6 drift (§8) |
| E3 | [r1-opus-a.md](../../.agent_workspace/r1-opus-a.md) | Executed inventory of all CLI verbs; transcript-proven defects that §4.6 folds as this-repo residuals |
| E4 | [r1-opus-b.md](../../.agent_workspace/r1-opus-b.md) | Working notes behind the R1 draft of this document: cell rationale, self-declared gaps |
| E5 | [r1-gpt-a.md](../../.agent_workspace/r1-gpt-a.md) | Repeatable baseline probe (`scripts/market-eval-probe.mjs`) and its Round-1 output |
| E6 | [r1-gpt-b.md](../../.agent_workspace/r1-gpt-b.md) | URL-sourced product/extension-API/benchmark tables; nearest-neighbor and lifecycle-trap evidence |

What Round 2 changed, in one place:

- Framing promoted from draft to synthesis; the six evidence files above are
  now citable refs (E1–E6) alongside repo refs (R\*) and public pages (S\*).
- The fifth cell marker `n/a` is **retired** and the MCP column is dropped from
  the product tables (§2 ruling; MCP is discussed in prose and in
  [mcp-position.md](mcp-position.md), which landed in parallel with this
  synthesis).
- Three cell movements, each evidence-driven and listed in §4's notes:
  OpenHands A1 `Partial → Present` (official SDK docs), Goose A4 re-sourced
  from a secondary blog to official recipe docs (stays `Partial`), and
  **this project's own A3 `Present → Partial`** (a transcript-proven defect,
  §4.6 item 3).
- New sections: closest neighbors (§4.4), lifecycle traps (§4.5), this-repo
  residuals (§4.6), and the SOTA acceptance gap (§8).
- §9 H0 now records what Round 2 is actually landing rather than proposing.

What Round 3 changed — verification and close-out, no new comparative claims:

- Every §9 H0 item Round 2 reported as "landed in the working tree" is now
  **committed** at `5c1421c` and cited by file; the hedge "in-tree at the
  time of writing" is retired from this document.
- **A3 for this project returns `Partial → Present`** (§4.1): the fail-closed
  answer correlation is committed and pinned by
  `test/integration/cli/answer-correlation.test.ts` [R12], re-run green in
  Round 3.
- **§8 flips from "drifted, closing" to "restored, pinned by test"**:
  `test/unit/cli/readme-command-parity.test.ts` passed against the committed
  README in Round 3.
- The C3 comparative row is retired, executing §10 ruling 1 — Round 3 sourced
  no competitor privacy lifecycle, so the row's survive-condition failed;
  this project's self-assessment is preserved as prose in §4.3.
- Round-3 probe evidence: R3-gpt-A re-ran `pnpm market:eval`, `pnpm pi:probe`,
  `pnpm security:probe`, the isolation/boundary/manifest tripwire tests, and
  `rg -i mcp src/` (empty) against the committed tree, all green
  ([r3-gpt-a.md](../../.agent_workspace/r3-gpt-a.md), cited as E7). This
  edit's author re-ran the five H0 test files (answer correlation,
  `inspect --follow`, cost-stop refusal, probe pin, README parity): 32/32
  pass ([r3-fable-b.md](../../.agent_workspace/r3-fable-b.md), cited as E8).
- §10's open questions are closed with dispositions; what was *not* done
  (page archiving/hashing, C3 sourcing, neighbor-row promotion, random cell
  re-derivation) is recorded as a permanent caveat, not silently dropped.

Limits that remain load bearing: competitor cells still rest on one or two
documentation pages per product (plus the sibling fetches registered in §5),
not on reading their source; `Unknown` is still used liberally on purpose; and
no page has been archived or hashed — Round 3 did not pay that debt either,
so it stands as a permanent caveat of this final document (§10 disposition 5).

## 1. Preview framing (non-negotiable)

- `pi-sparkle` is a **developer preview (0.1.0)**, `private: true`, with the
  fake-executor local CLI as the supported path
  ([README](../../README.md), [status matrix](../status-matrix.md)).
- **Nothing in this repository is Outcome-supported.** That term has a fixed
  meaning under [ADR-004](../decisions/0004-controlled-adaptation.md) — held-out
  or comparable later benefit with no guardrail regression — and no capability
  has earned it. Checkpoint F-PROD is open
  ([ADR-005](../decisions/0005-checkpoint-f-holdout-open-questions.md)), so
  Checkpoint G is forbidden.
- **ADR-006 remains Proposed.** There is no Pi extension.
  `package.json#pi` declares only `skills` and `prompts`,
  `@earendil-works/pi-coding-agent` is not a dependency, and
  `PI_EXTENSION_IMPORT_ALLOWED` stays `false`
  ([ADR-006](../decisions/0006-pi-extension-reverse-adapter.md)). As of Round 2
  this posture is pinned by a test: the market-eval probe's manifest and
  ADR-status facts are asserted by
  `test/unit/package/market-eval-probe.test.ts` (§9 H0-2).
- Live R1, bandit, and topology stay off the execution path. Nothing in this
  note recommends changing that before F-PROD.
- No comparison below is a performance claim. This project has submitted no
  benchmark result and holds no field outcome data; §4 records that as a loss,
  not a gap to be talked around.

## 2. Evaluation dimensions (R1 proposal, confirmed in R2)

Twelve dimensions in three groups. They were chosen to be *decidable from
public artifacts* and to include axes where this project loses, not only axes
it was built to win.

**Round-2 ruling on the dimension set.** The set is kept as-is. Round 1 left
two structural questions open; Round 2 rules on both. First, the `n/a` marker
is **rejected**: the cell vocabulary is `Present` / `Partial` / `Absent` /
`Unknown` and nothing else. MCP is a protocol, not an agent, so its column is
dropped from the tables and MCP appears only in prose (C4 note, §4.4, and the
parallel position note [mcp-position.md](mcp-position.md)). Former `n/a` cells in B3/B4
now read `Unknown`, with the design reading they used to encode preserved in
the §4.2 notes. Second, A1 is **not** split into "durable record" and "resume
reconstructs from the record"; the notes carry that distinction, and the
OpenHands upgrade in §4.1 shows the notes are sufficient.

**Round-3 disposition on the dimension set.** The twelve dimensions are
unchanged, but C3's *comparative row* in §4.3 is retired per §10 ruling 1:
its condition to survive — real competitor sources for at least three cells —
was not met, because Round 3 fetched nothing. The dimension keeps its
definition below, and this project's C3 self-assessment moves to prose in the
§4.3 notes.

**Group A — run substrate**

| Id | Dimension | Decided by asking |
|---|---|---|
| A1 | Durable, replayable run record | Is there a persisted per-run record that a resume reconstructs work from, rather than a transcript kept for the human? |
| A2 | Crash and corruption semantics | On a truncated or damaged record, does the system refuse, or does it continue on invented state? |
| A3 | Supervised interruption | Are pause, question, override, and unblock first-class *recorded* operations, or ad-hoc chat turns? |
| A4 | Explicit graph orchestration | Is multi-agent work a validated graph with joins and bounded children, or a lead agent improvising subtasks? |

**Group B — governance and evidence**

| Id | Dimension | Decided by asking |
|---|---|---|
| B1 | Requirement contract with a coverage gate | Can a run *refuse to start* because mandatory acceptance criteria are uncovered? |
| B2 | Routing policy with declared provenance | Is model selection a stated policy with a citable source, and is live network ranking forbidden? |
| B3 | Learned-vs-live plane isolation | Is there a mechanical proof that exploratory or learned components cannot reach live execution? |
| B4 | Adaptation governance | Can anything change durable policy or memory without a human approval artifact? |

**Group C — disclosure, data, reach**

| Id | Dimension | Decided by asking |
|---|---|---|
| C1 | Published capability-maturity ladder | Does the project publish, in its own docs, which of its capabilities are unproven? |
| C2 | Published outcome evidence | Is there a benchmark result under a named harness, or field metrics on delivered work? |
| C3 | Privacy lifecycle | Delete cascade, redaction as a value-removing transform, and bounded retention. |
| C4 | Third-party extensibility reach | MCP, plugins, hooks, skills, extension APIs — and whether anyone outside the project can attach to them. |

Two dimensions remain deliberately **excluded**, now confirmed rather than
provisional: raw model quality (a property of the model, not the harness — see
[public-scene-prior](public-scene-prior.md) on why harness and model must not
be mixed) and price (not comparable across a local runtime, a subscription
product, and a protocol).

## 3. Cell vocabulary

| Marker | Meaning |
|---|---|
| `Present` | The property is documented as shipped and, for `pi-sparkle` only, is Present + Wired + Exercised in the [status matrix](../status-matrix.md). Never implies Outcome-supported. |
| `Partial` | Documented but narrower than the dimension asks, or shipped with a disclosed hole. |
| `Absent` | The docs read affirm the property does not exist, or the project's own policy forbids it. |
| `Unknown` | Not addressed on the pages read. **`Unknown` means undocumented, not missing.** |

These four markers are the whole vocabulary. Round 1's fifth marker `n/a` is
retired per the §2 ruling.

Reading warning for §4, unchanged from Round 1 and still true after the
fold-in: rows A2, B3, and B4 look lopsided in this project's favour largely
because *no product documentation discusses crash semantics or plane isolation
at all*. Those rows measure disclosure as much as capability. Round 2 folded
**no** competitor crash semantics, because none of the sibling fetches
document any — the A2 row stays `Unknown` outside this project by rule, not by
oversight. A second asymmetry is now explicit: §4.6's this-repo residuals come
from a source-level audit with executed transcripts (E3), an evidence depth no
competitor column has received. Absence of a listed competitor residual is
absence of audit, not absence of defect.

Columns: **PS** pi-sparkle · **CUR** Cursor Agent · **CC** Claude Code ·
**CCA** GitHub Copilot coding agent · **CNT** Continue · **AID** Aider ·
**OH** OpenHands · **GOO** Goose · **PI** Pi itself.

## 4. Comparison (R2)

### 4.1 Group A — run substrate

| Dim | PS | CUR | CC | CCA | CNT | AID | OH | GOO | PI |
|---|---|---|---|---|---|---|---|---|---|
| A1 record | Present [R1][R2] | Unknown [S1] | Partial [S2] | Partial [S3] | Unknown [S4] | Partial [S5] | Present [S6][S12] | Unknown [S7] | Partial [S8][R6] |
| A2 crash | Present [R1][R3] | Unknown [S1] | Unknown [S2] | Unknown [S3] | Unknown [S4] | Unknown [S5] | Unknown [S6] | Unknown [S7] | Unknown [S8] |
| A3 interrupt | **Present** [R1][E3][R12] | Partial [S1] | Partial [S2] | Partial [S3] | Unknown [S4] | Partial [S5] | Partial [S6] | Unknown [S7] | Partial [R6] |
| A4 graph | Present [R1][R2] | Unknown [S1] | Partial [S2] | Absent [S3] | Unknown [S4] | Absent [S5] | Partial [S6][S13] | Partial [S7][S14] | Partial [R7] |

Notes that the markers compress:

- **A1.** `pi-sparkle` resumes a flowchart node from its logged `TASK_REQUEST`
  rather than from a remembered plan, and a node with no logged request is
  restored as *unknown*, not as an invented default ([R1] Runtime line, event
  log row). **OpenHands moves `Partial → Present` in Round 2**: its official
  SDK architecture docs state that events form an immutable append-only log
  used as memory and a service integration point, that the conversation store
  is event-sourced and indexed, and that the state model supports
  deterministic replay [S12] — corroborated by the peer-reviewed SDK paper
  cited in E1. Aider's record is git: every change is a commit and `/undo`
  walks it back [S5] — recoverable, but the commit is the artifact, not a
  replayable execution log. Copilot puts every step in a commit and a viewable
  session log [S3], but the session itself has a hard 59-minute cap, so the
  log is an audit trail rather than a resume substrate. Claude Code moves a
  live session between terminal, desktop, web, and phone [S2], which implies
  durable session state, but the overview does not describe its format or
  replay semantics.
- **A2.** The `pi-sparkle` cell rests on stated, tested behaviour: a truncated
  JSONL tail is recovered, a corrupt middle line fails closed, malformed
  checkpoint JSON raises a path-naming error, and an eleven-case crash probe
  runs three times each ([R1] Runtime line; re-run green in Round 1 by E2 and
  E3, 2,050 tests / 2,049 pass / 1 deliberate skip). Every other cell is
  `Unknown` because no page read by any of the three surveying agents raises
  the question. Even OpenHands' A1 upgrade does not move its A2: replay is
  documented; refusal-on-corruption is not.
- **A3 — downgraded in Round 2, restored in Round 3.** `pause` / `answer` /
  `inject` / `unblock` are recorded operations with refusal rules — `unblock`
  is keyed to the exact active `RUN_BLOCKED` and refuses stale, repeated, or
  wrong-node requests [R1] — and the flowchart `answer` branch refuses a
  message id that does not match the pending question. Round 1 proved by
  transcript that the **plain-run `answer` path validated only the id's
  format**: a fabricated `msg_…` was accepted with exit 0, flipped
  `WAITING_FOR_USER` to a permanent `RUNNING`, and stranded the run as a
  crash candidate ([E3] §5.1) — so Round 2 read the cell `Partial`, because
  `Present` with an undisclosed hole would be the exact dishonesty this table
  exists to avoid. The fix is committed at `5c1421c`: `answer --message` is
  correlated fail-closed against the questions the log is actually waiting on
  (a `RUN_WAITING_FOR_USER` with no answer yet), anything else is refused and
  records nothing, and `inspect` prints the id a waiting run owes
  (`src/cli/main.ts`; pinned by [R12] and re-run green in Round 3 [E8]). The
  cell therefore returns to `Present`, with the round trip
  `Present → Partial → Present` recorded here on purpose — the downgrade was
  evidence-driven and so is the restore.
  Competitor interruption is real but conversational:
  plan review [S1][S2], `@copilot` comments and Slack steering [S3], the
  interactive prompt and `/undo` [S5]. Pi's own kernel exposes `steerText` /
  `followUpText` mid-turn, which this repo already consumes through its
  facade [R6].
- **A4.** Copilot stays `Absent` on strength of an explicit statement: one
  branch at a time, exactly one pull request per task, no cross-repository
  changes [S3]. Claude Code's subagents have a lead agent that assigns and
  merges subtask results [S2] — orchestration without a documented validated
  graph. **Goose's `Partial` is re-sourced in Round 2**: Round 1 leaned on a
  secondary blog for an ACP orchestration claim; the cell now rests on
  official docs stating that recipes are portable YAML packages that can
  include instructions, extensions, parameters, and subrecipes [S14]. Still
  `Partial`: declarative composition is documented; validation-before-start is
  not. OpenHands gains a sharper source: delegation spawns parallel subagents
  with independent contexts and consolidates results [S13], which is fan-out,
  not a user-authored dependency DAG (§4.4). Pi's cell stays `Partial` on
  observed subagent runs [R7], with a Round-2 clarification from E6: Pi core
  explicitly omits built-in subagents; the subagent event buses and
  append-only traces in the Pi ecosystem are separately installable packages,
  not the host.

### 4.2 Group B — governance and evidence

| Dim | PS | CUR | CC | CCA | CNT | AID | OH | GOO | PI |
|---|---|---|---|---|---|---|---|---|---|
| B1 contract gate | Partial [R1] | Partial [S1] | Partial [S2] | Partial [S3] | Unknown [S4] | Absent [S5] | Unknown [S6] | Unknown [S7] | Unknown [S8] |
| B2 routing | Present [R1][R4] | Partial [S1] | Unknown [S2] | Partial [S3] | Unknown [S4] | Partial [S5][S10] | Unknown [S6] | Partial [S7] | Unknown [S8] |
| B3 isolation | Present [R5] | Unknown [S1] | Unknown [S2] | Unknown [S3] | Unknown [S4] | Unknown [S5] | Unknown [S6] | Unknown [S7] | Unknown [S8] |
| B4 promotion | Present [R1][R8] | Unknown [S1] | Partial [S2] | Partial [S3] | Unknown [S4] | Unknown [S5] | Unknown [S6] | Unknown [S7] | Unknown [S8] |

Notes:

- **B1 is `Partial` for this project on purpose.** `--track` builds a
  requirement contract and `assertCoverageAllowsStart` refuses to start while
  mandatory criteria are uncovered, but plain `--children` records
  `skipContract: true` and the gate never fires on that path — a documented,
  deliberately unpatched hole, pinned by
  `test/integration/m2.5/cli-contract-honesty.test.ts` [R1]. Competitor
  `Partial` cells mean something weaker: a plan is produced and reviewed before
  execution [S1][S2][S3], but no path refuses to start.
- **B2.** The distinguishing property is not that a policy exists but that its
  provenance is frozen: ranking reads a hashed snapshot file, HTTP during
  `route()` is forbidden, and the family-to-source map states which public
  board feeds which task family and why [R4]. E3's source audit adds the
  Round-2 confirmation that the one learned input to live routing is gated
  exactly as documented: `loadLearnedRouting` reads only the adaptation
  registry's hash-verified active pointer, and the direct writer throws.
  Aider is `Partial` because it publishes its own polyglot leaderboard under a
  fixed harness [S10] — this repo imports that board as a prior — while its
  in-tool selection is a manual `--model` plus a weak model for commit
  messages [S5]. Cursor publishes a model table with context and capability
  attributes [S1]; the selection policy itself is not described.
- **B3.** `pi-sparkle` has a learned plane and proves the separation over the
  real transitive import closure from four live entry points, with a pinned
  two-entry allowlist [R5], re-certified by an independent second walker in
  [the Round 3 isolation report](../reports/2026-08-24-sota-r3-isolation.md)
  and re-run green in Round 1 [E2]. The cells that read `n/a` in Round 1
  (Continue, Aider, OpenHands, Goose, Pi) now read `Unknown` under the §2
  ruling. The design reading they encoded is preserved here as prose: no
  learned routing plane appears in the documented design of those five
  projects, so for them the dimension is likely vacuous rather than failed —
  but that is a documentation-derived judgement, and `Unknown` is the honest
  marker for it. The three closed products may route across models with
  undisclosed learned components; `Unknown` there means exactly that.
- **B4** remains the row where the closed products are *documented as doing
  the opposite*. Claude Code builds "auto memory" as it works, "saving
  learnings across sessions without you writing anything" [S2]; Copilot Memory
  stores details it "worked out for itself" about a repository and reuses them
  in later agent runs [S3]. Neither describes an approval artifact.
  `pi-sparkle` requires `adapt promote --candidate --expected --content-file
  --review-file --approve`, refuses without persisted independent-review
  provenance, and ships a collect-only kill switch (`SPARKLE_AUTO_ADAPT=0`)
  that keeps observation running while everything that learns stops [R1][R8] —
  all re-verified at source level in Round 1 [E2][E3]. This is a genuine
  difference in kind, and it is also a cost: this project has no cross-session
  memory to speak of. One Round-2 nuance from E3, recorded so the row is not
  overstated: the bandit *file* is written automatically after every
  `--track`/`--children` run; nothing reads it for a live decision, so
  "off the live loop" is accurate for decisions while the state accumulates.
  The former `n/a` cells (Aider, Goose) now read `Unknown` per §2.

### 4.3 Group C — disclosure, data, reach

| Dim | PS | CUR | CC | CCA | CNT | AID | OH | GOO | PI |
|---|---|---|---|---|---|---|---|---|---|
| C1 maturity ladder | Present [R1] | Unknown [S1] | Partial [S2] | Partial [S3] | Unknown [S4] | Unknown [S5] | Partial [S6] | Unknown [S7] | Unknown [S8] |
| C2 outcome evidence | **Absent** [R1] | Unknown [S1] | Unknown [S2] | Present [S3] | Unknown [S4] | Present [S5][S10] | Present [S6][S11] | Unknown [S7] | Unknown [S8] |
| C4 extensibility reach | **Absent** [R1][R10] | Present [S1] | Present [S2] | Present [S3] | Partial [S4] | Partial [S5] | Present [S6] | Present [S7] | Present [S8][R10] |

The C3 (privacy lifecycle) row that stood here in Rounds 1–2 is retired; see
the C3 note below and §10 disposition 4.

Notes:

- **C1.** The status matrix's four-state ladder, and its standing sentence that
  nothing has reached the top state, is the single artifact no comparator
  matches [R1]. `Partial` elsewhere means per-feature labels rather than a
  ladder: Copilot's explicit limitations section and preview labels [S3],
  Claude Code's beta and public-preview markers [S2], OpenHands labelling
  components legacy, deprecated, feature-complete, or community-supported [S6].
  The `Unknown` cells reflect a one-to-two page read, not a search.
- **C2 is this project's clearest loss, and it is self-imposed.** Copilot
  exposes pull-request lifecycle metrics — created, merged, median time to
  merge, including for agent-authored PRs [S3]. Aider publishes a polyglot
  leaderboard [S10]. OpenHands maintains a dedicated benchmarks repository
  [S11]. `pi-sparkle` publishes none of these and, by policy, may not claim
  benefit until F-PROD closes. The correct response is not to soften the
  policy; it is to notice that the project currently has no artifact a
  sceptical outsider can evaluate at all, which §7 treats as an H1 concern.
- **C3 — the comparative row is retired in Round 3, executing Round 2's own
  ruling.** Round 2 kept the row on one condition: it would be dropped unless
  at least three competitor cells got real sources (§10 ruling 1). Round 3
  fetched nothing, so the condition failed and the row is gone from the table
  above; the dimension stays defined in §2 because it is real, just unscored
  outside this project. What the row said survives here as disclosure, not
  comparison. This project self-assesses `Partial` for two disclosed reasons:
  retention of `runtime/invocations.jsonl` and `runtime/episodes/` is
  unbounded with only a sizing probe behind it, and the P0 privacy dictionary
  sign-off is still open [R1][R9]. What does exist is substantial — a delete
  cascade that filter-rewrites the shared invocation log, strips both
  free-text fields from bound feedback, tombstones ids, and *reports* the
  residual episode text it deliberately does not rewrite. One this-repo
  caveat folded from E3: a feedback-id collision means an episode delete can
  over-suppress other episodes' learning signals (§4.6 item 6) — privacy-safe
  in direction (nothing leaks; the cascade over-deletes visibility), but
  silent. Every competitor cell would still read `Unknown`; a row that is
  eight-ninths `Unknown` measures the absence of an audit, and this final
  document declines to keep dressing that up as a scored comparison.
- **C4 is the second clear loss, unchanged by Round 2.** Every comparator
  consumes MCP or an equivalent plugin surface: Cursor plugins/skills/MCP/rules
  [S1]; Claude Code MCP, skills, hooks, and an Agent SDK [S2]; Copilot MCP
  servers plus hooks, skills, and custom agents [S3]; Goose, where extensions
  *are* MCP servers [S7]; OpenHands with an SDK, Agent Server APIs, and a
  sandbox server [S6]; Pi's own package manifest supporting skills, prompts,
  and extensions with session, turn, and tool lifecycle events [R10].
  `pi-sparkle` has no MCP client, no extension, and no registered command; E3
  verified zero MCP mentions repo-wide in Round 1. Its only third-party
  surface is a diagnostic skill and a `/sparkle` prompt template. What Round 2
  adds is not code but a decision: the project's MCP/interop position is now
  recorded in [mcp-position.md](mcp-position.md), which landed in parallel
  with the Round-2 synthesis and is committed at `5c1421c`. This note
  deliberately does not duplicate it; the one-line summary is that the answer
  to "does it speak MCP" is a documented *no, in either direction, by
  architectural decision* — argued there, not silence.

### 4.4 Closest neighbors (folded from E1/E6 — deliberately not table columns)

The products above are what a buyer would compare; the three systems below are
what this project's *architecture* is actually nearest to. They entered
through deeper sibling reads than the one-to-two-page reads behind §4's
columns, so folding them in as cells would mix two evidence depths in one
table. Round 3 declined to promote any of them (§10 disposition 3): no new
pages were fetched, so a full row at the columns' evidence depth could not be
derived honestly. They close the loop as prose neighbors.

| Neighbor | Why it is close | Why it is not the same |
|---|---|---|
| **Cline Kanban** | Supervised task board: cards run in isolated worktrees, dependency chains auto-start successors, tasks persist conversation, command, decision, checkpoint, and cost history, with a human diff-review loop [S15] | Public docs describe task history and checkpoints, not an immutable typed event-sourced core; no documented coverage gate that refuses to start |
| **OpenHands SDK** | Immutable append-only event log used as memory, event-sourced conversation store, deterministic replay, parallel delegation with independent contexts [S12][S13] | No user-authored dependency DAG with per-node acceptance criteria; delegation is fan-out-and-consolidate, not a validated graph |
| **Codex app-server** | Embeddable JSON-RPC protocol: persistent threads, turns, items, streamed lifecycle notifications, approval requests [S16] | The abstraction is conversation/turn/item, not a dependency-DAG scheduler — a substrate a supervisor could be built on, not a supervisor |

Adjacent but distinct: the Pi ecosystem itself exposes the ingredients
(lifecycle events, tree-structured session history) while explicitly omitting
built-in subagents; subagent buses and append-only traces exist as separately
installable Pi packages [E6]. That reinforces the §1 manifest fact: what
`pi-sparkle` installs into Pi today is skills plus prompts, nothing more.

Each neighbor holds one piece of this project's combination — Cline the
supervision board, OpenHands the event log, Codex the embeddable protocol.
None of the three documents the combination of validated graph, coverage-gated
start, proposal-first adaptation, and provable plane isolation. That is the
wedge in §6, restated as negative space.

### 4.5 Lifecycle traps (folded from E1/E6)

Comparisons that would have been against dead or renamed surfaces, recorded so
neither this document nor Round 3 benchmarks against a ghost:

- **GitHub Copilot Workspace** was sunset 2025-05-30 [S18]. Its
  spec→plan→implement ideas moved into agent mode and the coding agent; the
  CCA column above already compares against the successor, not the ghost.
- **Continue's VS Code extension** is explicitly at a lifecycle boundary: its
  v1.2.24 release (2026-06-15) is labelled final, and the project now
  recommends its CLI [S17]. The CNT column's many `Unknown`s should be read
  with that in mind — this is the one live column citing a product whose
  flagship surface is frozen.
- **Amazon Q Developer's IDE surface** is sunsetting: new signups stopped
  2026-05-15, IDE plugins reach end of support 2027-04-30, and AWS points
  users to Kiro [S19]. It is not a column here; this entry exists so Round 3
  does not add it.
- **Windsurf is now Devin Desktop** (Cognition) [S20]. Any citation goes to
  the new name; one migration signal worth keeping (E1): its auto-generated
  memories are being deprecated in favour of skills — the market walking back
  ambient learned state, which is the direction B4 already scores.
- **SWE-agent** formally recommends mini-SWE-agent as its successor [S21].

Standing rule adopted with this section: a cell or claim citing a sunset or
renamed surface must say so inline.

### 4.6 This-repo residuals (folded from E2/E3 — not competitor facts)

Round 1's source audit proved defects in this repository by transcript. They
are folded here as **this-repo residuals** because §4's competitor cells come
from documentation reads and cannot surface equivalent defects; putting these
in the tables would punish the only project that got a source audit. They
qualify the PS column instead, and one of them moved a cell.

1. **The README omitted `unblock`** — the only exit from a BLOCKED run, which
   USAGE, stderr routing, and the status matrix all lean on — so the single
   most important recovery verb was invisible to anyone reading the docs
   ([E2] G-2, [E3] §1.2). This is the docs-vs-dispatcher drift §8 covers; the
   README truth-up plus an anti-drift parity test are committed at `5c1421c`
   (`README.md`, `test/unit/cli/readme-command-parity.test.ts`), and §8 is
   flipped to restored on their strength.
2. **Supervision was post-hoc only.** No live view existed: `inspect` reads a
   settled run, and deltas are persisted as character counts, never text
   ([E2] G-1, [E3] §3.1). For a product whose identity is supervision, this
   was the gap a first-time user hit in minute one. A read-only, lock-free
   `inspect --follow` is committed at `5c1421c` (`followRunEvents` in
   `src/run/inspection.ts`, `test/integration/cli/inspect-follow.test.ts`),
   closing this for the local operator.
3. **The plain-run `answer` path validated only id format** — a fabricated
   `msg_…` was accepted with exit 0 and stranded the run in permanent
   `RUNNING` ([E3] §5.1). This is the defect that moved A3 to `Partial`. The
   fail-closed correlation is committed at `5c1421c` (`src/cli/main.ts`,
   `test/integration/cli/answer-correlation.test.ts` [R12]); Round 3 verified
   it and the cell is back to `Present` (§4.1).
4. **The README's own `--children` example taught a dependency the compiler
   ignores**: it used `inputArtifactIds`, but edges are built only from
   `dependsOn`, so the documented "dependent" tasks actually ran in parallel
   ([E3] §5.3). A4 stays `Present` because the graph validation itself is
   sound — cycle, self-dependency, missing- and duplicate-dependency specs are
   all refused — but the example taught the wrong model. The corrected example
   plus an explicit "ordering comes from `dependsOn` and nothing else" note
   are committed at `5c1421c`, and the parity test pins the example's shape —
   it fails if `inputArtifactIds` reappears implying an edge.
5. **The cost gate is well-built and was effectively unreachable from the
   CLI** ([E3] §3.7): no flag sets `maxCostUsd`, the default limits carry no
   cost key, and the gate's disarm-notification callback (`onCostGate`) had
   zero subscribers, so its honest disarm reasons (`no-cap`, `invalid-cap`,
   `unpriced-model`) never reached a human. The only operator-reachable arming
   is per-task `limits.maxCostUsd` inside a `--children` spec. The adjacent
   honesty fix is committed at `5c1421c` — `steerText` *refuses* once the cost
   stop has latched, instead of silently accepting text into a queue the loop
   has already left (`src/pi-adapter/pi-executor.ts`,
   `test/integration/pi-adapter/cost-stop.test.ts`) — but the arming flag and
   the disarm wire remain open at the end of the loop (§10 disposition 6:
   H1 ledger).
6. **(Adjacent, no cell moved.)** Feedback ids hash content only, so identical
   child summaries collide across episodes: one episode delete tombstoned an
   id shared by other episodes and suppressed 11 of 13 feedback rows, silently
   ([E3] §6). The failure direction is privacy-safe — over-suppression, no
   leak — but it is silent learning-signal loss on the adaptation plane.
   Recorded for the H1 ledger (§10 disposition 6); the minimal direction E3
   names is widening the id preimage with episode/run/task identity.

The pattern E3 itself names: the hard engineering — state machines, locking,
protocol validation, privacy cascade, cost arithmetic — is careful and
well-tested; the defects cluster at the last mile to the user. That is what
this round's H0 items were chosen to fix.

## 5. Source register

Repository sources (this tree; R1 cells at commit `21b8dc9`, Round-2 additions
against `60ae1ea` plus in-flight edits, Round-3 verification against the
committed tree at `5c1421c`):

| Ref | Source |
|---|---|
| R1 | [docs/status-matrix.md](../status-matrix.md) |
| R2 | [README.md](../../README.md) — command table and run paths |
| R3 | [ADR-002](../decisions/0002-event-log-and-checkpoints.md) |
| R4 | [public-scene-prior.md](public-scene-prior.md) |
| R5 | `test/unit/routing/live-isolation.test.ts` |
| R6 | [kernel-reuse audit](../reports/2026-08-24-kernel-reuse-audit.md) |
| R7 | `.agents/skills/pi-sparkle/SKILL.md` — observed Pi subagent runs |
| R8 | [ADR-004](../decisions/0004-controlled-adaptation.md) |
| R9 | [P0 privacy review package](../reports/2026-08-22-p0-privacy-review-package.md) |
| R10 | [ADR-006](../decisions/0006-pi-extension-reverse-adapter.md) and `package.json#pi` |
| R11 | [node-engine-floor.md](node-engine-floor.md) — Round-2 evidence note behind the doctor message |
| R12 | `test/integration/cli/answer-correlation.test.ts` — fail-closed answer correlation, committed `5c1421c`, re-run green in Round 3 |

Round-1 evidence files (E1–E6): see the table in §0. E-cited claims about this
repository were verified by their authors against the Round-1 tree with
commands and transcripts recorded in the files themselves. Round-3 evidence
files: **E7** = [r3-gpt-a.md](../../.agent_workspace/r3-gpt-a.md), the full
probe and tripwire re-run against `5c1421c` (all green; `rg -i mcp src/`
empty); **E8** = [r3-fable-b.md](../../.agent_workspace/r3-fable-b.md), this
final edit's working notes with the five-file H0 test re-run (32/32 pass).

Public sources. S1–S11 were read by R1-opus-B; S12–S21 were fetched by
R1-fable-A and R1-gpt-B. All were accessed 2026-08-25. **Neither Round 2 nor
Round 3 re-fetched any page**: cells and prose citing S12–S21 rest on the
sibling agents' recorded fetches from the same day. No page has been archived
or hashed; the debt was never paid and stands as a permanent caveat of this
final document (§10 disposition 5).

| Ref | Source |
|---|---|
| S1 | https://docs.cursor.com/en/agent/overview |
| S2 | https://docs.anthropic.com/en/docs/claude-code/overview |
| S3 | https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent |
| S4 | https://docs.continue.dev/ |
| S5 | https://aider.chat/docs/usage.html |
| S6 | https://docs.all-hands.dev/ |
| S7 | https://github.com/block/goose · https://goose-docs.ai/ |
| S8 | https://registry.npmjs.org/@earendil-works/pi-agent-core (`latest` 0.84.3 on 2026-08-25) · https://github.com/earendil-works/pi-mono |
| S9 | https://modelcontextprotocol.io/docs/getting-started/intro (MCP is prose-only as of R2; see §2 ruling) |
| S10 | https://github.com/Aider-AI/aider/blob/main/aider/website/_data/polyglot_leaderboard.yml |
| S11 | https://github.com/OpenHands/benchmarks |
| S12 | https://docs.openhands.dev/sdk/arch/events · https://docs.openhands.dev/sdk/arch/conversation — immutable append-only event log, event-sourced store (via E6/E1) |
| S13 | https://docs.openhands.dev/sdk/guides/agent-delegation — parallel subagent delegation (via E6) |
| S14 | https://goose-docs.ai/ recipes and CLI-commands docs — recipes/subrecipes as official composition (via E6); replaces the secondary-blog source Round 1 flagged |
| S15 | https://docs.cline.bot/kanban/core-workflow · https://docs.cline.bot/usage/kanban · https://docs.cline.bot/core-workflows/task-management (via E6; the first two timed out under direct fetch and are cited from search-returned content, as E6 discloses) |
| S16 | https://developers.openai.com/codex/app-server · https://developers.openai.com/blog/codex-as-a-platform (via E6, same fetch caveat disclosed there) |
| S17 | https://github.com/continuedev/continue/releases/tag/v1.2.24-vscode — final VS Code release, 2026-06-15 (via E6) |
| S18 | https://gist.github.com/idan/15f101b8ff4be8bebe17147c08995363 — Copilot Workspace sunset, 2025-05-30 (via E1) |
| S19 | https://aws.amazon.com/blogs/devops/amazon-q-developer-end-of-support-announcement/ (via E6) |
| S20 | https://www.windsurf.com/ · https://devin.ai/blog/windsurf-is-now-devin-desktop (via E1/E6) |
| S21 | https://github.com/SWE-agent/SWE-agent/ — supersession notice pointing to mini-SWE-agent (via E6) |

Source-discipline check Round 1 asked for (H0-3, "re-derive three cells at
random"): full random re-derivation was deferred to Round 3 and, at close,
**was not performed** — Round 3 re-fetched no public page. What stands in its
place are the independent cross-checks Round 2 accepted: Copilot's
one-branch/one-PR limit (A4 `Absent`) appears independently in E6's
cloud-agent fetch and the S3 read; Continue's MCP-in-config posture is
consistent across S4 and E6; and the Pi manifest facts behind R10 were
verified locally by three separate agents (E2, E3, E5) and re-confirmed by
probe in Round 3 [E7]. Readers should weigh competitor cells accordingly.

## 6. This project's wedge (held from R1, requalified by R2)

The comparison above says the crowded axes are reach, surfaces, and model
plurality, and this project is behind on all three and will stay behind. What
nobody else in the table documents is the *substrate* — and §4.4 sharpened
that claim: each nearest neighbor holds one piece (Cline the board, OpenHands
the log, Codex the protocol), none documents the combination. Five properties,
each with an in-repo pointer and an explicit statement of what it is **not**;
§4.6 lists where their execution currently leaks.

**6.1 Event-sourced supervised runs.** A run is a JSONL event log plus
checkpoints, and resume reconstructs the work from the log — a node's
objective, input artifacts, acceptance criteria, and child budget come from its
recorded `TASK_REQUEST`, its role and model from the role-bearing
`MODEL_ROUTED`, its dependencies from checkpointed edges [R1][R3]. A node with
no logged request stays *unknown* rather than defaulted. *Not:* a conversation
transcript kept for the human, and not a claim that replay is cheap or that the
log is portable outside the CLI. As of Round 2, no longer post-hoc-only: the
same fail-closed reader now backs a read-only `--follow` (§9 H0-4).

**6.2 Fail-closed persistence.** Damage degrades to refusal. A truncated final
JSONL line is recovered and warned about; a corrupt middle line refuses;
malformed checkpoint JSON raises a path-naming error rather than returning an
empty state; damaged bandit bytes survive for repair instead of being silently
reset; an unknown redaction class fails the read closed [R1]. *Not:* a
durability guarantee. Locks are timeout-only with no PID-reuse steal, a SIGKILL
leaves a lock behind for manual removal, and writes that land after final
verification survive by design.

**6.3 Proven routing isolation.** The separation between the learned plane and
live execution is a property of the module graph, checked over the real
transitive import closure from four live entry points against a pinned
two-entry allowlist, with `selectArm` asserted to have zero callers in that
closure [R5]. It survives refactoring because it is not a per-file grep, and it
ran green again in Round 1 [E2]. *Not:* evidence that the learned plane works —
it is evidence that it cannot leak.

**6.4 Proposal-first adaptation.** No code path promotes. Promotion is one CLI
verb requiring five flags including a persisted independent-review artifact and
a compare-and-swap on the expected active version [R1][R8]. The kill switch
separates observing from learning rather than turning the loop off. *Not:*
adaptive gains. `adapt auto` proposes routing-policy candidates only, and their
value is unmeasured — and §4.6 item 6 shows the signal corpus feeding proposals
can be silently thinned by an id collision.

**6.5 Diagnostic skill overlay, not a control plane.** The Pi-facing surface is
deliberately the weakest possible hook: a skill and a prompt template, with
ADR-006 stating in advance why that is the wrong long-term control surface and
what would have to be true to replace it [R10]. Skill telemetry may record
`AVAILABLE` and `EXPLICITLY_ACTIVATED`, may record `SELECTED`/`SKIPPED` only
after a router decision was persisted, and must never persist `USED`. *Not:* a
plugin ecosystem, and not a hedge — it is a refusal to let an installed
markdown file look like authorization. E1's market survey adds corroboration
Round 1 did not have: the strongest current practice agrees — Claude Code's own
docs state only hooks fire deterministically, and Devin is migrating memories
into skills while keeping enforcement in system rules. Nobody surveyed even
attempts skill-compliance observability; this repo's telemetry honesty rule is
stricter than anything found.

Taken together the wedge is narrow and specific: **a local runtime whose
records you can argue with.** Every competitor optimizes the distance from
intent to merged diff. This one optimizes whether, six weeks later, you can
reconstruct what was decided, on what evidence, and prove that nothing
unproven touched the decision. That is worth something to a regulated or
post-incident reader and worth very little to a developer who wants a bug
fixed now — an asymmetry the plan below has to respect rather than paper over.

## 7. Where the wedge does not pay

Recorded so the plan is not built on the flattering half of §4. Round 2 grew
this list rather than trimming it (H0's negative-case discipline):

1. **No outcome evidence at all** (C2). The policy forbids the claim; it does
   not forbid producing an inspectable artifact, and none exists.
2. **No third-party reach** (C4). No MCP client, no extension, no registered
   command. A user cannot attach their existing tools. The position note
   ([mcp-position.md](mcp-position.md)) documents the *why*; it does not
   close the gap.
3. **The supported path is a fake executor.** Real-provider coverage is
   opt-in smoke plus an offline loopback harness [R1]. E3 sharpened this: the
   first real-provider run is the least-proven path in the repo.
4. **The substrate is largely invisible from outside the CLI.** `inspect
   --summary-json` is a frozen additive contract [R1], and Round 2's
   `--follow` adds a live view for the local operator — but there is still no
   way to hand someone a run, which is what H1-a exists for.
5. **Retention is unbounded** and the P0 privacy sign-off is open [R1][R9].
6. **Single local user, one machine.** No shared surface, no team view — while
   the market's nearest supervision surface (Cline's board, Devin's command
   center) is exactly a shared view [E1][S15].
7. **The last mile leaks** (new in R2): §4.6's residuals — an unarmed cost
   gate, a formerly unvalidated answer path, a colliding feedback id — are all
   defects in the distance between a well-tested library and the operator's
   terminal.

Items 1, 2, and 4 are the same problem seen from three sides: the project's
strongest property produces nothing a third party can hold.

## 8. SOTA acceptance gap (new in R2)

The [SOTA acceptance report](../reports/2026-08-24-sota-r3-acceptance.md)
defines six properties this repo must keep. Round 1's re-check ([E2] §6) found
**five of six intact or strengthened** at `80eb0bd` — persistence, isolation,
privacy, telemetry honesty, and proposal-first adaptation all held, several
with stronger evidence than the report itself cites. **Property 6 — docs match
the dispatcher — had drifted**: the dispatcher had grown (most importantly the
loop-4 addition `unblock`, the only exit from a BLOCKED run), and the README
command table had zero mentions of it; secondarily, the USAGE text carried a
duplicated-sentence glitch and the `--children` example taught the wrong
dependency field (§4.6 items 1 and 4).

Round 2 closed this gap, not by re-editing docs once but by making the
property mechanical:

- the README truth-up (`unblock`, `--discard-executed`, `--follow`, the
  `dependsOn` example) landed during that round; and
- a **dispatcher↔README parity test**
  (`test/unit/cli/readme-command-parity.test.ts`) asserts that every verb in
  the dispatch switch has a README command-table row and a USAGE line, that
  the README invents no verb the CLI does not dispatch, and that the
  `unblock` rows, the USAGE dedup, and the `dependsOn` example all hold — so
  property 6 cannot silently drift again; the failure mode becomes a red test
  instead of a Round-1 audit finding. The market-eval probe's best-effort
  CLI-name extraction [E5] independently reports the same command list for
  cross-checking (E7 records the Round-3 output: 18 verbs, `unblock` among
  them).

**Round-3 verdict: restored, pinned by test.** Both bullets are committed at
`5c1421c`. The parity test ran green in Round 3 twice, independently — in
E7's targeted-test run and in E8's five-file H0 run — and E8 re-ran it once
more after this loop's final README edit (Documentation links plus a
`pnpm market:eval` script row, neither of which touches the dispatcher
surface the test guards). No dissent to record.

## 9. Optimization plan — three horizons

### H0 — this three-round loop (docs, probes, DX, tests only)

Hard scope rule, unchanged: H0 ships **no product surface**. Out of scope by
name — accepting ADR-006, any extension directory, any MCP client, wiring R1
or the bandit into live selection, and any benchmark submission.

Round 1 proposed; Round 2 landed; Round 3 verified. The status column below
is final: **"Committed" means present in the committed tree at `5c1421c`**
(2026-08-25; H0-7 earlier, at `60ae1ea`), verified this round by file
inspection plus the E7/E8 test re-runs. No status below rests on a
working-tree snapshot any more.

| # | Item | Where | Final status (R3) |
|---|---|---|---|
| H0-1 | This note promoted from R1 draft to R2 synthesis, sibling evidence folded | this file | Committed (`5c1421c`); Round 3 accepted the synthesis, verified it, and closed it as this final (§0) |
| H0-2 | Probe pinned as a check, not a habit | `scripts/market-eval-probe.mjs`, `pnpm market:eval`, `test/unit/package/market-eval-probe.test.ts` | **Committed** (probe at `79df80d`; script wiring + pin test at `5c1421c`): an end-to-end test runs the probe and asserts `schemaVersion` 1, the no-extension Pi posture (`skills`/`prompts` true, `extensions` false), and that ADR-006's status parse contains `Proposed`; re-run green in Round 3 [E7][E8] |
| H0-3 | README ↔ dispatcher parity + anti-drift test; USAGE dedup; `dependsOn` example; fail-closed `answer` correlation | `README.md`, `src/cli/main.ts`, `test/unit/cli/readme-command-parity.test.ts`, `test/integration/cli/answer-correlation.test.ts` [R12] | **Committed** (`5c1421c`); closes §4.6 items 1, 3, 4; §8 restored; A3 back to `Present` (§4.1) |
| H0-4 | `inspect --follow`: read-only, lock-free tail of `events.jsonl`; exits on terminal status; `--json --follow` keeps stdout a pure event stream | `src/cli/main.ts`, `src/run/inspection.ts`, `test/integration/cli/inspect-follow.test.ts` | **Committed** (`5c1421c`); closes §4.6 item 2 for the local operator; re-run green in Round 3 [E8] |
| H0-5 | Cost-stop steer refusal: after the gate's stop latches, `steerText` refuses with a visible error instead of accepting into a queue the loop has left | `src/pi-adapter/pi-executor.ts`, `test/integration/pi-adapter/cost-stop.test.ts`, [kernel-reuse](../kernel-reuse.md) | **Committed** (`5c1421c`); re-run green in Round 3 [E8]; the arming flag and `onCostGate` wire remain open (§4.6 item 5, §10 disposition 6) |
| H0-6 | MCP/interop position note (decision, not code) | [mcp-position.md](mcp-position.md) | **Committed** (`5c1421c`); Round 3 re-read it in full and found no drift from the C4 note (§10 disposition 2) |
| H0-7 | Node-floor evidence: the 22.14.0 green-suite datum recorded, doctor's failure message cites it, `engines` deliberately unchanged pending a maintainer decision | [node-engine-floor.md](node-engine-floor.md) [R11], `src/cli/doctor.ts` | **Committed** (`60ae1ea`) |
| H0-8 | Negative-case discipline | §7, §4.6 | Standing, honoured through close-out: §4.6 and §7 were not trimmed in Round 3, and the C3 retirement moved disclosure to prose rather than deleting it |

### H1 — next product slice (pick one or two, not more)

Unchanged through close-out; the selection rule now addresses whoever scopes
the next loop: an H1 candidate must be (i) user-visible, (ii) implementable
without touching the shadow plane or the ADR-006 boundary, and (iii) coverable
by an evidence lane that already exists.

**H1-a (recommended) — portable run bundle.** A deterministic, redacted,
hash-stamped export of one run: events, checkpoint, episode, evidence refs. It
converts §6.1 from an internal property into an artifact a reviewer can read
without installing the CLI, and it is the precondition for *any* future outcome
comparison, since paired holdout episodes have to be shareable before they can
be compared. Touches: a new CLI verb; `src/run/inspection.ts` is the model for
a frozen additive contract; the export must reuse the existing redaction
transform and honour tombstones rather than growing a second redaction path.
Risk to state plainly: this is a **new privacy egress surface** and must go
through the same record-class review as the delete cascade. It should not ship
ahead of P0 remediation being re-verified.

**H1-b (recommended) — retention bounds.** The status matrix already records
unbounded growth of `runtime/invocations.jsonl` and `runtime/episodes/` as an
accepted position with a sizing probe and no policy [R1]. It is the one
user-visible operational defect the project admits to. Touches: a policy
decision (age-based or size-based), consistency with `src/privacy/deletion.ts`
so that bounding cannot resurrect or orphan records, and promotion of the
existing probe from diagnostic to gate. Round 2 adds a prerequisite from
§4.6 item 6: the feedback-id preimage should carry episode/run/task identity
before any pruning policy leans on id-scoped tombstones.

**Deferred, with reasons — unchanged refusals.** An MCP client for child tasks
is the largest reach gap in §4 and is *not* recommended for H1: it is a
tool-execution egress surface that interacts with ADR-001's adapter boundary,
ADR-006's inbound direction, and the privacy record classes simultaneously. It
wants its own ADR before it wants an implementation —
[mcp-position.md](mcp-position.md) is the position, not the client. An IDE
surface is out of scope entirely, and E2's Round-1 audit makes the argument
this note adopts: Pi owns the interactive surface; an IDE bet would spend
multiple rounds and dilute the one differentiator.

### H2 — after gates only

Neither item may start on an agent's initiative; both wait on human decisions
this loop cannot make. Unchanged from Round 1.

| Item | Gate | Notes |
|---|---|---|
| Inbound extension (`extensions/pi-sparkle/`) | ADR-006 Accepted by product; then `PI_EXTENSION_IMPORT_ALLOWED` flips and `pi.extensions` may be declared | Telemetry translation only — no BKT, risk, routing, or promotion in the extension [R10]. The peer pin is available today: npm `latest` for `@earendil-works/pi-coding-agent` is 0.84.3, matching the repo's pinned pair [S8][R1]. E2 §4 lists the preconditions that must be true before acceptance is even discussable, starting with P0 sign-off |
| Checkpoint F-PROD sealed holdout | P0 privacy sign-off closed **and** provider smoke done; then 95% utility-delta LCB > 0 and cost-delta UCB ≤ 0 | ADR-005. Simulation evidence does not close F-PROD [R4] |
| Any top-maturity claim, live R1/bandit | F-PROD closed (Checkpoint G) | Forbidden until then, without exception |

Sequencing note, unchanged: H1-a is a quiet prerequisite for F-PROD being
*legible* even after it closes. A held-out result that nobody outside the repo
can inspect converts one policy problem into a credibility problem.

## 10. Round-2 rulings and their Round-3 dispositions

Rulings on Round 1's six open questions, recorded in Round 2 and kept here as
the historical record:

1. **C3 survives one more round** as an explicitly disclosure-weighted row;
   Round 3 drops it unless at least three competitor cells get real sources
   (§4.3 note).
2. **`n/a` is rejected.** The MCP column is dropped; MCP is prose plus the
   parallel position note (§2 ruling).
3. **B3 stays in §4** but its notes now say plainly that for the open projects
   it likely measures a vacuous dimension, marked `Unknown`; the row's real
   content is this project's self-imposed hazard and its mechanical proof.
4. **A1 is not split**; the notes carry the record-vs-resume distinction.
5. **No C2 sub-row** for inspectable artifacts; the distinction lives in
   H1-a's rationale, where it does work.
6. **H1-a remains the single pick** if only one H1 item can be chosen.

Round-3 dispositions on the six questions Round 2 posed:

1. **Verified.** Every "landed in-tree" claim in §9 H0 is committed at
   `5c1421c`. The suite was green at commit time — the commit's own gate
   record reads 2,081 pass / 0 fail / 1 deliberate skip on Node 22.14.0 — the
   Round-3 probe and tripwire re-runs are green [E7], and the five H0 test
   files re-ran green during this final edit (32/32) [E8]. Acceptance
   property 6 is re-derived and restored (§8). **A3 returns to `Present`**
   (§4.1).
2. **Reconciled.** [mcp-position.md](mcp-position.md) was read in full this
   round; the C4 note and §4.4 do not contradict it, and this document keeps
   deferring to it — the one-line summary stays "no, in either direction, by
   architectural decision", and the checkable invariant (`rg -i mcp src/`
   empty) was re-confirmed in Round 3 [E7].
3. **Declined, with reason.** No §4.4 neighbor is promoted to a table column:
   Round 3 fetched no new pages, so complete rows at the columns' evidence
   depth could not be derived without mixing depths — the exact dishonesty
   §4.4 exists to avoid. They remain prose neighbors.
4. **Executed — C3 dropped.** No competitor cell was sourced, so ruling 1's
   survive-condition failed; the comparative row is retired and the
   disclosure content preserved in the §4.3 note.
5. **Not paid; recorded as permanent.** No page was archived or hashed in any
   round. Every public cell in this final document rests on the same-day
   fetch records named in §5. A future loop that reuses these tables must
   re-fetch, not trust.
6. **H1 ledger, not Round-3 fixes.** The cost-gate arming flag and
   `onCostGate` wire (§4.6 item 5) and the feedback-id preimage widening
   (§4.6 item 6) remain open at close; both are carried as H1 inputs — H1-b
   explicitly depends on the preimage fix. Neither was in Round 3's
   docs-only scope.

Close-out. This document is final for the 2026-08-25 market-eval loop. The
companion acceptance re-check is the Round-3 report at
[2026-08-25-market-eval-sota-acceptance.md](../reports/2026-08-25-market-eval-sota-acceptance.md),
which landed in-tree while this final was being edited; its verdict — all six
properties hold at `5c1421c`, property 6 restored — matches §8 and §9 and was
derived independently. H1/H2 remain exactly as stated in §9: no MCP client,
no live bandit or R1 on the execution path, no IDE surface, and ADR-006 stays
Proposed until a human accepts it — none of these refusals may be reopened by
citing this document.

## 11. Related in-repo reports

Status and evidence live in these documents; this note deliberately does not
restate them.

- [Status matrix](../status-matrix.md) — the authoritative capability grid
- [Developer Preview readiness](../reports/2026-08-20-developer-preview-readiness.md)
- [Gates readiness](../reports/2026-08-21-gates-readiness.md)
- [SOTA acceptance, 2026-08-24 loop, final](../reports/2026-08-24-sota-r3-acceptance.md)
- [SOTA acceptance, 2026-08-25 market-eval loop](../reports/2026-08-25-market-eval-sota-acceptance.md)
  — Round-3 companion to this final, landed in parallel with this edit
- [Isolation & privacy certification, Round 3](../reports/2026-08-24-sota-r3-isolation.md)
- [Kernel-reuse audit](../reports/2026-08-24-kernel-reuse-audit.md)
- [P0 privacy review package](../reports/2026-08-22-p0-privacy-review-package.md)
- [Node engine floor evidence](node-engine-floor.md) — Round-2 note behind the doctor message
- [MCP/interop position](mcp-position.md) — Round-2 position note, landed in
  parallel with this synthesis
- [Adaptive agent evidence brief](adaptive-agent-evidence.md) — prior survey of
  SWE-agent, OpenHands, RouteLLM, DSPy/GEPA, and Agent Lightning as mechanism
  sources rather than as competitors
- [Public scene prior](public-scene-prior.md) — why harness and model must not
  be compared in one number
