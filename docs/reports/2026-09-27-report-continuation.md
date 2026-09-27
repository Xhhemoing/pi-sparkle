# Report continuation evidence

Task: TASK-20260927-report-continuation. Owner: implementation agent. Independent review NOT RUN; main merge NOT performed.

## A0-root RED (2026-09-27)

Diagnostic commit `019e1641090e43aa4f0cab94b8e8d726fdba3a70`; original main baseline `1b04aa9d9e70206cfb41a2963189dfb5bcab3a5d`.

[Same-runner workflow](https://github.com/Xhhemoing/pi-sparkle/actions/runs/36306140636), Windows job `108583072864`, Node 22.19.0, Git 2.55.0.windows.5. The baseline and current preflight were imported into one process and received exactly the same temporary repository. The probe never executed its verification command.

Observed path prefix: requested `C:\Users\RUNNER~1\AppData\Local\Temp`; Git top-level and both native real paths used `C:\Users\runneradmin\AppData\Local\Temp`. The device/inode pair was identical (`742408122:562949954715434`). Both preflights rejected with `source repository must be the Git toplevel`. This establishes the Windows 8.3-versus-long-name defect in the observed fixture, rather than merely inferring it from unchanged source. Focused root/preflight/apply tests: 34 total, 13 pass, 21 fail, 0 skip. Linux companion job passed.

## First correction (verification pending)

Preflight now compares physical directory roots after rejecting symlink/junction components along the full requested path; short names and case spellings are normalized by the filesystem, not by unconditional lowercase string equality. Directory device/inode identity is checked and the canonical Git root is returned. Subdirectory, dirty/staged/untracked/ignored and input checks remain in place. Existing preflight assertions now expect the physical root, not the incidental temporary-path spelling.

Local dependency-free helper check: Node 22.16.0, TypeScript 5.8.3; strict compile PASS; 4 helper tests PASS / 0 FAIL / 0 SKIP. This is not a supported-runtime full gate. Logs retained in the working container under `.agent_workspace/verification/`.

The first correction has not yet passed hosted integration. In particular, downstream apply identity also rejects path aliases; it must be exercised on the real Windows fixture before declaring A0-root closed. No broad alias acceptance or candidate application bypass is permitted.

Plan: [continuation](../superpowers/plans/2026-09-27-report-continuation.md). B1 is still being prepared; B2 and all separate existing human/experimental gates remain open.
