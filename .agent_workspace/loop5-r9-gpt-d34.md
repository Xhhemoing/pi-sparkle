# D34 landing recheck

**KEEP**

Reviewed PR [#19](https://github.com/Xhhemoing/pi-sparkle/pull/19) at
`e22030090f8d55828f5477bf35d80cf3519fb3f4` against
`origin/cursor/pi-sparkle-sota-opt-0da8`.

- Blank `--provider` is refused at `parse-args` before the compatibility
  refusal, either list branch, and any config read. Nonblank unknown providers
  in available mode still produce the pinned `(no models)`.
- Disable is correctly partitioned from the loaded `before`: enabled entries
  call `disableModel` and retain `Disabled`; dangling defaults call it and
  explicitly report clearing routing references; pure no-ops skip it and are
  the only path pinning raw config bytes unchanged.
- Malformed- and unknown-model `next` text refers to “the same --state-root”
  without interpolating the raw path.
- `tryParseModelRef` guards, unknown-model `validation`, catalog-inventory
  retargeting, and the non-available `--provider` refusal remain intact.
  Existing exact `MODELS_LIST` assertions remain unchanged and pass.
- The branch diff has no implementation files beyond `src/cli/models.ts` and
  `test/unit/cli/models.test.ts`; `git diff --check` is clean.

Verification from the detached candidate worktree:

- `npx tsx --test test/unit/cli/models.test.ts` — 28 passed, 0 failed.
- `pnpm typecheck` — passed.

The Node `>=22.19.0` engine warning on the VM's Node 22.14.0 did not affect
either result.
