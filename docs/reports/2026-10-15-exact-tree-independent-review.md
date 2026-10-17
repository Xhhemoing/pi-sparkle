# Independent review of exact Git tree binding

Plan: [trusted apply binding](../superpowers/plans/2026-10-15-trusted-apply-binding.md), TA-01 and the shared attribute-validation seam. Reviewer: command-cleanup agent. Implementation author: exact-snapshot agent. State: superseded by final TA independent PASS; source and tests are read-only to this reviewer.

## Review scope

Review the genuine opaque snapshot boundary, whole file collection, raw Git object bytes, executable mode, supported paths/encoding, file/byte/path/output bounds, and transformations from attributes or line endings. Git object IDs are immutable locators only; direct byte equality must establish the comparison. This review does not certify native application, registration, callbacks, crash atomicity or live/production use.

Before implementation completion the reviewer raised three concrete design constraints: disable replacement-object interpretation when resolving raw object addresses; define before/after tree identities and fail closed when required Git attribute views are unsupported; and ensure attribute queries use repository-root-relative paths even when the supplied repository path is a subdirectory. These are design questions, not findings against final source.

Independent temporary Git 2.51.1 probes confirmed replacement-tree lookup differs from raw `--no-replace-objects` lookup, and the same `a.txt` attribute query reports a root-only filter as active at the repository root but unspecified from a subdirectory. Fixtures were removed without modifying project source/tests.

A second concrete design gap was reproduced before implementation completion: `filter=unset` and `filter=unspecified` are valid literal filter-driver names. The implementation now rejects those configured sentinel drivers before any clean filter runs, with a regression covering the actual side effect. The prior duplicate-path issue for malformed hand-built trees was also fixed and covered.

## Evidence

The final source-disjoint TA review records PASS and covers this exact boundary: 27 tests, 26 pass, 0 fail, 1 Windows-only skip. No unresolved P2 remains.

## Primary technical references

- [Git replace](https://git-scm.com/docs/git-replace): replacement references affect ordinary object lookup; `--no-replace-objects` disables this behavior.
- [Git cat-file](https://git-scm.com/docs/git-cat-file): raw object output is distinct from filtered/text-converted output.
- [Git ls-tree](https://git-scm.com/docs/git-ls-tree): NUL-delimited records, full-tree paths and object modes provide the bounded enumeration input.
- [Git check-attr](https://git-scm.com/docs/git-check-attr): worktree, cached and explicit source-tree attribute views are separate inputs.
