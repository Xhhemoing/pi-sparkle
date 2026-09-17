# Pending local review — 2026-09-12

## Status

- **PS-P1 / PS-P2 / combo**: merged to `main` @ `8dd31e9` (Heidi authorized).
- **PS-HOTFIX Provider 失败归因**: in flight — `finish()` must not synthesize `verification: FAILED` (empty evidence) on provider fail; use `UNOBSERVED` + `failure` classification so `taskSuccess` / bandit / diagnostics do not treat infra failures as model FAIL.
- **Soul M0-3 G-W**: blocked on xhh VS 2022 Build Tools (Ops winget); script parse + MSVC fail-fast staged locally on Soul branch.

## No longer accurate

Earlier notes that marked **P1 BLOCKED** are obsolete after the combo merge.
