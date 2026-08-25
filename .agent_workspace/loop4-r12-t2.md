[Model: gpt-5.6-sol]

# Loop 4 · Round 12 · R12-2 — `independentEvidence` posture

Branch `agent/opt-continuous`; no checkout, commit, or push. Owned production files: none.

## 1. Census first

The handed path `test/unit/tracking/independent-evidence-posture.test.ts` exists.

Working-tree `src/**` census before the edit:

| Site | Kind |
|---|---|
| `src/tracking/prescore.ts:29` | `PrescoreInput.independentEvidence` declaration |
| `src/tracking/prescore.ts:89` | `void input.independentEvidence;` — the only dereference |
| `src/tracking/from-child.ts:228` | sole object-literal write from the child's verification verdict |

`src/run/flowchart-run.ts` did not mention the field. The wider TypeScript census found only fixture writes outside the owned posture test; it found no additional production consumer.

## 2. Additive pin

Added 25 lines and removed none in the owned test:

- names `src/run/flowchart-run.ts` explicitly;
- proves that file is present in the recursive whole-`src` module census;
- requires the spine to contain no `independentEvidence` mention, covering reads, writes, and prose drive-bys there;
- injects an in-memory reader into the real spine source and proves the exact-one-`void` assertion rejects it.

This is a focused successor to the existing non-vacuous whole-tree pin, not a second production census. No `src/**` file was changed and the field was neither renamed nor given a reader.

## 3. Verification

At `2026-08-25T00:47:29Z`:

- post-edit whole-`src` census: still exactly the declaration, sole producer, and one `void` dereference above;
- scoped eslint: exit 0;
- whole-tree `pnpm exec tsc --noEmit`: exit 0;
- owned test 3×: 6/6 pass, 0 fail, 0 skipped on every run;
- `git diff --check` on the owned file: exit 0;
- no full gate run, as instructed.

The only runtime notice was the known Node v22.14.0 versus package engine `>=22.19.0` warning.

## 4. Shared-tree note

During and immediately after verification, sibling-owned `docs/data-dictionary.md`,
`test/unit/run/terminal-replay-statuses-freeze.test.ts`,
`test/unit/run/checkpoint-writer-carriage.test.ts`, and reports
`loop4-r12-t6.md` / `loop4-r12-t7.md` / `loop4-r12-t9.md` appeared in the shared
tree. I did not edit them. My code diff is confined to
`test/unit/tracking/independent-evidence-posture.test.ts`; this report is the
only other file I wrote.
