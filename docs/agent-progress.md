# Agent progress

Parent branch: `cursor/pi-sparkle-sota-opt-0da8`
Campaign: Loop 5 — usability and competitiveness (not Loop 4 honesty-hole hunting)
Started: 2026-08-25

Loop 4 closed Round 20 with 2 ACCEPT landings (`taskCostCeilings`, targeted `steerText`) and recorded Round 21 as a **zero-slot** honesty round. This campaign does **not** re-audit frozen honesty contracts. It adds operator-facing capability so a developer-preview user can find runs, validate specs before spending a run, and scaffold examples — then keeps covering the rest of the tree.

## ROUND 0 (parent bootstrap)

| Field | Value |
|---|---|
| 检查模块 | Repo map, CLI command surface, status matrix, Loop 4 closeout, open PRs |
| 发现问题 | No `list` of runs/episodes (inspect/resume/delete require a known id). No `validate` of children/flowchart JSON without starting a run. No example scaffold. Doctor inventories only PLANNING/RUNNING. PR #12 (open) already carries `--max-cost-usd` / `inspect --follow` — do not duplicate. |
| 解决问题 | Open Loop 5 tracker docs; dispatch Round 1 (5 Fable + 2 GPT-5.6-sol + 3 Opus). |
| 测试结果 | n/a (docs only) |
| Commit | (this file + `docs/agent-decisions.md`) |
| PR | to be opened on `cursor/pi-sparkle-sota-opt-0da8` |
| Merge 状态 | open |
| Blocked | Host Node v22.14.0 < engines `>=22.19.0` (warning only; CI pins 22.x). P0 privacy human sign-off still open. Checkpoint F-PROD still open — live R1/bandit/topology stay off the execution path. |
| 下一轮重点 | Land `list` / `validate` / `init` examples after Fable+GPT challenge; then cover track loop, cost UX, retention diagnostics, completions. |

## ROUND 1 (in flight)

Dispatched 2026-08-25. Cloud new-VM cap is 3, so Round 1 mixed cloud VMs and local Task agents. **No model slug was silently downgraded.**

| Agent | Model | Where | Id |
|---|---|---|---|
| Fable-map | claude-fable-5-thinking-xhigh | cloud VM | `bc-dffa02de-b813-5bda-9bde-2b34ab2301d2` |
| Fable-cli | claude-fable-5-thinking-xhigh | local Task | `bc-9a3dad9c-db2d-52b3-8036-4d8a40c33c2d` |
| Fable-runtime | claude-fable-5-thinking-xhigh | local Task | `bc-d77433cf-d7e9-517e-988c-44015159ca78` |
| Fable-adapt | claude-fable-5-thinking-xhigh | local Task | `bc-00a6633b-6f82-5fdd-b065-bfff94f458b6` |
| Fable-persist | claude-fable-5-thinking-xhigh | local Task | `bc-700b6a78-b566-5102-b8a4-91709694d1d6` |
| GPT-challenge | gpt-5.6-sol-xhigh-fast | local Task | `bc-f57079ff-be82-5bdb-ade9-cc89b17d2ab5` |
| GPT-frozen | gpt-5.6-sol-xhigh-fast | cloud VM | `bc-603f570e-6d30-571f-98a2-acd354826ebf` |
| Opus-list | claude-opus-5-thinking-high-fast | local Task (no `main.ts`) | `bc-76c936c0-0e3d-5bbb-a0b2-34ea7c1e52b8` |
| Opus-validate | claude-opus-5-thinking-high-fast | cloud VM | `bc-3ca9557e-81c9-5fe7-ae9e-1a1e3959128a` |
| Opus-init | claude-opus-5-thinking-high-fast | local Task (no `main.ts`) | `bc-c618ad5b-5ff2-5e9f-acf8-97a8add58731` |

Deviation from 5/3/2: none. Local implementers were forbidden from editing `src/cli/main.ts` so they cannot clobber each other. Cloud Opus-validate landed `validate` + `parseChildSpec` extract (merged). Opus-wire is dispatching `list`/`init`.

## ROUND 1 (closeout)

| Field | Value |
|---|---|
| 检查模块 | CLI, runtime journeys, adaptation product UX, persist/privacy, frozen contracts, feature map |
| 发现问题 | No run catalog; no no-write spec check; no flowchart example; `--track` wait is a dead end; adapt promote unusable without dumped blobs; delete lock-timeout docs overclaim “removes nothing”; `unblock` missing from README; `adapt eval`/`rollback` hidden |
| 解决问题 | `validate` dispatched (then live-catalog parity in `42b4c6c`). `list`/`init` dispatched (`679553e`). README documents `unblock`/`list`/`validate`/`init`/`adapt eval`. D6 KEEP `init`. Garbled `--track` USAGE paragraph repaired. |
| 测试结果 | list 19 pass; validate 9 pass ×3 + broader CLI suites on the cloud VM; init unit tests present |
| Commit | merge validate; list module; init preserved; reports under `.agent_workspace/loop5-r1-*` |
| PR | https://github.com/Xhhemoing/pi-sparkle/pull/13 |
| Merge 状态 | open (draft) |
| Blocked | P0 human sign-off; Checkpoint F-PROD; PR #12 not duplicated (`inspect --follow`, `--max-cost-usd`) |
| 下一轮重点 | Round 2 in flight: track-clarification dead end; adapt show+dataset; delete-disclosure honesty |

## ROUND 2 (closeout)

| Field | Value |
|---|---|
| 检查模块 | Track wait, adaptation promote tooling, delete honesty, context/tracking, auth/models, review fabric, aux CLI/Windows |
| 发现问题 | Track wait dead end; promote unusable; delete “removes nothing” lie; `ANALYSIS_QUEUED` withholds cause; `--from-env` not an env check; `q-scope` unused; review fabric library-only; Windows smoke skips new verbs |
| 解决问题 | inspect shows track questions + refuse-answer; `adapt show`/`dataset`; delete two-half contract + lock-wait; README `runtime/auth.json` |
| 测试结果 | Track clarification 5 pass; adapt full suite 2110 on implementer VM; delete pins added |
| Commit | merges on `cursor/pi-sparkle-sota-opt-0da8` |
| PR | https://github.com/Xhhemoing/pi-sparkle/pull/13 |
| Merge 状态 | open (draft) |
| Blocked | P0; F-PROD; PR #12 merge-order |
| 下一轮重点 | Auth login honesty; blocked-run gate-cause visibility; promotion-review verdict fail-closed; same-episode track continuation (design only until Round 3 implements) |

## ROUND 3 (in flight)

| Agent | Model | Role |
|---|---|---|
| Fable-r2-review | claude-fable-5-thinking-xhigh | Round 2 comprehensive review |
| Fable-gate-cause | claude-fable-5-thinking-xhigh | How to surface ANALYSIS_QUEUED cause without freeze breaks |
| Fable-commits-ep | claude-fable-5-thinking-xhigh | episode close disclosure + inject help |
| Fable-windows-ci | claude-fable-5-thinking-xhigh | Safe Windows smoke for new verbs (after PR #12) |
| Fable-status-matrix | claude-fable-5-thinking-xhigh | Status-matrix rows for list/validate/init/commits |
| GPT-r2-challenge | gpt-5.6-sol-xhigh-fast | Independent challenge of Round 2 landings |
| GPT-auth-challenge | gpt-5.6-sol-xhigh-fast | Challenge auth-fix plan (don’t over-fit Pi checkAuth) |
| Opus-auth | claude-opus-5-thinking-high-fast | Login flag exclusivity + --from-env honesty |
| Opus-gate | claude-opus-5-thinking-high-fast | inspect/blocked report: real gate reason |
| Opus-review-verdict | claude-opus-5-thinking-high-fast | parsePromotionReview fail-closed + q-scope |

### Round 3 landings so far

- Promotion verdicts fail-closed + `q-scope` consumed (`8b4c077`).
- Gate-cause visibility (`3140a96` + D11): inspect prose + blocked-report `note:`; `--summary-json` still four keys; blocked-next prefix preserved; note does not imply a live queue; `deterministic-fail` pinned; pairing requires `queue_analysis`/`BLOCKED` and hash+seq. Implementers: Opus-gate (`bc-592622fe-056e-51b0-914c-452730915dda`), Opus-gate-cause-wording (`bc-2b319194-6959-5f57-ad5b-9ab929d5add1`).
- Fable R2 comprehensive review recorded in `.agent_workspace/loop5-r2-review.md` (no `src/` regressions at its HEAD; ranked leftovers match GPT-r2 on T1/T2/dataset HOLD).
- Auth login honesty (`merge` of `4a99475`, D12 repair merged): exclusive flags; empty-store `--from-env`; corrupt `auth.json` no longer fails a valid env check; stored-OAuth `--from-env` pins; ambient-auth wording. Implementers: Opus-auth (`bc-2cb21e4b-64c0-584a-a85e-6056b248c6d4`), Opus-auth-from-env-fix (`bc-6082d484-2067-5a97-9f85-d83db4347b61`).
- Track T1+T2 merged (D8/D9): fail-closed `answer` without a correlatable pending QUESTION; continuation facts not a copy-paste shell line. Implementer: Opus-track-t1-t2 (`bc-95aaadd3-a9db-5013-9e71-e9c72feb3be3`).
- Catalog honesty merged (D13): one-primary catalogs emit `cheap` and `premium`; validate `next:` names `models disable`; init examples go through real parsers. Implementer: Opus-catalog-honesty (`bc-12eb428f-7801-5301-b187-fcadc1e1b61a`).
- Episode close disclosure, inject/pause `--help`, commits `cliFail` + `COMMITS_PREVIEW`. Implementer: Opus-aux-cli (`bc-d26ab175-1565-5484-a810-e3fbea3e18aa`).
- Dataset privacy (D10): redact-then-excerpt, redacted workspace once per manifest, `delete --run` cascade, runtime-plane `--dir` refusal. Implementer: Opus-dataset-privacy (`bc-e457a143-0d09-5e0f-9549-34470ad99c12`).
- Not-found retarget (D15): episode/pause/inject lookup `next:` points at `list`. Implementer: Opus-g6-list-retarget (`bc-1aa549ae-eada-5346-bcdd-928bcb75f742`).
- `INIT_EXAMPLES --json` is one compact line (D17). Implementer: Opus-init-json (`bc-3d5df502-d602-5e2d-94f0-beee62ee6291`).
- Auth remainder D16: secret mute, doctor `auth` preflight, custom `--available`. Implementer: Opus-auth-echo-doctor-F8 (`bc-740e3587-69a2-5ce1-836d-398139fdba28`). GPT-d16-recheck **KEEP**.
- D18 default eval-dataset leaf-symlink bind/refuse. Implementer: Opus-dataset-symlink-cascade (`bc-83d49ea6-9b87-5659-9b3e-14d88c42e729`). GPT-d18-recheck **FIX** (pathname equality ≠ directory identity).
- D19 default-export directory-identity bind. Implementer: Opus-d19-publish-identity (`bc-2ad751d1-e327-5807-8907-90a681f9aeac`). GPT-d19-recheck **FIX** (restored bound directory, missing manifest).
- D23 bound-dir `manifest.json` exists check. Implementer: Opus-d23-manifest-exists (`bc-5c880308-f7bb-5147-8c7c-a61c4917d8e2`). GPT-d23-recheck **KEEP**. `adapt dataset` merge-ready.
- D20 claim-only-what-happened CLI. Implementer: Opus-d20-cli-honesty (`bc-ef8d6111-15dc-5bf1-a83c-c80ed59b5b93`). GPT-d20-recheck **KEEP**.
- D21 auth/models remainder. Implementer: Opus-d21-auth-models (`bc-c4dd2d65-355c-5243-940b-875d1e342896`). GPT-d21-recheck **FIX** (source-column trim drift).
- D24 auth source-column bytes. Implementer: Opus-d24-source-column (`bc-8560fd72-b9e6-5224-9b23-adfbbd730a4e`). GPT-d24-recheck **KEEP**.
- D22 doctor storage inventory. Implementer: Opus-d22-doctor-storage (`bc-c72bed86-cb4e-5126-888e-eca802cc5b0c`). GPT-d22-recheck **KEEP**.
- D25 `list` truncation disclosure + `--sort last-event`. Implementer: Opus-d25-list-sort (`bc-dd11ca58-f52f-510e-bf63-b89d5a9dda31`). GPT-d25-recheck **KEEP**.
- D26 one-dialect argv/`--help` on six free verbs. Implementer: Opus-d26-argv-help (`bc-2a2a0515-81de-5318-9557-6bef72169e03`). GPT-d26-recheck **KEEP**.
- D27 `models list --json` stored-config contract. Implementer: Opus-d27-models-json (`bc-273c089d-f7b4-564b-bd04-10e34d162330`). GPT-d27-recheck **KEEP**.
- D28 `auth` dialect + `AUTH_STATUS`. Implementer: Opus-d28-auth-json (`bc-c17f189d-a482-578b-91d0-076b8cccb958`). GPT-d28-recheck **KEEP**.
- D29 `doctor --help` and parse-args dialect. Implementer: Opus-d29-doctor-help (`bc-2b9bd5c6-42e8-5a7c-9a18-124a87293e4f`). GPT-d29-recheck **KEEP**.
- D30 inject `--type`/`--confidence` preflight. Implementer: Opus-d30-inject-preflight (`bc-7a73aace-288e-5058-8373-06bd7f016050`). GPT-d30-recheck **KEEP**.

### Round 6 (closed)

Fable-r6-next ranked three file-disjoint batches (`.agent_workspace/loop5-r6-fable-next.md`): D25 `list` truncation/`--sort`, D26 argv dialect/`--help`, D27 `models list --json`. GPT-r6-challenge: D25 **FIX**, D26 **KEEP**, D27 **FIX**. All three merged after independent KEEP rechecks.

| Slot | Landing | Recheck |
|---|---|---|
| D25 | merged `85c1feb` from `cursor/list-truncation-sort-0da8` `02ef2f4` | GPT-d25-recheck **KEEP**. Report: `.agent_workspace/loop5-r6-gpt-d25.md`. |
| D26 | merged `e9c4d77` from `cursor/argv-help-dialect-0da8` `25742b4` | GPT-d26-recheck **KEEP**. Report: `.agent_workspace/loop5-r6-gpt-d26.md`. |
| D27 | merged `b927921` from `cursor/models-list-json-0da8` `c83fc99` | GPT-d27-recheck **KEEP**. Report: `.agent_workspace/loop5-r6-gpt-d27.md`. |

### Round 7 (closed)

Fable-r7-next ranked three file-disjoint batches (`.agent_workspace/loop5-r7-fable-next.md`) at `786f23e`: D28 `auth` dialect + `AUTH_STATUS`, D29 `doctor --help`, D30 inject `--type`/`--confidence` preflight. GPT-r7-challenge: D28 **FIX**, D29 **KEEP**, D30 **FIX**. All three merged after independent KEEP rechecks.

| Slot | Landing | Recheck |
|---|---|---|
| D28 | merged from `cursor/auth-dialect-json-0da8` `4d3fcc4` | GPT-d28-recheck **KEEP**. Report: `.agent_workspace/loop5-r7-gpt-d28.md`. |
| D29 | merged `012eabd` from `cursor/doctor-help-dialect-0da8` `0244549` | GPT-d29-recheck **KEEP**. Report: `.agent_workspace/loop5-r7-gpt-d29.md`. |
| D30 | merged from `cursor/inject-preflight-0da8` `c2be255` | GPT-d30-recheck **KEEP**. Report: `.agent_workspace/loop5-r7-gpt-d30.md`. |

### Round 8 (closed)

Fable-r8-next ranked three file-disjoint operator batches (`.agent_workspace/loop5-r8-fable-next.md`) at `33e8cf3`. Through-line: after D21/D26–D30 fixed *which flags* you pass, four free files still forwarded *flag values* unchecked. GPT-r8-challenge: D31 **KEEP**, D32 **FIX** (blank `--repo`), D33 **FIX** (subcommand order + escape). All three merged after independent KEEP rechecks (D33 after a test-pin rider).

| Slot | Landing | Recheck |
|---|---|---|
| D31 | merged `393f164` from `cursor/pause-inject-value-preflight-0da8` | GPT-d31-recheck **KEEP**. Report: `.agent_workspace/loop5-r8-gpt-d31.md`. |
| D32 | merged `53dccde` from `cursor/commits-refusal-retarget-0da8` `c91af7b` | GPT-d32-recheck **KEEP**. Report: `.agent_workspace/loop5-r8-gpt-d32.md`. |
| D33 | merged `82e6ad4` from `cursor/episode-id-events-lines-0da8` `08219b2` | GPT-d33b-recheck **KEEP**. Report: `.agent_workspace/loop5-r8-gpt-d33b.md`. |

### Round 9 (closed)

Fable-r9-next ranked three file-disjoint operator batches (`.agent_workspace/loop5-r9-fable-next.md`) at `6bdeb4e`. Through-line: config-plane verbs and the spec checker still threw value and environment faults into generic catches. GPT-r9-challenge: D34 **FIX**, D35 **FIX**, D36 **KEEP**. All three merged after independent KEEP rechecks.

| Slot | Landing | Recheck |
|---|---|---|
| D34 | merged `de2f459` from `cursor/models-id-preflight-0da8` `09c2f0d` | GPT-d34-recheck **KEEP**. Report: `.agent_workspace/loop5-r9-gpt-d34.md`. |
| D35 | merged `2afc5f8` from `cursor/auth-login-envelopes-0da8` `a8e80d5` | GPT-d35-recheck **KEEP**. Report: `.agent_workspace/loop5-r9-gpt-d35.md`. |
| D36 | merged `367bd45` from `cursor/validate-path-retarget-0da8` `2e9d35e` | GPT-d36-recheck **KEEP**. Report: `.agent_workspace/loop5-r9-gpt-d36.md`. |

### Round 10 (implementing)

Fable-r10-next ranked three file-disjoint operator batches (`.agent_workspace/loop5-r10-fable-next.md`) at `acd2eb7`. Through-line: Rounds 8–9 made free verbs honest about *which flags and values* they were given; Round 10 makes them honest about *which tree they acted on*. GPT-r10-challenge: D37 **FIX**, D38 **FIX**, D39 **FIX** (ranking stands). Implementers apply the GPT-corrected contracts; do not merge until independent KEEP rechecks.

| Slot | Owns | Spec |
|---|---|---|
| D37 | `src/cli/{list,pause,inject,commits,models,auth,validate}.ts` + six test files | Rank 1 as corrected by `.agent_workspace/loop5-r10-gpt-challenge.md` |
| D38 | `src/cli/{init-examples,migrate-legacy}.ts` + three test files | Rank 2 as corrected |
| D39 | `src/cli/episode.ts` + `test/integration/m3/episode-cli.test.ts` | Rank 3 as corrected |

HOLD still binding unless live evidence un-holds: pause/inject on non-flowchart or terminal runs and unknown inject node (`flowchart-run.ts` / `main.ts`, PR #12); `unblock` / G5 / G7 / E4 / cost / completions / `pref` in `main.ts`; blank `--state-root` on verbs that parse the flag inside `main.ts`/`adapt.ts`; Windows smoke / status-matrix / README riders; corrupt `providers.json` (doctor remedy actually works); corrupt run logs (doctor names the file); `models list --available --provider <unknown>` `(no models)` pinned; F7 / F15; D7 Variant B; `episode close --outcome` any-string.

| Slot | Agent | Model | Where | Id |
|---|---|---|---|---|
| Fable-r10-next | Fable | claude-fable-5-thinking-xhigh | cloud | `bc-d3b26848-9908-5f90-b05f-0bd46a293238` |
| GPT-r10-challenge | GPT | gpt-5.6-sol-xhigh-fast | cloud | `bc-94104804-bdd4-594f-bd13-43082c0eb54b` |
| D37 | Opus-d37-blank-root | claude-opus-5-thinking-high-fast | cloud | `bc-fb7045fe-765d-5c12-b910-f0781db04580` |
| D38 | Opus-d38-init-migrate | claude-opus-5-thinking-high-fast | cloud | `bc-cdef25b0-6684-5232-a444-1c8ff7ffe823` |
| D39 | Opus-d39-episode-logs | claude-opus-5-thinking-high-fast | cloud | `bc-36e1f0fe-b786-5a7d-8b54-438bfc9d26b4` |
