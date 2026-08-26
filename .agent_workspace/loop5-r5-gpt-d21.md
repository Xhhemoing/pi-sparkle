# Loop 5 Round 5 — GPT D21 independent review

Reviewed fetched `origin/cursor/pi-sparkle-sota-opt-0da8` at `96fd39b`
(`5d502be` plus the later D21 documentation commit). Analysis only; no
application source was edited and no commit or push was made.

## Verdict

**FIX.**

The keyless-custom refusal, five-site `cliFail` conversion, F9, F13, F14, and
the freeze constraints are present. The custom source classifier does not
quite implement the specified equality, however: it trims the configured
`envVar` before comparing it with the resolver's untrimmed `check.source`.
The builtin-source explanation also calls the two-variable AWS access-key path
a non-environment branch, which is false for the pinned Pi implementation.

## Blocking findings

### F1 — Custom `envVar` equality is changed by trimming

`parseProvidersConfig` preserves `entry.envVar` unchanged
(`src/config/providers-config.ts:183-189`), and `buildCustomProvider` passes
that unchanged value to `envApiKeyAuth` (`src/pi-adapter/runtime.ts:99-108`).
Pi returns that configured name as `check.source` when the variable resolves.

`sourceLabel`, however, compares `check.source` with
`custom.envVar?.trim()` (`src/cli/auth.ts:154-160`). An accepted custom config
whose `envVar` is `" PADDED_KEY "` therefore resolves through exactly that
configured environment variable but is labelled `ambient`, not `env`.

Independent probe:

```text
padded                       ambient    PADDED_KEY 
```

This fails D21's exact rule: a custom row is `env` when `check.source` equals
the configured `envVar`, otherwise `ambient`. The implementation must either
compare the preserved configured value or normalize the value consistently at
config parsing, runtime resolution, and display. The existing tests cover an
ordinary name and a keyless source collision, but not normalization drift.

### F2 — The builtin live-variable explanation is not honest for AWS access keys

The comment justifying the builtin heuristic says the non-environment
file/profile/role branches include `"AWS access keys"`
(`src/cli/auth.ts:140-147`). In pinned Pi 0.84.3, that source is returned
specifically after both `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` resolve
from the environment
(`@earendil-works/pi-ai/dist/providers/amazon-bedrock.js:63-80`).

Because `sourceLabel` tests `process.env[check.source]`, normal AWS access-key
environment configuration is shown as:

```text
amazon-bedrock               ambient   AWS access keys
```

The live-variable heuristic is permitted by the D21 rider, but its limitations
must be documented truthfully. The current explanation incorrectly describes
this two-variable environment path as a file/profile/role path and the tests do
not pin the resulting builtin classification.

## Review checklist

### 1. Keyless-custom login refusal — PASS

`--key`, `--oauth`, and interactive login all reach the keyless-custom guard
before either storage helper (`src/cli/auth.ts:207-235`). The error says the
request resolver ignores `auth.json`, recommends configuring `envVar`, and
names the per-run `PI_API_KEY` compatibility override for the selected default
provider. It neither claims requests always carry no key nor advises removing
the flag. The three-mode test also proves an existing `auth.json` is
byte-for-byte unchanged (`test/unit/cli/auth.test.ts:409-450`).

### 2. Source column — FAIL

The normal custom cases are correct: a source equal to the configured
`envVar` is `env`, while keyless/file/profile-style sources are `ambient`.
F1 violates the exact configured-value equality, and F2 is the requested
builtin-documentation honesty issue.

### 3. Missing-argument conversion — PASS

There are exactly five new `cliFail` reports at stage `parse-args`:

- auth login/logout (`src/cli/auth.ts:176-183,350-356`);
- models enable/disable/set-default
  (`src/cli/models.ts:127-133,148-154,184-190`).

The two unknown-subcommand branches remain in their prior dialect. The landed
D21 documentation claims five, not six; the challenge document mentions six
only to reject that count.

### 4. F9, F13, F14, and footprint — PASS

- F9 reads the pre-mutation defaults and emits one dropped-default note for
  each matching `primary`/`fast` role (`src/cli/models.ts:156-171`).
- F13 always prints a no-stored-credentials notice for an empty store and,
  under `--all`, an explicit no-environment-providers line when no row was
  emitted (`src/cli/auth.ts:94-122`).
- Optional F14 appends `(not in catalog)` when an enabled model no longer
  resolves (`src/cli/models.ts:101-117`).
- The D21 range changes only `src/cli/auth.ts`, `src/cli/models.ts`, their two
  unit tests, and later documentation. Neither `src/pi-adapter/runtime.ts` nor
  `src/cli/main.ts` changed.

### 5. Freeze — PASS

The D21 range does not change `src/cli/doctor.ts` or `src/run/events.ts`.
Doctor's `auth` check retains stored-first/ambient-second resolution, and no
Event type was added.

## Verification

- Focused `auth.test.ts` and `models.test.ts`: **29/29 pass**.
- `pnpm typecheck`: **pass**.
- Independent custom/builtin source-label probe: **reproduced F1 and F2**.
- Dependencies were absent; `pnpm install --frozen-lockfile` completed without
  changing the lockfile.
- Runtime: Node `v22.14.0`; package engine requires `>=22.19.0`. pnpm
  `10.17.1` emitted the unsupported-engine warning, but both requested checks
  completed successfully.
