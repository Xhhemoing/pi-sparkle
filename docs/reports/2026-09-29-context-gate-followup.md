# C2 full-gate follow-up

Task: `TASK-20260929-report-execution`. Date: 2026-09-29. Author-run evidence, not independent review.

The first supported local full gate ran Node 22.19.0 / pnpm 10.17.1 against the C2 source candidate. Workflow/typecheck/lint passed. Tests: 3177 PASS / 1 FAIL / 1 SKIP (3179 total); build did not run because the test command failed. The failure was `checkpoint D: packet preserves critical facts, records omissions, forwards no transcript` in `test/integration/m3/checkpoint-d.test.ts`, whose old expectation permits dropping a contract constraint. This is NOT a green gate.

The regression is tightened rather than silenced: the 100-token request must refuse, the exact 125-token mandatory payload must preserve BOTH constraints (including the non-mechanically-enforceable constraint), optional risk material must be explicitly omitted, and the parent transcript must remain absent. The bounded transport allowlist grows from four to five files for this existing integration test only. Revised focused verification: 71 PASS / 0 FAIL / 0 SKIP on supported Node/pnpm. The complete revised gate and built probes remain pending this record.

The temporary read-only bootstrap workflow is removed now that exact public Node/pnpm and locked dependencies are materialized. The separate bounded patch transport remains only through staged publication and will also be removed before final review. No production or owner gate changes.
