model: claude-fable-5-thinking-xhigh

# R1-fable-B — 发行内测 gap audit (working notes for parent)

Deliverable: `docs/reports/2026-08-25-preview-release-gap.md` (written).
No `src/`, `scripts/`, or spec files touched. No git operations.

## The call

**Spec stale, probe green.** `docs/specs/release-gate.md` Status: BLOCKED
(2026-08-22) is no longer supported by evidence. 内测 = **conditional GREEN**;
npm publish = **BLOCKED, intentional, unchanged** (`private: true` stays).

Conditions on the GREEN (none is a security finding):

1. opus-B lands the spec truth-up — **satisfied in the working tree during
   this session**: `release-gate.md` Status now reads "GREEN — 2026-08-25";
   final when parent commits Round 1.
2. Parent runs full `pnpm prerelease` exit 0 on the merged tree.
3. Certifying run happens on an engines-compliant host (CI `22.x`, not this VM).

## Live evidence gathered in this slot (2026-08-25, Node v22.14.0, pnpm 10.17.1)

All against `dist/` rebuilt from HEAD `e88f2ce` in-session:

| command | exit | result |
|---|---|---|
| `pnpm build` | 0 | dist regenerated from HEAD (pnpm engine WARN, non-fatal) |
| `node scripts/security-probe.mjs` | 0 | `status: ok`, 14 passed, 0 open, 0 waived — matches gpt-A's independent run exactly |
| `pnpm pi:probe` | 0 | 4 PASS (pins 0.84.3, no legacy identifier) |
| `pnpm typecheck` | 0 | clean |
| `pnpm lint` | 1 | **transient**: 5 unused-import errors, all in the working-tree edit of `test/unit/feedback/redaction.test.ts` (opus-A's owned file, mid-edit). `git show HEAD:` confirms those imports don't exist at HEAD. Re-verify after opus-A lands. |
| `node dist/cli/main.js doctor` | 1 | sole FAIL is `node: 22.14.0 (engines >=22.19.0)` — designed fail-closed, works |

`pnpm test` deliberately not run (brief: parent runs the full gate).
`SECURITY_WAIVER` unset throughout. `packaged-secrets` passed clean — **no
waiver used, none needed, never-waivable rule untouched**.

## Per-question findings (detail in the docs report)

1. **Spec vs probe**: spec's finding text describes the pre-2026-08-24
   label-only redactor. Current `redaction.ts` removes values (PEM, Bearer,
   vendor keys, JWT, quoted+unquoted keyed assignments with idempotence
   lookahead; home/`.ssh`/UNC/`Users\` paths; email/IPv4/phones/Luhn cards).
   Both probe ids fully pass. Probe cores are already pinned in unit tests at
   HEAD; opus-A extending (+192 lines in flight).
2. **`private: true`**: keep. `npm pack` works on private packages, so even
   tarball 内测 needs no exception — the joint fable-B+opus-B exception path
   is **not invoked**. gpt-B's probe fails closed if the flag flips.
3. **Engines**: pnpm warns-and-continues on 22.14.0; doctor fails closed
   (correct); CI `22.x` satisfies the floor incidentally but never proves it.
   All local green evidence is below-floor — honest framing: "works on
   22.14.0" ≠ certification. Recommendation: keep floor, certify in CI,
   Round 3 closes the pin-CI-vs-lower-floor decision (same as sota-r3 P2 #6).
4. **P0 open**: 内测 ships without claiming closure because it is internal,
   unpublished, the controls under review are implemented + probe-green, the
   docs disclose the open review, and nothing adaptive is live. Forbidden
   while open: external distribution, publish, "P0 closed" claims, live R1.
5. **prerelease bars**: gate(typecheck ✅ / lint ⚠ transient / test =
   parent's run / build ✅) + security:probe ✅ + pi:probe ✅. Seconding
   gpt-B: wire `preview:probe` first in `prerelease` (parent edits
   package.json, not us).

## Handoffs

- **opus-B**: docs report §1 table + gpt-A JSON = your GREEN evidence; carry
  the never-waivable clause verbatim; readiness addendum needs the
  below-floor Node caveat.
- **opus-A**: your in-flight edit is the only red lint in the tree (5 unused
  imports); nothing else blocks lint.
- **Parent**: Round 2/3 acceptance checklist is at the end of the docs
  report — 8 Round-2 boxes (lint green at merged HEAD, all 13 cores pinned,
  spec truth-up, readiness addendum, full prerelease exit 0 on compliant
  host, no waivers, metadata intact, probe wiring decision) + 5 Round-3
  boxes (dated preview record, engines decision closed, claims audit,
  matrix census, clean-checkout smoke).
