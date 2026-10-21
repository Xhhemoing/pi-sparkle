# Exact Git-tree binding

Date: 2026-10-15  
Owner: exact-snapshot implementation  
Plan: [trusted apply binding](../superpowers/plans/2026-10-15-trusted-apply-binding.md), TA-01  
State: ready-for-review; native apply integration is green

## Delivered boundary

`src/execution/exact-snapshot.ts` now provides the opt-in raw Git-tree checks
used by trusted verification:

- only a genuine in-process, whole-worktree `ExactSnapshot` can be used;
  copied, serialized, scoped, excluded, or foreign-root handles are refused;
- tree arguments must be complete 40-character tree object IDs, and every Git
  read uses `--no-replace-objects` so replacement refs cannot change the bytes
  being checked;
- bounded NUL-delimited `ls-tree -r -t` output is parsed with strict UTF-8,
  contained-path, regular-file-mode, directory-mode, object-type, file-count,
  duplicate-path, and output-size checks;
- blobs are read directly with `cat-file`, with immutable capture-time byte
  and file limits retained even when the caller mutates its limits object;
- file bytes and owner-execute mode are compared directly with the captured
  bytes; symlinks, submodules, empty Git directories, ignored extra files,
  missing files, same-length rewrites, and unsafe names fail closed;
- the attribute boundary checks worktree, index, old-tree, and new-tree views
  without executing clean/process filters. Text, EOL, CRLF, ident, filter,
  working-tree-encoding, external attribute files, repository info attributes,
  and literal `unset`/`unspecified` filter-driver sentinels are conservatively
  refused.

This remains cooperative pre/post evidence. It does not claim hostile
concurrent-writer isolation, cryptographic integrity, or automatic rollback.
Git object IDs are used only as immutable object locators; exact bytes establish
the comparison.

The command choices follow Git's documented raw-object and attribute boundaries:
[git-replace](https://git-scm.com/docs/git-replace),
[git-cat-file](https://git-scm.com/docs/git-cat-file),
[git-ls-tree](https://git-scm.com/docs/git-ls-tree), and
[git-check-attr](https://git-scm.com/docs/git-check-attr). These references
describe Git behavior; they do not expand this project's evidence or authority
claims.

## Verification

Focused command:

```text
node --import tsx --test test/unit/execution/exact-git-tree.test.ts
```

Result: **26 passed, 0 failed, 1 Windows-only skip** on Linux. The focused
suite covers binary/empty/Unicode files, NUL-delimited names, executable mode,
replacement refs, malformed tree addresses, path/output limits, attributes,
external configuration, filters, CRLF and encoding conversion guards.

An independent review also constructed a noncanonical Git tree containing
duplicate path records; a first implementation would have hidden a duplicate
empty file behind its `Set`-based comparison. The parser now rejects duplicate
paths before comparison, and the regression is included in the focused suite.

`eslint src/execution/exact-snapshot.ts` also passes. The dependent trusted
apply integration suite is **16 passed, 0 failed** after the native apply owner
added its post-hook attribute guard; this report does not claim that checkout
or ref publication is crash-atomic or that the source is automatically rolled
back after an ambiguous Git failure.
