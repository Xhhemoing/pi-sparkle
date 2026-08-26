# Loop 5 Round 3 — Fable-windows-ci: the two-line Windows cli-smoke for init/validate/list

Slot: Fable-windows-ci. Proposal only per brief: no src edits, no ci.yml edit, no commit.
Base: `cursor/pi-sparkle-sota-opt-0da8` @ `4e596f5`. Input: `loop5-r2-fable-aux.md` §2.3's
four-invocation smoke block, to be condensed to two lines that (a) do not collide with open
PR #12's `ci.yml` hunks and (b) do not rely on HOME redirection.

Verification method: direct reads of `.github/workflows/ci.yml`, `src/cli/validate.ts`,
`init-examples.ts`, `list.ts`, `model-catalog.ts`, `src/config/providers-config.ts`,
`src/routing/primary-catalog.ts`, `src/run/inventory.ts`, `src/privacy/state-layout.ts`,
`main.ts` dispatch; PR #12's `ci.yml` diff hunks extracted via `gh pr diff`; all three open PRs
(#9, #12, #13) checked for `ci.yml`/`.gitattributes` overlap; **the exact proposed two lines
executed at `/workspace`** (Linux leg; scratch dirs removed after); pwsh continuation semantics
confirmed against PowerShell RFC0046 / `about_Pipeline_Chain_Operators`.

---

## 1. The proposed step (exact YAML)

Appended as the **last step of the `cli-smoke` job** — i.e. after `Fake children and doctor`
(`ci.yml:73-74`), at the end of the file:

```yaml
      - name: New-verb smoke (init, validate, list)
        run: |
          pnpm cli init --dir smoke-examples --json && pnpm cli validate --children smoke-examples/sparkle-children.example.json &&
          pnpm cli validate --flowchart smoke-examples/sparkle-flowchart.example.json --state-root .sparkle-smoke-state && pnpm cli list --state-root .sparkle-smoke-state --json
```

Two run lines, four invocations, one fail-fast chain. Line 1 is the spec-file surface (`init`
writes into a scratch dir; `validate --children` re-reads what it wrote — the shipped
`init → validate` `next:` handoff, exercised for real). Line 2 is the state-root surface
(`validate --flowchart` builds the live catalog from an explicit fresh root; `list` reads the
same root). The step is OS-unconditional: the identical chain runs on the ubuntu leg under
`bash -e` (~3 s observed locally), so no matrix conditionals are needed.

## 2. Why the two-line `&&` chain is load-bearing, not cosmetic

**R2 §2.3's four-line block, as written, cannot fail on Windows for an init/validate breakage.**
`windows-latest` runs `run:` blocks under pwsh, and GitHub's pwsh wrapper prepends
`$ErrorActionPreference = 'stop'` (which governs cmdlet errors, **not** native-command exit
codes) and appends only a *final* `exit $LASTEXITCODE` check
([workflow-syntax docs, "Exit codes and error action preference"](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#exit-codes-and-error-action-preference)).
So in a plain multi-line block, a failing intermediate line does not fail the step — only the
last line's exit code counts. And the natural last line here, `list` against a fresh root, exits
0 unconditionally: a missing runs directory is an empty inventory by design
(`inventory.ts:76-85`). Net: the R2 block would stay green on Windows even if `init` and both
`validate` calls all broke. (On ubuntu the same block is safe because bash runs with `-e` — the
defect is Windows-only, i.e. on exactly the leg the step exists to prove.)

The chain fixes this on both shells:

- `&&` is a pwsh 7 pipeline-chain operator driven by `$?`/`$LASTEXITCODE`, so it short-circuits
  on native-command failure, and the failing command's code survives to the final
  `exit $LASTEXITCODE`. Precedent in this exact job: the existing smoke step already runs
  `pnpm cli version && pnpm cli help` cross-OS (`ci.yml:70-71`), so `&&` through the `pnpm.ps1`
  shim is proven here, not hypothesized.
- The line break after a trailing `&&` is legal in both shells: PowerShell RFC0046 —
  "After a pipeline chain operator, any newlines will be skipped in anticipation of the
  following pipeline" — and bash likewise continues after a line-final `&&`. The two YAML lines
  parse as one chain in pwsh and in bash.

Fallback if a reviewer dislikes cross-line continuation: split into **two one-line steps**
(line 1 and line 2 above, one `run:` each). The runner checks each step's exit code
independently and each line is a single short-circuiting chain, so honesty is preserved; cost is
four extra YAML lines. Do **not** compromise on two unchained lines in one block — that
reintroduces the last-exit-code hole for line 1 (a broken `validate --children` would go green
whenever line 2 still passes).

## 3. No HOME redirect, by construction

R2 §2.2(1)'s defect (`validate.test.ts` redirects `HOME`, which Windows `homedir()` ignores in
favor of `USERPROFILE`) is a class of bug this smoke sidesteps rather than fixes: **no
invocation ever reaches a `homedir()` call**, so there is nothing to redirect. Both
`defaultStateRoot()` helpers (`validate.ts:76-78`, `list.ts:69-71`) run only when `--state-root`
is absent. Per invocation:

1. `init --dir smoke-examples --json` — reads and writes no state root at all
   (`init-examples.ts:23`); paths via `resolve`, bodies written utf8 (`init-examples.ts:125-145`).
2. `validate --children <file>` — parses and compiles with the default cheap/premium policy;
   never consults a catalog or state root (`validate.ts:40-41, 129-141`).
3. `validate --flowchart <file> --state-root .sparkle-smoke-state` — the catalog is built from
   the explicit root: missing `providers.json` yields the empty config
   (`providers-config.ts:53-58`), zero enabled ids survive `tryParseModelRef` (bare `cheap`/
   `premium` are not `provider/model` refs), so `buildLiveCatalogConfig` returns
   `catalogFromPrimary` with the defaults (`model-catalog.ts:42-49`) — catalog ids exactly
   `["cheap","premium"]` (`primary-catalog.ts:5-6, 45-66`), which is precisely the example
   flowchart's `allowedModels` (`init-examples.ts:68-70, 79-82`). Deterministic pass; no
   network, no provider env vars, and **no write**: the scratch state root did not even exist
   after the local run.
4. `list --state-root .sparkle-smoke-state --json` — missing runs dir is an empty inventory,
   exit 0 (`inventory.ts:76-85`); prints the frozen one-line
   `{"type":"RUN_LIST","preview":true,"runs":[],"errors":[]}`.

Also autocrlf-immune: the chain validates the files `init` just wrote at runtime (LF source
constants), never the checked-out `examples/*.json`, so `core.autocrlf=true` on the Windows
runner touches nothing under test — and `JSON.parse` is line-ending-agnostic besides.

## 4. No collision with PR #12 (verified against its diff, not its file list)

PR #12 (OPEN, `cursor/merge-preview-release-8011`) touches `ci.yml` in exactly two hunks:

- `@@ -11,7 +11,8 @@` — `quality` matrix node pin `22.x` → `"22.19.0"` plus a comment
  (old lines 11-14).
- `@@ -43,11 +44,14 @@` — inserts the `Security probe` step after `Build` and pins the
  `cli-smoke` matrix node version (old lines 43-53).

The proposed step appends after old line 74 (end of file). The nearest #12 hunk ends at old
line 53, leaving 20+ untouched context lines between — far beyond git's default 3-line context,
so the two changes merge cleanly **in either order**; no "land after #12" sequencing is
required, only the general supervision the R1 review already set. Two secondary non-collisions:
the step leaves the `Fake children and doctor` line untouched (so #12's edit to
`cli-children.test.ts` is irrelevant — ci.yml only names the path, unchanged in #12), and the
step is indifferent to the node pin (`22.x` today resolves ≥ 22.19; the engines mismatch
observed locally on 22.14 is a pnpm WARN, not a failure). Re-checked all open PRs: #9 and #13
touch neither `ci.yml` nor any `.gitattributes`.

## 5. `.gitattributes` disposition — not needed for this step

The brief's conditional resolves to **no**. R2 §2.2(2)'s `.gitattributes` (`*.json text eol=lf`)
is a prerequisite only for putting `init-examples.test.ts`'s byte-identity pin on the Windows
matrix; this smoke never reads the checked-out `examples/` (§3), so it lands with zero repo
changes outside `ci.yml`. The deferred pair stays deferred, exactly as R2 ranked it:
`.gitattributes` + the `validate.test.ts` `HOME`→`USERPROFILE` fix unlock the *test-step*
extension (`validate.test.ts`, `init-examples.test.ts` on Windows) in a later slot. R2's
optional ride-alongs (`main-dispatch.test.ts`, `list.test.ts` in the smoke test step) are also
omitted here to keep this the two-line diff the brief asked for; both remain portable if wanted.

## 6. Verification performed

1. **The exact two lines were executed at `/workspace`** (bash leg): exit 0. Outputs, in order:
   the `INIT_EXAMPLES` object (two files under `smoke-examples/`);
   `valid: children 2 tasks → flowchart children (2 nodes)`;
   `valid: flowchart flw_example (2 nodes, 1 edges) checked against the live catalog at
   .sparkle-smoke-state`; the empty one-line `RUN_LIST`. `.sparkle-smoke-state` was never
   created (confirms validate's no-write claim and list's missing-dir tolerance). Scratch dirs
   removed; working tree left clean.
2. Dispatch confirmed: `main.ts:2183-2187` routes `validate`/`list`/`init`; `pnpm cli` is
   `tsx src/cli/main.ts` (`package.json:34`), the same entry the existing smoke step already
   uses, so no build step is needed before the new step.
3. `runtimeRoot` is a pure `join(stateRoot, "runtime")` (`state-layout.ts:25-27`) — no homedir
   fallback anywhere on the chain's path.
4. pwsh semantics: GitHub workflow-syntax docs (pwsh fail-fast appends only the final
   `exit $LASTEXITCODE`); PowerShell RFC0046 and `about_Pipeline_Chain_Operators` (newlines
   skipped after a trailing `&&`). The Windows leg itself remains unproven until the step runs
   on `windows-latest` — that is the point of landing it.

## 7. Recommendation to the parent

Land §1's step verbatim as the last step of `cli-smoke`, in its own small PR (or fold into the
campaign PR #13 branch — either merges cleanly against #12 per §4). Whoever lands it should
watch one thing on the first Windows run: both legs green with the four invocations visible in
the step log. Explicit NO_CHANGE beyond that: no `.gitattributes` (§5), no test-step additions,
no edits to the two existing smoke steps, no `HOME`/`USERPROFILE` manipulation anywhere.
