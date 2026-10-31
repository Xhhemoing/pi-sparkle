# Developer Preview 0.1.0-preview.1

**Date:** 2026-08-27  
**Package:** `pi-sparkle` `0.1.0` (`private: true`)  
**Tag:** `v0.1.0-preview.1`  
**Host Node for this record:** v24.18.0 (satisfies `engines.node >=22.19.0`)  
**pnpm:** 10.17.1

This is a **developer preview**, not an npm publication. Install from the
repository: `pnpm install --frozen-lockfile && pnpm build`.

## What this preview is

- Clone + pnpm only. `private: true` stays; `npm publish` is refused.
- ADR-006 remains Proposed. Live R1/bandit/topology stay off the execution path.
- No capability is Outcome-supported.
- P0 privacy is technically re-verified (2026-08-26); this preview does not
  claim a production privacy certification.

## Branch cleanup (same session)

Remote refs were classified against `main` @ `ce0c270` and later HEAD.

| Action | Count |
|---|---|
| Deleted stale `rN-*-pass-83a1` report slices | 377 |
| Deleted merged / ingested / superseded campaign branches | 127 |
| Phantom `origin` name (not a real ref) | 1 skipped |
| Kept | `main`, `cursor/sota-persistent-opt-83a1` (PR #9 tracker), `cursor/algorithm-revalidate-9035` (assign-v5 port tip) |

Local stale branch `preview-readiness` was deleted.

## Gate notes

`pnpm prerelease` is `preview:probe && gate && security:probe && pi:probe`.
The certifying environment for this tag is **CI Node 22.19.0** (Linux).

Windows local runs need extra skips for POSIX-only contracts (chmod/umask,
exclusive-rename races, flock timeout, Unix `ENOTDIR` injection). Those skips
do not weaken the Linux CI bar.

A Windows-only product fix landed with this preview: `migrate-legacy` refuses
a `--state-root` that exists and is not a directory. On Windows,
`stat(file/child)` is `ENOENT` rather than `ENOTDIR`, so the scanner used to
treat a file root as an empty tree and exit 0.
