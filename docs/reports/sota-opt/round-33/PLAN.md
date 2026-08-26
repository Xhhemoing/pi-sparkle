# Round 33 作战计划

**目标**：在 R32 十切片诚实空枚举关闭（无 S32-A-* … S32-J-*；R32-A 重开条件哨兵审计 F12a–d 与 R32-B 闭合稳定性审计按方法 / 停驻记录，未铸造新面；R32-J 六个从未受控残余坐标未过三合取，未铸造新面）以及 **FITQ / NAMESHAPE / SCALEX / XPROC / YMIX / SCHEDWIN / KFAN / NVG / SEEDX / TERMCLASS / SHAPEK / ORDX / CKMIX / CALLB / OCCX / JB / RUNLIM / VALCLASS / CG / AGEX / COTARG / PRICEX / RTL / DELINV / PROBX / RVL / SIDEC / PWL / ZREP / PAIRX / CSPELL / REPRX / LINKTOP / BINDX / MODEX** 具名 ban 的前提下，对十切片做**第三十三遍**独立枚举。R32 已 10/10 关闭。本轮状态：**A 本波派出；B–J 待派**。

**约束**：

- R8–R32 已合入切片全部诚实空枚举。无新 S32-A-* … S32-J-*。
- 生产基线未变：最后 `src/` 提交仍为 `183df9b`（S7-C）。
- 禁止再编号：FITQ、NAMESHAPE、SCALEX、XPROC、YMIX、SCHEDWIN、KFAN、NVG、SEEDX、TERMCLASS、SHAPEK、ORDX、CKMIX、CALLB、OCCX、JB、RUNLIM、VALCLASS、CG、AGEX、COTARG、PRICEX、RTL、DELINV、PROBX、RVL、SIDEC、PWL、ZREP、PAIRX、CSPELL、REPRX、LINKTOP、BINDX、MODEX（空枚举轴外号，**不是** EXCLUSIONS 表行）。
- R21–R32 具名 / unnamed 面与上列停驻 / 分解 / 审计记录亦 plan-ban，**不**写入 EXCLUSIONS 表行。R32-A 重开条件哨兵审计（F12a–d）与 R32-B 闭合稳定性审计（54/54 裁决仍立；五扇残门 D1–D5 按归属关闭）按方法 / 停驻记录，**不**铸造新面、**不**写入 EXCLUSIONS 表行。**禁止**把「再查一遍重开条件 / 闭合稳定性 / 门扉」铸成新面。
- 落地条件、硬不变量、sim 家族与 [PROGRESS.md](../PROGRESS.md) / [EXCLUSIONS.md](../EXCLUSIONS.md) / [round-32/PLAN.md](../round-32/PLAN.md) 一致。

## 切片（与 R1–R32 相同）

| 切片 | 范围 | 状态 |
| --- | --- | --- |
| A | `src/tracking/` + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14） | 本波派出 |
| B | 在线路由 9 + `src/supervisor/model-router.ts`（10） | 待派 |
| C | 离线路由 9 | 待派 |
| D | `src/adaptation/`（14） | 待派 |
| E | `src/learning/`（10） | 待派 |
| F | `src/experiments/`（15） | 待派 |
| G | `src/run/`（除 A 两文件）+ `src/supervisor/`（除 model-router）+ `src/graph/` + `src/domain/`（42） | 待派 |
| H | evaluation 8 + requirement 7 + review 4 + rubric 2（21） | 待派 |
| I | cli 13 + pi-adapter 9 + config 2 + telemetry 1（25） | 待派 |
| J | cluster 3 + privacy 3 + preferences 7 + episode 5 + persist 2 + track 4 + context 2 + feedback 3（29） | 待派 |

默认对照取最近已合入轮：A = R32-A（13.5–15.7 µs/gate ⇒ ~68–79 µs/run）；B = R32-B（M=2 9.04–9.62 / M=10 17.84–18.43）；C = R32-C（中位 659.0–662.0；组合天花板 20.2–26.6 < 35；sink=7.309）；D = R32-D（S0c 3.37–3.60 ms）；E = R32-E（SLICE-CPU cmp25 14.8–15.3）；F = R32-F（r5f 119.46/120.27/125.31、r6f 124.25/119.48/119.70、r7f 125.62/129.79/129.50）；G = R32-G（compute 0.289–0.293 vs I/O 88.2–93.5；digest 第二十三次相同，**禁止**再铸 digest 轴号）；H = R32-H（默认链 9100/9108/8975 ns）；I = R32-I（custom−builtin children +45.5~+50.1 / +23.1~+24.8、track +48.3~+55.3 / +21.8~+26.1、flowchart-flat64 +42.4~+45.4 / +16.8~+19.4）；J = R32-J（preferences 124.0–230.7 / 406.9–528.9；jsonl 59.7–66.8 / 199.9–296.8 µs）。S12-B-2 条件陆器仍未触发。S8-I-1 两侧 file-level 封死。S13-B-1 仍为 loser ID。S7-F-1 ≠ S6-F-5。S5-H-1 保持。catalog 行序契约决策承载（R28-B W3）。npm POSIX `.bin` symlink 静默 no-op（R28-I）**禁止**当优化修。

## 第三十三遍焦点

**A — 本波派出**：14 文件（`src/tracking/` 12：roller / analysis / gates / config / combined-score / from-child / index / turn / isolation / human-score / prescore / types + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`）。基线 `7acb666`。默认对照 R32-A（13.5–15.7 µs/gate ⇒ ~68–79 µs/run）。非再移植：call-stream ordering / dispatch-history、跨工具调用序 / 跨工具时序拓扑、FITQ、CALLB、OCCX、SEEDX、KFAN、R31-A injected-callable 停驻、R32-A 重开条件哨兵审计（F12a–d，**禁止**再铸「再查一遍重开条件」式新面）、R32-B 闭合稳定性审计。若落地：gate + 既有 A harness。报告 `docs/reports/sota-opt/round-33/R33-A.md`。禁止开 PR。

**B — 待派**：10 文件；基线 `94ed3d9`。默认对照 R32-B（M=2 9.04–9.62 / M=10 17.84–18.43）。非再移植：scale-cube 二阶交互、SCALEX、ORDX、AGEX、YMIX、SHAPEK、REPRX、LINKTOP、R31-B 面格六门停驻、R32-B 闭合稳定性审计（**禁止**再铸「再查一遍闭合稳定性」式新面）、R32-A 重开条件哨兵审计。S12-B-2 仍未触发。S13-B-1 仍为 loser ID。若落地：gate + 既有 B harness。报告 `docs/reports/sota-opt/round-33/R33-B.md`。禁止开 PR。

**C — 待派**：9 文件；基线 `183df9b`。默认对照 R32-C（中位 659.0–662.0；组合天花板 20.2–26.6 < 35；sink=7.309）。非再移植：input object-representation / **REPRX**、**BINDX**、KFAN、COTARG、PROBX、DELINV、PRICEX、VALCLASS。若落地：gate + r1c–r7c（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。报告 `docs/reports/sota-opt/round-33/R33-C.md`。禁止开 PR。

**D — 待派**：14 文件；基线 `82bef36`。默认对照 R32-D（S0c 3.37–3.60 ms）。非再移植：approval-profile constraint-list geometry、SIDEC、PAIRX、CSPELL、ZREP、R22-D 所有权单元格、R32-A 重开条件哨兵审计（仅卫生应用）。S9-D-4 / S12-D-1 永不再开。若落地：gate + 既有 D harness。报告 `docs/reports/sota-opt/round-33/R33-D.md`。禁止开 PR。

**E — 待派**：10 文件；基线 `adb20d7`。默认对照 R32-E（SLICE-CPU cmp25 14.8–15.3）。非再移植：async suspension-point topology、PWL、RVL、RTL、CG、JB、NVG、REPRX、PAIRX、ZREP、LINKTOP、**BINDX**、I/O text-codec topology / per-run transcode-byte manifest。S8-E-1 禁止去重 `loadLearnedRouting`。若落地：gate + 既有 E harness。报告 `docs/reports/sota-opt/round-33/R33-E.md`。禁止开 PR。

**F — 待派**：15 文件；基线 `519101f`。默认对照 R32-F（r5f 119.46/120.27/125.31、r6f 124.25/119.48/119.70、r7f 125.62/129.79/129.50）。非再移植：boundary output-consumption / snapshot-readback topology、PAIRX、**BINDX**、I/O text-codec topology、R31-F 故障通道处置分解、R32-A 重开条件哨兵审计（仅卫生应用）。S7-F-1 ≠ S6-F-5。若落地：gate + r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）。报告 `docs/reports/sota-opt/round-33/R33-F.md`。禁止开 PR。

**G — 待派**：42 文件；基线 `4efee23`。默认对照 R32-G（compute 0.289–0.293 vs I/O 88.2–93.5；digest `06cbcf92c098c8f0` 第二十三次相同，**禁止**再铸 digest 轴号）。非再移植：M1 parent-run child-scheduling lattice、M2 supervised-engine adjudication lattice、decision-gate resolution、join-policy、**RUNLIM** / **CKMIX** / **TERMCLASS** / **SCHEDWIN** / **XPROC** / **NAMESHAPE**、**ZREP**、**BINDX**、**MODEX**、I/O text-codec topology、R31-G 18 门闭合审计（**禁止**再铸「门扉审计」轴）、R32-A 重开条件哨兵审计（仅卫生应用）。若落地：gate + 既有 G harness。报告 `docs/reports/sota-opt/round-33/R33-G.md`。禁止开 PR。

**H — 待派**：21 文件（evaluation **8** 不是 9）；基线 `fd437a9`。S5-H-1 保持。默认对照 R32-H（默认链 9100/9108/8975 ns）。非再移植：provenance-resolution pathway、coverage-relation incidence topology、argument-slot、execution-substrate、**BINDX**、**MODEX**、I/O text-codec topology、R31-H 四扇边界参数残门、R32-A 重开条件哨兵审计、R32-B 闭合稳定性审计。若落地：gate + 既有 H harness。报告 `docs/reports/sota-opt/round-33/R33-H.md`。禁止开 PR。

**I — 待派**：25 文件；基线 `8dee7fb`。S8-I-1 两侧 file-level 封死（pi-ai 0.84.1；`all.models.js` 不存在）。**禁止**把 npm POSIX `.bin` symlink 静默 no-op（R28-I `main.ts` L1489 `import.meta.url` vs `pathToFileURL(argv[1])`）当优化修。默认对照 R32-I（custom−builtin children +45.5~+50.1 / +23.1~+24.8、track +48.3~+55.3 / +21.8~+26.1、flowchart-flat64 +42.4~+45.4 / +16.8~+19.4）。非再移植：process-lifetime temporal-segment topology、JSON serialization-form、invocation-identity、**NAMESHAPE**、**BINDX**、**MODEX**、I/O text-codec topology、R31-I CLI 进程边界门扉闭合审计（**禁止**再铸「进程边界审计」轴）、R32-A 重开条件哨兵审计、R32-B 闭合稳定性审计。若落地：gate + r4i/r5i/r7i（68/119/80）。报告 `docs/reports/sota-opt/round-33/R33-I.md`。禁止开 PR。

**J — 待派**：29 文件；基线 `fb41417`。J1 锁定（2468 项逐位）。默认对照 R32-J（preferences 124.0–230.7 / 406.9–528.9；jsonl 59.7–66.8 / 199.9–296.8 µs）。非再移植：**LINKTOP**、**CSPELL**、**ZREP**、**SIDEC**、**BINDX**、**MODEX**（inode 模式字面；全网格平坦、生产只能铸默认 0644/0755，**禁止**再铸 chmod/umask 臂）、I/O text-codec topology、R31-I CLI 进程边界门扉闭合审计、R32-J 六个从未受控残余坐标（inode 时间元数据 / extent 布局 / 属主字 / ACL-xattr / dirent 序 / 线程池宽度，均未过三合取，**禁止**再铸「我又审了一遍门」式新面）、R32-A 重开条件哨兵审计、R32-B 闭合稳定性审计。若落地：gate + J1 仿真（2468）+ 既有 J harness。报告 `docs/reports/sota-opt/round-33/R33-J.md`。禁止开 PR。

A–J 均要求返回首行 `MODEL_SLUG=claude-fable-5-thinking-xhigh`，末两行 `MORE_OPTIMA=yes|no` 与 `BRANCH=...`。模型必须是 **claude-fable-5-thinking-xhigh**，禁止静默降级。

## 期望

- 默认预期：诚实空枚举。空枚举轴外号只进本 PLAN「禁止再编号」+ 首段 unnamed plan-ban，**不**进 EXCLUSIONS 表。
- 若有候选：理论 + 确定性 sim + 真尺度非噪声（offline-logit ±35 ms；µs/ns 与 once-per-run CLI 噪声拒收）。输家脚本只进报告附录，不提交仓库。
- 平台硬顶 3 并发云 VM；本波派出 R33-A，后续按 3 槽填满 B、C…。
- Round 32 已 10/10 收口。Round 33 在 J 返回并合入后 10/10 收口，再开 Round 34。
