model: claude-fable-5-thinking-xhigh

# 发行内测 (developer preview) release gap vs SOTA — 2026-08-25

Slot: R1-fable-B on `cursor/merge-preview-release-8011`, HEAD `e88f2ce`.
Scope: what blocks an honest developer-preview 内测 — defined as **`pnpm
prerelease` green + a documented preview**, not an npm publish. All commands
below were run live in this slot on 2026-08-25 (Node v22.14.0, pnpm 10.17.1)
against a `dist/` rebuilt from HEAD in the same session (`pnpm build`, exit 0).

## The call

**The release-gate spec's BLOCKED status is stale. The live security probe is
GREEN.** For 内测 the call is **conditional GREEN**; for npm publish the call
is **BLOCKED, unchanged and intentional** (`private: true` stays).

The conditions on the 内测 GREEN, none of which is a security finding:

1. `docs/specs/release-gate.md` must be truthed-up to the live probe result
   (R1-opus-B owns that file; this report is its evidence).
2. The parent must run the full `pnpm prerelease` on the merged Round 1 tree
   and get exit 0 — this slot verified every leg it could run cheaply
   (typecheck, build, security:probe, pi:probe all exit 0) but did not run the
   test suite, and lint is transiently red in the shared working tree (§5).
3. The certifying run should happen on a host that satisfies
   `engines.node >=22.19.0` (CI's `22.x` does; this VM does not — §3).

No waiver was used or is needed. `packaged-secrets` passed clean and remains
never-waivable. Nothing here claims P0 privacy closed or anything
Outcome-supported.

## 1. Spec stale vs probe red — resolved: spec stale, probe green

`docs/specs/release-gate.md` (Status dated 2026-08-22) lists two open
findings:

| id | spec's claim | current code | live probe |
|---|---|---|---|
| `pii-redaction` | "email/IP/phone/CN-phone/credit-card/paths survive `redactFeedback`; the flag labels but never removes" | `src/feedback/redaction.ts` replaces values with stable placeholders: email (TLD-validated), IPv4, E.164 + CN-mobile phones, Luhn-valid cards with IIN filter, home/`~`/`.ssh`/UNC/`Users\` paths (`PATH_RULES`, `redactPersonalData`) | all 9 samples pass |
| `secret-bodies` | "secret stripping removes only literal prefixes; key values survive" | `SECRET_RULES` removes values: PEM blocks, `Bearer` tokens, `sk-`/`github_pat_`/`gh?_`/`AKIA`/`xox?-`/`AIza` keys, JWTs, and quoted **and unquoted** keyed assignments (`api_key=…`, `token: …`) with an idempotence lookahead | all 4 samples pass |

Live run in this slot (identical to R1-gpt-A's independent run recorded in
`.agent_workspace/r1-gpt-a.md`):

```text
$ node scripts/security-probe.mjs   # against dist/ rebuilt from HEAD e88f2ce
{ "status": "ok", "passed": 14, "openFindings": [], "waivedFindings": [] }
exit 0
```

The 14 passes are the 13 redaction samples (both spec findings) plus the
`packaged-secrets` scan of the `npm pack --dry-run` listing. `SECURITY_WAIVER`
was unset. The spec's finding descriptions match an older `redaction.ts`
(label-only, prefix-only) that no longer exists; the status-matrix redaction
row already records the 2026-08-24 value-removing transform. The spec is the
one surface still asserting BLOCKED, and the assertion is no longer supported
by evidence. Both probe sample cores are additionally pinned in unit tests at
HEAD (`test/unit/feedback/redaction.test.ts`,
`test/unit/privacy/redaction.test.ts` reference the card/CN-phone/`api_key`
cores); R1-opus-A is extending those pins in flight.

**Disposition:** R1-opus-B rewrites the spec Status to GREEN with command,
date, and the certifying run's Node version. The waiver register stays empty.
The "`packaged-secrets` findings are never waivable" rule must survive the
rewrite verbatim.

## 2. `private: true` — keep, no exception needed

内测 here means developers install from the repo (clone → `pnpm install
--frozen-lockfile` → `pnpm build` → `node dist/cli/main.js` / `pnpm cli`), or
at most from a locally produced tarball. Neither path needs `private: true`
removed:

- `npm publish` is the only thing `private: true` blocks. `npm pack` works on
  private packages, so even tarball-based internal distribution needs no
  packaging exception. The joint fable-B + opus-B exception path in the Round
  1 brief is **not invoked**.
- The release-gate spec's own safety argument ("nothing can ship
  accidentally") depends on this flag, and the new
  `scripts/preview-release-probe.mjs` (R1-gpt-B) fails closed if it flips.

**Disposition:** keep `private: true` through 内测. Revisit only when there is
a real registry-publish decision, which is out of scope for this campaign.

## 3. Engines: `>=22.19.0` vs VM v22.14.0 vs CI `22.x`

Observed behavior on this VM (v22.14.0, below the declared floor):

- `pnpm` prints `WARN Unsupported engine` on every script and continues
  (engine-strict is off). `pnpm build`, `security:probe`, `pi:probe`,
  `typecheck` all succeeded here despite the warning.
- `pi-sparkle doctor` **fails closed**: `FAIL node: 22.14.0 (engines
  >=22.19.0) — need >= 22.19.0`, nonzero exit. That is the designed operator
  signal and it works.
- CI (`.github/workflows/ci.yml:14,50`) uses a floating `node-version: 22.x`,
  which currently resolves at or above the floor — so CI satisfies the
  engines range incidentally but never proves the floor itself (it never runs
  on 22.19.0 exactly, and would drift silently if the floor were raised).

The honesty constraint: **every green result in this report was produced on a
host below the declared floor.** That is evidence the code happens to work on
22.14.0; it is not a floor-compliant certification. The converse also holds —
this VM cannot produce the certifying prerelease run.

**Disposition (recommendation, parent decides):** keep the floor for 内测;
CI is the certifying environment. Record in the readiness addendum that the
2026-08-25 local evidence was collected on v22.14.0 with the pnpm warning
present. As a Round 3 close-out, either pin one CI matrix entry to `22.19.0`
(proving the floor) or lower the floor with a compatibility rationale — the
same open item as `2026-08-24-sota-r3-acceptance.md` P2 #6. Do not silently
edit `engines` to match this VM.

## 4. P0 privacy still human-open — what 内测 may ship

The policy-gates table in `docs/status-matrix.md` records P0 as "Reviewer
re-verification of Q1/Q2 remediation, then sign-off — **still open**". Nothing
in Round 1 changes that, and this report does not claim otherwise.

内测 can ship with P0 open because the preview is bounded to exactly the
posture the open review assumes:

- **Internal, developer-operated, not published** (`private: true`, §2). The
  audience is the same population that can read the open review package
  (`docs/reports/2026-08-22-p0-privacy-review-package.md`).
- **The technical controls under review are implemented and probe-green**:
  value-removing redaction on every adaptation-plane feedback write
  (status-matrix "Redaction as transform" row), persisted `redactionClasses`,
  and the delete cascade (`delete --run` / `--episode`) for removal requests.
  Human sign-off is the remaining step, not missing machinery.
- **The preview docs already disclose the gap** ("P0 privacy review is not
  closed", `2026-08-20-developer-preview-readiness.md`) and the opus-B
  addendum must keep that line.
- **Nothing adaptive is live**: R1/bandit/topology stay off the execution
  path (pinned by `live-isolation.test.ts`), ADR-006 stays Proposed, nothing
  is Outcome-supported.

What 内测 must NOT do while P0 is open: distribute outside the team, publish
to any registry, state or imply P0 is closed, or turn on live adaptive
routing. Those are the sign-off's decision surface, not ours.

## 5. `pnpm prerelease` — every bar, with live status

`prerelease` = `pnpm gate && pnpm security:probe && pnpm pi:probe`
(package.json:46), where `gate` = `typecheck && lint && test && build`.

| bar | command | status in this slot (2026-08-25) |
|---|---|---|
| typecheck | `tsc --noEmit` | **exit 0** (run live) |
| lint | `eslint .` | **exit 1 right now — transient.** 5 `no-unused-vars` errors, all in the *working-tree* modification of `test/unit/feedback/redaction.test.ts` (R1-opus-A's owned file, mid-edit: `readFileSync`/`dirname`/`join`/`fileURLToPath`/`RedactionClass` imported unused). At HEAD `e88f2ce` those imports do not exist (`git show HEAD:` verified). Not a HEAD defect; must be re-verified green after opus-A lands. |
| test | `node scripts/run-tests.mjs` | **not run in this slot** (parent runs the full gate per the Round 1 brief). Last recorded full run: 1008 tests, 1005 pass, 3 skipped (`2026-08-20-developer-preview-readiness.md`); Round 22 parent gate GREEN (`7c3f867`); PR #11 merged CI-green. |
| build | `tsc -p tsconfig.build.json` | **exit 0** (run live; produced the `dist/` the probes certified) |
| security:probe | `node scripts/security-probe.mjs` | **exit 0**, `status: ok`, 14 passed, 0 open, 0 waived (run live; matches gpt-A) |
| pi:probe | `node scripts/pi-compat-probe.mjs` | **exit 0**, 4 PASS: both pins 0.84.3, no legacy identifier, single `ThinkingLevel` import source (run live) |

Adjacent, not yet wired: `scripts/preview-release-probe.mjs` (R1-gpt-B, exit 0,
5/5 ok as of this audit). Recommendation seconded: parent adds
`"preview:probe": "node scripts/preview-release-probe.mjs"` and prefixes
`prerelease` with it, so cheap metadata regressions (private flipped, engines
emptied, bin path lost, spec Status heading gone) stop the chain before the
expensive gate. Only the parent may edit `package.json`.

## Acceptance checklist — Round 2/3

Round 2 (landing acceptance; every box needs command evidence, not prose):

- [ ] **Lint green at merged HEAD**: `pnpm lint` exit 0 after opus-A's
      redaction-test pins land (the 5 unused-import errors in
      `test/unit/feedback/redaction.test.ts` are gone).
- [ ] **Every probe core pinned**: for each of the 13 `security-probe.mjs`
      samples, a unit test asserts the `core` string is absent from `body`
      after `redactFeedback` with `redactPII: true`. No test weakened, no
      probe sample loosened.
- [ ] **Spec truth-up landed** (opus-B): `docs/specs/release-gate.md` Status
      says GREEN with the exact command, date, and Node version of the
      certifying run; the two 2026-08-22 findings are recorded as closed with
      probe evidence; waiver register still `(empty)`; the never-waivable
      `packaged-secrets` clause survives verbatim.
- [ ] **Readiness addendum landed** (opus-B): 2026-08-25 section in
      `2026-08-20-developer-preview-readiness.md` covering gate commands, the
      Node `>=22.19.0` requirement + doctor fail-closed behavior + the
      below-floor caveat on this VM's evidence, fake-vs-pi executor honesty,
      and the open items (ADR-006 Proposed, P0 human sign-off open, F-PROD
      not started).
- [ ] **Parent full `pnpm prerelease` exit 0** on the merged tree, on an
      engines-compliant host (CI `22.x` qualifies). If additionally run on
      this VM's v22.14.0, record it as below-floor evidence, not
      certification.
- [ ] **`SECURITY_WAIVER` unset** in every recorded run; `waivedFindings: []`
      in the recorded probe JSON.
- [ ] **Preview metadata intact**: `private: true`, `bin.pi-sparkle` →
      `dist/cli/main.js` present in the `npm pack --dry-run` listing
      (preview-release-probe exit 0 covers both).
- [ ] **preview-release-probe wiring decision recorded**: parent either wires
      `preview:probe` first in `prerelease` (recommended) or documents why
      standalone-only is acceptable.

Round 3 (内测 declaration):

- [ ] **Dated preview record**: one report naming the exact commit SHA, the
      full `prerelease` output (including the probe JSON verbatim), and
      Node/pnpm versions of the certifying run.
- [ ] **Engines decision closed one way**: CI matrix gains a pinned
      `22.19.0` entry proving the floor, **or** the floor is lowered with
      compatibility evidence; `doctor`'s check and the docs agree with
      whichever was chosen.
- [ ] **Claims audit**: no document introduced in Rounds 1–3 states or
      implies P0 closed, Outcome-supported, npm-publishable, or live
      adaptive routing. ADR-006 still Proposed.
- [ ] **Status-matrix census** refreshed only if a landing changed the
      surfaces it describes (per the matrix's own rule).
- [ ] **Clean-checkout operator smoke** on an engines-compliant Node:
      `pnpm install --frozen-lockfile && pnpm prerelease &&
      node dist/cli/main.js doctor` — doctor shows no FAIL lines.

Deliberately out of scope for 内测 (open by design, not blockers): F-PROD
sealed holdout, ADR-006 extension decision, retention bounding policy,
Outcome-supported claims of any kind.

## Postscript (same session)

While this audit was being written, R1-opus-B's working-tree edit of
`docs/specs/release-gate.md` landed: Status now reads "GREEN — 2026-08-25"
with live evidence. That satisfies condition 1 of the call above in the
working tree; it becomes final when the parent commits Round 1. Conditions 2
(full `pnpm prerelease` on the merged tree) and 3 (engines-compliant
certifying host) remain the parent's to close.
