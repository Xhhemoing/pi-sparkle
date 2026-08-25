[Model: claude-opus-5-thinking-high-fast]

# Loop 4 · Round 8 — R8-8: freeze `INSPECT_SUMMARY` as additive

**Slot:** R8-8 (`bc-faed627a-27aa-592a-abaf-747f13f608fc`) · **Branch:** `agent/opt-continuous` (no commit, no checkout)
**Files changed:** `test/unit/run/inspection.test.ts` only (+59 / −10).
**Not changed:** `src/run/inspection.ts`, `src/cli/main.ts`, `src/run/events.ts`, `docs/**`, `package.json`. No runtime behaviour change; no `src/**` edit at all.

## 1. Verdict

The freeze is **declared**, not re-litigated. The shape signed off by the parent —
`{ type: "INSPECT_SUMMARY", runId, status, requiredEvidence }`, no `id`, `type` outside the `Event`
union, `--json` a pure event NDJSON stream, `--summary-json` mutually exclusive with `--json` — is now
stated in the test file header as a frozen additive contract and enforced by an exact key pin on both
branches (stalled and clean) plus a new pin that the type cannot enter the event vocabulary.

R1-fable was right that the *shape* was already pinned (`assert.deepEqual` has always rejected extra
keys). What was missing was the **declaration**: nothing said the four keys were a contract, so a
future diff adding a fifth key would read as "update the test to match the code" rather than "you are
changing a public machine-readable surface". That is what this slot fixes.

## 2. Census (before editing, 21:39 UTC; re-run at report time)

| Surface | State found |
|---|---|
| `test/unit/run/inspection.test.ts` | 12 tests; exact `deepEqual` on the summary at old `:459-464`; `--json` purity at old `:416-441`; clean-run pin asserted `status` + `requiredEvidence` only, not the key set. |
| `src/cli/main.ts:1092-1104` | Sole producer. Literal object, keys in order `type, runId, status, requiredEvidence`, comment "One object, not a domain Event". **Untouched** (R8-1 sole). |
| `src/run/inspection.ts` | The summary *type* does not live here — the CLI builds the object inline from `RunInspection.status` / `.requiredEvidence`. **Untouched**, see §5. |
| `src/run/events.ts:38-72` | `EVENT_TYPES` has no `INSPECT_SUMMARY` (and `validateEvent:803` refuses unknown types). Read-only import; R8-1 adding `RUN_UNBLOCKED` cannot break a non-membership assertion. |
| `docs/status-matrix.md:25` | Still says stability is "**not yet declared** … open Round 2 decision". R8-5's territory — prescribed sentence in §6. |
| Other slots in the working tree | R8-5 (`docs/**`), R8-6 (`catalog-observed.ts`), R8-7 (`coordinator.ts`), R8-9 (`bandit-store.ts`), R8-10, R8-3, R8-2 had landed edits. **No sibling touched `inspection.test.ts` or `inspection.ts`.** No line-number pin on `main.ts` was created, so nothing here races R8-1. |

## 3. What changed

1. **File header freeze declaration** (`test/unit/run/inspection.test.ts:1-8`). States the four keys, "no
   event `id`", "type outside the `Event` union", `--json` unchanged, existing keys never renamed /
   retyped / removed, and that a new key may only arrive in a diff that also updates
   `SUMMARY_CONTRACT_KEYS` and the exact-shape pins.
2. **`SUMMARY_CONTRACT_KEYS`** (`:37-42`), the doctor `CONTRACT_KEYS` idiom (`test/unit/cli/doctor.test.ts:159-169`,
   pinned with `assert.deepEqual(Object.keys(report), CONTRACT_KEYS)` at `:191`). Its docstring records
   that print order is *not* a consumer contract but is pinned anyway so a reshuffle is deliberate.
3. **The stalled-run pin is now load-bearing by name** (`:458`): `inspect --summary-json prints exactly the
   frozen INSPECT_SUMMARY keys, no more`. Adds `assert.deepEqual(Object.keys(summary), SUMMARY_CONTRACT_KEYS)`
   with `because` = "frozen additive: an extra enumerable key is a new public field, not an
   implementation detail", keeps the `id`-absence check, and keeps the exact `deepEqual` with a comment
   saying it *is* the freeze rather than a spot check of four values.
4. **The empty-evidence clean-run pin stays and is strengthened** (`:490-515`): same key pin (`because` =
   "the frozen key set does not vary with run state") and a full `deepEqual` against
   `{ type, runId, status: "COMPLETED", requiredEvidence: [] }`. Both prior assertions are preserved
   inside the stronger one.
5. **New test: `INSPECT_SUMMARY is outside the Event union and no log can carry it`** (`:517-536`). Asserts
   non-membership in `EVENT_TYPES` and that an otherwise well-formed row typed `INSPECT_SUMMARY` is
   refused by `validateEvent` with `/type must be a known event type/`. This is the executable form of
   parent rule 4; a future diff that "promotes" the summary to an event goes red twice.
6. **`--json` purity pin untouched** (`:431-455`) — still pins five lines, one event each, every line
   carrying an `id`, no `INSPECT_SUMMARY` line, exact type sequence. Its section comment was trimmed to
   stop duplicating the freeze declaration now in the header; no assertion changed.

## 4. Verification (this VM, Node v22.14.0)

- `npx tsc --noEmit` (whole tree, with every sibling's in-flight edit present): **exit 0**.
- `npx eslint test/unit/run/inspection.test.ts src/run/inspection.ts`: **exit 0**.
- `node --test --import tsx test/unit/run/inspection.test.ts` **3×**: `13 pass / 0 fail / 0 skipped` each
  time (12 → 13; +1 is the Event-union test). The polling test in this file is the timing-sensitive one,
  hence 3×.
- **Mutation check of the pins' discrimination** (in-memory `node -e`, no file written, no `main.ts` edit —
  it is R8-1's sole file and mid-flight). Every mutation is caught:
  extra key `id` vs the `Object.keys` pin; extra key `children` vs the `deepEqual` pin; `requiredEvidence`
  renamed to `evidence`; reordered keys; a dropped key. Five for five.
- No full gate (parent's job). No scratch files left: the report is the only file added.

## 5. Disclosures

1. **`src/run/inspection.ts` was not edited.** The dispatch allows a comment there "only if the summary
   type lives there" — it does not; the object is built inline in `main.ts:1096-1101` from
   `RunInspection.status` / `.requiredEvidence`. A comment in `inspection.ts` would name a contract
   defined in another file. The freeze therefore lives in the test-file header, which the task allows
   explicitly. A rename of `RunInspection.requiredEvidence` still cannot go unnoticed: it breaks
   `main.ts`'s compile, so `tsc` catches it before the pins do.
2. **A src-side one-liner is available but unowned.** If the parent wants the declaration next to the
   producer, `main.ts:1094`'s existing comment is the place, and it is R8-1's file. Suggested wording, to
   land with R8-1 or a later slot: `// Frozen additive (like doctor --json): these four keys never change` /
   `// or disappear; adding one means updating test/unit/run/inspection.test.ts's freeze pins.`
3. **Print order is pinned.** `Object.keys` equality also fails on a pure reorder in `main.ts`, which is
   harmless to JSON consumers. This matches doctor's `CONTRACT_KEYS` precedent and is recorded in the
   const's docstring; if a slot reorders the literal, updating the key list in the same diff is the fix.
4. **Nothing was pinned by line number in `main.ts`.** The contract is pinned end-to-end through `main()`
   on printed stdout, so R8-1's edits to that file cannot cause a false red here.
5. **Scope honesty.** This is a declaration plus tripwires, not new behaviour. `--summary-json` prints
   exactly what it printed before this slot.

## 6. For R8-5 (docs) — the exact matrix sentence

`docs/status-matrix.md:25` currently ends the summary clause with:

> `INSPECT_SUMMARY`'s stability is **not yet declared** (doctor `--json` is frozen; this is not) — open Round 2 decision.

Replace with:

> `INSPECT_SUMMARY` is **frozen additive**, like doctor `--json` (Round 8 sign-off): the four keys
> `type` / `runId` / `status` / `requiredEvidence` never change name, type, or meaning and are never
> removed, a new key may only land in a diff that also updates the exact-shape pins in
> `test/unit/run/inspection.test.ts`, and the type stays out of the `Event` union (pinned against
> `EVENT_TYPES` and `validateEvent`).

Also worth a docs touch, both optional and both R8-5's call:
- `README.md:55-58` and `:155` describe the flag correctly but claim no stability; adding "frozen
  additive" to the first would match the doctor entry's tone.
- `docs/reports/2026-08-24-sota-loop2-architecture.md:60-62` calls the missing stability declaration
  "open residue". It is a **dated report** — leave it as the historical record; the matrix is the live
  surface.
- The docs-slot census note at `docs/status-matrix.md:14-19` says no R8-8 freeze edit was present at
  21:41 UTC. It is now (test-only). One sentence in the end-of-round sync covers it.

## 7. Not done, deliberately

No field added; the summary did not become an `Event`; no `main.ts` edit; no ADR-006 touch; no live-R1
surface; no `package.json`. Option "mark it unfrozen-preview" (the loop-2 report's alternative) was not
re-litigated — the parent signed the additive freeze and this slot implemented that.
