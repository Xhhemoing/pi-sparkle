# Loop 5 · Round 9 — GPT-r9 independent ranking/spec challenge

Verdict: keep the ranking and all three slots. **D34 FIX**, **D35 FIX**, **D36 KEEP**.
The FIXes correct operator contracts inside the selected files; neither needs a replacement batch.

## Method

- Audited at branch HEAD `328fbe5451f969fb14f29ba51db6fd886a244580`
  (`docs(agent): record Round 9 implementer dispatch ids`). Fable ranked
  `6bdeb4e943f7674615cb5668146b78905455dc6c`. `git diff --name-status
  6bdeb4e..HEAD -- src test` was empty, and the `models.ts`, `auth.ts`, and
  `validate.ts` blob ids were byte-identical at both commits. The intervening
  commits changed only reports/decisions/progress.
- Read `.agent_workspace/loop5-r9-fable-next.md`, D12/D16/D21/D24/D27/D28 and
  D31-D36 in `docs/agent-decisions.md`, live `src/cli/{models,auth,validate}.ts`,
  their three unit files, and `test/integration/cli/commands.test.ts`. Also read
  the called model-ref, providers-config, auth-session, children-spec,
  flowchart-io, model-catalog, and CLI-error seams to check the proposed
  classifications.
- Baseline command:
  `npx tsx --test test/unit/cli/models.test.ts test/unit/cli/auth.test.ts
  test/unit/cli/validate.test.ts test/integration/cli/commands.test.ts`
  passed **65/65**.
- Re-pulled `gh pr view 12 --json files,state,headRefName`: PR #12 is **OPEN**,
  head `cursor/merge-preview-release-8011`. None of `src/cli/models.ts`,
  `src/cli/auth.ts`, `src/cli/validate.ts`, or the four ranked test files is in
  its live file list.
- Seeded only `/tmp/r9-gpt-challenge/**` and ran the probes below through
  `pnpm cli`. Every quoted refusal exited 1; the two false/silent model answers
  exited 0. The VM is Node v22.14.0, so pnpm also printed the package's
  `>=22.19.0` engine warning; that did not affect the 65-test baseline or the
  reproduced command behavior.

## D34 — FIX (keep rank 1)

The slot is correctly ranked first. Live evidence confirms the core defects:

- `models enable banana` reported `command: "models"`, `stage: "validation"`,
  the generic doctor remedy, and `model id must be provider/model`.
- `models enable bogus/model` likewise used the generic doctor remedy instead
  of the catalog inventory.
- Disabling a model absent from `enabled` printed `Disabled
  anthropic/claude-fable-5` and exited 0.
- `models list --provider anthropic` printed the enabled
  `openai/gpt-5.2  primary`; the filter was silently ignored.
- The omitted value-domain case is live too: `models list --available
  --provider ""` printed `(no models)` and exited 0, while `models list
  --provider ""` printed all enabled models. Under Fable's proposed generic
  without-`--available` refusal, following “add --available” would still turn a
  malformed blank provider into a successful empty answer.

Keep Fable's `tryParseModelRef` guards, unknown-model `validation` class,
catalog retarget, and non-available `--provider` refusal, with these exact
corrections:

1. **Refuse a blank `--provider` before either list branch or config read.**
   When `values.provider !== undefined && values.provider.trim() === ""`,
   return `cliFail` with `command: "models list"`, `stage: "parse-args"`,
   `message: 'invalid --provider "<raw>": provider id must be a non-empty
   string'`, and `next: "pass --provider <id>, or omit --provider"`. This
   precedes the “requires --available” compatibility refusal. Nonblank unknown
   providers in available mode retain the deliberately pinned `(no models)`.
2. **Do not combine “nothing to disable” with a mutation that clears a
   dangling default.** A live fixture with `enabled: []` and `primary:
   "local/m1"` produced a default-removal note, proving that absence from
   `enabled` does not imply that `disableModel` does nothing. Partition the
   result from the already-loaded `before`:
   - present in `enabled`: call `disableModel`, keep `Disabled <raw id>`, then
     the existing dropped-default notes;
   - absent from `enabled`, but equal to `primary` and/or `fast`: call
     `disableModel`; say `No enabled entry for <formatted>; clearing dangling
     routing default references`, then print the existing exact per-role
     notes. Never say “nothing to disable” or “nothing changed” on this path;
   - absent from `enabled` and from both defaults: do not call
     `disableModel`; say `<formatted> was not enabled; routing configuration
     was already clear`, exit 0.
3. **Make the no-op test match the mutation contract.** Fable simultaneously
   requires calling `disableModel` and pinning raw `providers.json` bytes
   unchanged. Those requirements conflict: `disableModel` always calls
   `saveProvidersConfig`, whose pretty serializer rewrites the existing
   compact `writeCustomProviders` fixture even when semantic content is
   unchanged. With the three-way contract above, raw bytes are correctly
   unchanged only for the pure no-op; the dangling-default fixture must instead
   pin that the relevant default was removed.
4. **Do not interpolate an unquoted raw state-root into executable-looking
   `next` text.** Use, for example, `copy <provider/model> from pi-sparkle
   models list --available using the same --state-root` (and the corresponding
   `--primary` / `--fast` wording). This still directs custom-provider users to
   the right inventory without making a state-root containing spaces, `;`, or
   `$()` look copy-paste safe.

These are confined to `models.ts` and `models.test.ts`. `MODELS_LIST` remains
byte-identical.

## D35 — FIX (keep rank 2)

The selected refusal family is real and remains second. Live probes reproduced:

- unknown provider, conflicting login modes, and blank `--key` all escaped to
  main as `command: "auth"`, `stage: "validation"`, with the doctor remedy;
- unset builtin `--from-env` did the same even though its existing message
  already contains the real ambient/store remedies;
- the direct-command tests really do pin two throws with `assert.rejects`.

Keep Fable's blank positional folding, argv-before-config order, message
preservation for the already-pinned ordinary cases, and the proposed
parse-args/validation/preflight split. Correct these two remedies and one
missed D24-shaped value case:

1. **Unknown-provider inventory must use the same state root.** Live,
   `models list --available --provider local` at the default root printed
   `(no models)`, while the same command with
   `--state-root /tmp/r9-gpt-challenge/custom` printed `local/m1`. Therefore
   use `next: "pass a provider shown by pi-sparkle models list --available
   using the same --state-root; custom providers come from that root's
   providers.json"`. Do not embed the raw path.
2. **Split the unset-environment remedy by what was actually checked.**
   For a named custom `envVar`, use `set the providers.json envVar exactly as
   configured for <provider>, or store a credential with pi-sparkle auth login
   <provider> --key <key>`. For a builtin, use `configure one of the ambient
   sources named in the message, or store a credential with ...`. Fable's
   single text, “set the environment the message names”, is false for the
   builtin message: the live openai message names categories
   (environment variables, ADC files, AWS profiles), not one variable.
3. **Do not trim a custom envVar only when reporting its failure.** A live
   provider configured with `envVar: " PADDED_ENV "` checks that exact padded
   process-environment key, but the current refusal says `PADDED_ENV is unset`
   after `loginFromEnvCommand` trims it. Preserve the ordinary unpadded message
   bytes. When configured bytes differ from their trim, report:
   `provider <id> is not configured in the environment: providers.json envVar
   "<escaped raw value>" is unset or empty (whitespace is part of the variable
   name)`. Pin that setting only `PADDED_ENV` does not satisfy the probe and
   that the report identifies `" PADDED_ENV "` exactly, with no secret value.

The remaining Fable tests and envelopes stand. `AUTH_STATUS` is unchanged, and
no catch is added or widened.

## D36 — KEEP (rank 3)

Both defects and the proposed boundary are correct:

- missing `--children` and `--flowchart` paths emitted raw ENOENT at
  `stage: "execute"` with “fix the spec”;
- blank `--children ""` did the same;
- passing a directory produced coded EISDIR without even a path in the native
  message, so the proposed `cannot read --children <path>:` prefix materially
  repairs the answer.

Keep the blank-path parse-args guards and the existing catch order:
`DomainValidationError` remains a spec `validation` failure; a remaining coded
read error becomes `lookup` and names the selected flag; uncoded unexpected
errors retain `execute`. The EISDIR case is the right non-ENOENT pin.

One boundary is already implied by “the catalog-build catch is untouched” and
must remain explicit during review: flowchart catalog construction precedes
`parseFlowchartFile`. Live, a missing flowchart plus corrupt `providers.json`
reported the catalog `validation` failure, not path `lookup`. D36 does not
reorder those reads, so “unreadable flowchart paths become lookup” applies
after the live catalog builds successfully. That is faithful to the detailed
spec and needs no additional edit or test obligation.

## Ranking, freeze, PR #12, and held items

Ranking is sound: D34 has a successful false claim and a silently ignored
filter on routing configuration; D35 has more surfaces but already-correct
messages; D36 is a no-write preflight remedy defect. No replacement outranks
them on the reproduced evidence.

All corrected batches remain file-disjoint and avoid D31-D33 files. They do not
touch live R1/topology, ADR-006, `INSPECT_SUMMARY`, doctor JSON/routes,
`RunStatus`, Event types, package privacy, the crash probe, blocked-next, or D7
Variant B. Their success JSON contracts (`MODELS_LIST`, `AUTH_STATUS`,
`VALIDATE_OK`) stay byte-identical.

I agree with Fable's holds behind PR #12: pause/inject plane-owned failures,
unknown inject node, `unblock`/G5/G7/E4/cost/completions/`pref` in `main.ts`,
Windows/status/docs riders, and the PR-owned surfaces. I also agree with
NO_HIGH_VALUE on corrupt `providers.json`, unknown nonblank available-provider
empty results, free-form episode outcomes, F7/F15, new write-success JSON,
and D7. **Would un-hold none of those items.** Blank `models --provider` and
the padded custom envVar are same-file value-domain riders to D34/D35, not
replacement slots and not PR #12 work.
