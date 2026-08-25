model: claude-opus-5-thinking-high-fast

# R1-opus-A — redaction vs the live security probe

**Slot:** close redaction vs `scripts/security-probe.mjs`
**Branch:** `cursor/merge-preview-release-8011` (no commit, no push, no checkout — parent owns git)
**Node:** v22.14.0 · **pnpm:** 10.17.1 (`WARN Unsupported engine: wanted >=22.19.0` on every pnpm invocation; not hidden)

## Headline

**The redaction probe was already green before I touched anything, and it is still green.**
`src/feedback/redaction.ts` needed **no production change** — the file is byte-identical to
`HEAD` (`git diff --quiet src/feedback/redaction.ts` → clean). Per brief step 5 I added
**missing pin tests only** and made no cosmetic refactor.

The real finding is not a surviving core. It is that the gate was **under-pinned**: the tests
were a hand-copy of the probe's sample list with nothing forcing them to stay in sync, and the
probe drives redaction with a policy that **is not the one production persists with**.

## 1. Probe result — before

```
$ pnpm build && node scripts/security-probe.mjs
{
  "status": "ok",
  "passed": 14,
  "openFindings": [],
  "waivedFindings": []
}
PROBE_EXIT=0
```

14 passed = 13 redaction samples + 1 `packaged-secrets` entry. No `SECURITY_WAIVER` set.

## 2. Probe result — after

Identical, re-run against a fresh `pnpm build`:

```
{
  "status": "ok",
  "passed": 14,
  "openFindings": [],
  "waivedFindings": []
}
PROBE_EXIT=0
```

**Note for R1-opus-B / R1-fable-B:** `docs/specs/release-gate.md` dated 2026-08-22 says BLOCKED on
`pii-redaction` / `secret-bodies`. Against this tree that spec is **stale**, not accurate. The
probe exits 0. I did not edit the spec (not my file).

## 3. Census — all 13 probe samples against `dist/feedback/redaction.js`

Run with the probe's exact policy
(`redactPII: true, maxBodyChars: 400, forbiddenSubstrings: ["sk-","api_key","API_KEY","Bearer","BEGIN PRIVATE"]`).
`core survives` is the gate's own assertion; the other three columns are checks the gate does **not** make.

| # | probe id | sample | output body | core survives | idempotent | summary safe | whole record safe | classes |
|---|---|---|---|---|---|---|---|---|
| 1 | pii-redaction | email | `contact [email] now` | no | yes | yes | yes | `pii` |
| 2 | pii-redaction | ipv4 | `server [ipv4] up` | no | yes | yes | yes | `pii` |
| 3 | pii-redaction | phone-intl | `call [phone]` | no | yes | yes | yes | `pii` |
| 4 | pii-redaction | phone-cn | `phone [phone]` | no | yes | yes | yes | `pii` |
| 5 | pii-redaction | credit-card | `card [card]` | no | yes | yes | yes | `pii` |
| 6 | pii-redaction | unix-path | `see [path]` | no | yes | yes | yes | `pii,path` |
| 7 | pii-redaction | macos-path | `open [path]` | no | yes | yes | yes | `pii,path` |
| 8 | pii-redaction | windows-path | `saved [path]` | no | yes | yes | yes | `pii,path` |
| 9 | pii-redaction | windows-unc-path | `copied [path]` | no | yes | yes | yes | `pii,path` |
| 10 | secret-bodies | openai-key-body | `key [secret]` | no | yes | yes | yes | `secret,pii` |
| 11 | secret-bodies | api-key-value | `=[secret]` | no | yes | yes | yes | `secret,pii` |
| 12 | secret-bodies | bearer-token-body | `Authorization:  [secret]` | no | yes | yes | yes | `secret,pii` |
| 13 | secret-bodies | pem-private-key-body | `[secret]` | no | yes | yes | yes | `secret,pii` |

Every core is removed by a **value-removing transform**, not by the forbidden-substring strip.
Placeholders, idempotence and the existing `RedactionClass` taxonomy (`secret`, `pii`, `path`,
`prompt-injection`, `oversized`) are all preserved; no class was added or renamed.

### 3b. The gate policy is not the shipped policy

`scripts/security-probe.mjs` seeds `forbiddenSubstrings` with **`"Bearer"`**.
`FEEDBACK_REDACTION_POLICY` in `src/feedback/store.ts:111` does **not**:

```
store policy: {"redactPII":true,"maxBodyChars":400,
               "forbiddenSubstrings":["sk-","api_key","API_KEY","BEGIN PRIVATE"]}
```

So a green gate does not, on its own, prove the policy production writes records with is safe.
I re-ran all 13 cores under `FEEDBACK_REDACTION_POLICY`: **all 13 are still removed**, and the
bearer sample becomes `Authorization: Bearer [secret]` — the credential is removed by the
transform alone, with the scheme intact. That gap is now pinned by a test rather than left to luck.

## 4. Files changed

`src/feedback/redaction.ts` — **not changed** (verified byte-identical to `HEAD`).

### `test/unit/feedback/redaction.test.ts` (38 → 44 tests)

Added `classes` to each `GATE_CORES` row, plus six tests:

1. `release-gate cores classify under the existing taxonomy` — per-sample `decision.classes` and
   `feedback.redactionClasses`, and that no sample falsely claims `oversized`.
2. `release-gate cores stay removed when a stored record is redacted again` — record-level
   idempotence for all 13 (`appendFeedback` re-redacts records it reads back).
3. `release-gate cores survive nowhere in the persisted record, not just the body` — the same
   core carried in `summary`, checked against `JSON.stringify(record)`.
4. `every gate sample read straight from the probe loses its core` — **reproduces the gate
   in-process against `src/`**. Parses `redactionSamples` and the `policy` literal out of
   `scripts/security-probe.mjs` as text (importing it would run `npm pack` as a side effect) and
   drives `redactFeedback` with them. A sample added to the probe is exercised here immediately.
5. `GATE_CORES covers every sample the probe checks, verbatim` — drift guard; fails with
   `security-probe.mjs sample "<name>" has no GATE_CORES pin — add one`.
6. `GATE_POLICY is the policy the probe actually drives redaction with` — pins `redactPII`,
   `maxBodyChars` and the needle list against the script.

The parser was verified to read **13/13** samples and the policy exactly — it is not silently
matching a subset.

### `test/unit/privacy/redaction.test.ts` (6 → 9 tests)

This suite had **zero** `secret-bodies` coverage and no UNC path. Added:

1. `the shipped store policy removes every release-gate core from the body` — all 13 cores under
   `FEEDBACK_REDACTION_POLICY` with exact expected output (see 3b).
2. `no release-gate core survives anywhere in the persisted record` — body + summary, serialized.
3. `secret bodies lose the value, not just the recognisable prefix` — the failure mode the
   `secret-bodies` probe exists for, stated directly.

### `.agent_workspace/r1-opus-a.md`

This file.

No other file touched. I did not edit `src/cli/`, `src/run/flowchart-run.ts`,
`docs/specs/release-gate.md`, or `scripts/security-probe.mjs`. No probe sample core was changed.

## 5. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` on the 3 files | exit 0 |
| `test/unit/feedback/redaction.test.ts` + `test/unit/privacy/redaction.test.ts` | 53/53 pass |
| `test/unit/feedback` + `test/unit/privacy` (neighbours) | 153/153 pass |
| `pnpm build` | exit 0 |
| `node scripts/security-probe.mjs` | `ok`, 14 passed, exit 0 |

### Mutation testing — the new pins are not vacuous

Temporarily broke the UNC rule in `redaction.ts` (`\\\\` → `\\\\MUTANT`), then restored it:

```
not ok 12 - release-gate core is removed, not just labeled: windows-unc-path
not ok 17 - release-gate cores classify under the existing taxonomy
not ok 18 - release-gate cores stay removed when a stored record is redacted again
not ok 19 - release-gate cores survive nowhere in the persisted record, not just the body
not ok 20 - every gate sample read straight from the probe loses its core
not ok 31 - windows UNC shares are removed whole
not ok 51 - the shipped store policy removes every release-gate core from the body
# pass 46  # fail 7
```

Five of the seven are tests I added. Temporarily renaming one `GATE_CORES` entry produced the
drift-guard failure quoted in section 4. `redaction.ts` was restored from backup and re-verified
clean against `HEAD` after each mutation.

One negative result worth recording: breaking the **Bearer** rule changes nothing, because the
bare-JWT rule (`\beyJ...\....\....`) matches the same token. That is genuine defence in depth, not
a redundant rule — but it means the `bearer-token-body` sample alone does not exercise the Bearer
path. Anyone testing that rule needs a non-JWT bearer credential.

## 6. Remaining gaps

**None against the probe.** All 13 samples pass, under both the gate policy and the shipped store
policy. What follows is residual risk **outside** the probe's sample set, measured, not guessed
(`redactSensitiveText` on each shape). I did **not** add rules for these — step 5 restricted me to
pin tests — and I did **not** pin the misses as tests, because pinning a gap locks it in.

Not redacted today:

| Shape | Input | Why |
|---|---|---|
| IPv6 | `2001:0db8:85a3:0000:0000:8a2e:0370:7334`, `fe80::1ff:fe23:4567:890a` | no IPv6 rule exists |
| `Authorization: Basic` | `Basic dXNlcjpwYXNzd29yZDEyMw==` | only `Bearer` has a rule |
| DB URL credentials | `postgres://admin:hunter2@localhost:5432/app` | survives; the `db.internal` variant is only caught incidentally, by the *email* rule swallowing `hunter2@db.internal` |
| Screaming-snake env vars | `DATABASE_PASSWORD=hunter2supersecret` | `KEYED_SECRET_NAMES` needs `\b` before `password`; `_` is a word char, so `DATABASE_PASSWORD` never matches |
| Slack webhook URL | `https://hooks.slack.com/services/T0.../B0.../XXXX` | no rule |
| SSN / MAC address | `123-45-6789`, `00:1B:44:11:3A:B7` | no rule |
| US phone in parens | `(555) 123-4567` | `PHONE_E164` requires a leading `+`; `PHONE_CN_MOBILE` is CN-specific |
| Non-user Windows path | `D:\projects\client\secret.txt` | path rules are anchored on `Users\`/UNC by design |
| macOS temp path | `/var/folders/ab/cd12345/T/pi-auth.json` | not a home/`.ssh` shape |
| Bare hex secret | `9f8e7d6c5b4a39281706f5e4d3c2b1a0` | unkeyed high-entropy strings are deliberately not guessed at |
| `ssh-rsa` public key | `ssh-rsa AAAAB3Nza... user@host` | public key, low severity |
| Leading-dot relative `.ssh` | `.ssh/id_rsa` with no preceding `/` | the `.ssh` rule requires a leading slash; `foo/bar/.ssh/id_rsa` works |

Confirmed working beyond the probe set (unpinned, but correct): EC and OPENSSH PEM blocks, Amex
and 13-digit Visa (Luhn + IIN), UK `+44` numbers, plus-addressed and multi-label emails, bare JWTs,
`~/.aws/credentials`, and nested JSON `{"token":"..."}`.

The `DATABASE_PASSWORD=` miss is the one I would rank first for Round 2 — it is a one-character
regex change (`\b` → a boundary that tolerates `_`), it is an extremely common shape in pasted
logs, and it is the only entry above where the rule *intends* to match and does not.

## 7. Requests to other slots

- **R1-gpt-A** (owns `scripts/security-probe.mjs`): the probe is not buggy — do not loosen it.
  Two strengthenings worth considering, both of which my tests already cover on the `src/` side:
  (a) import `FEEDBACK_REDACTION_POLICY` from `dist/feedback/store.js` instead of hand-writing a
  policy with an extra `"Bearer"` needle, so the gate tests what production ships;
  (b) assert on `JSON.stringify(feedback)` rather than `feedback.body`, so a core surviving in
  `summary` fails the gate. If you add samples, `test/unit/feedback/redaction.test.ts` will tell
  you exactly which pin is missing.
- **R1-opus-B / R1-fable-B**: `docs/specs/release-gate.md` is stale on `pii-redaction` and
  `secret-bodies` — both are green on this tree, evidence in sections 1–3. The remaining
  `prerelease` bars (`packaged-secrets`, `pi:probe`, the Node engine mismatch) are not mine and I
  make no claim about them. P0 privacy human sign-off is untouched by this work.
