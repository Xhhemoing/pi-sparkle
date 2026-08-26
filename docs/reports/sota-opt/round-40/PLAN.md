# Round 40 作战计划

**目标**：在 R39 十切片诚实空枚举关闭（无 S39-A-* … S39-J-*；R39-A 三项换名检查拒列；R39-G digest 第三十次相同，未铸造 digest 轴号；R39-B / R39-C / R39-D / R39-E / R39-F / R39-H / R39-I / R39-J 零新站点级换名记录）以及 **FITQ / NAMESHAPE / SCALEX / XPROC / YMIX / SCHEDWIN / KFAN / NVG / SEEDX / TERMCLASS / SHAPEK / ORDX / CKMIX / CALLB / OCCX / JB / RUNLIM / VALCLASS / CG / AGEX / COTARG / PRICEX / RTL / DELINV / PROBX / RVL / SIDEC / PWL / ZREP / PAIRX / CSPELL / REPRX / LINKTOP / BINDX / MODEX** 具名 ban 的前提下，对十切片做**第四十遍**独立枚举。R39 已 10/10 关闭。本轮状态：**A/B/C 本波派出；D–J 待派**。

**约束**：

- R8–R39 已合入切片全部诚实空枚举。无新 S39-A-* … S39-J-*。
- 生产基线未变：最后 `src/` 提交仍为 `183df9b`（S7-C）。
- 禁止再编号：FITQ、NAMESHAPE、SCALEX、XPROC、YMIX、SCHEDWIN、KFAN、NVG、SEEDX、TERMCLASS、SHAPEK、ORDX、CKMIX、CALLB、OCCX、JB、RUNLIM、VALCLASS、CG、AGEX、COTARG、PRICEX、RTL、DELINV、PROBX、RVL、SIDEC、PWL、ZREP、PAIRX、CSPELL、REPRX、LINKTOP、BINDX、MODEX（空枚举轴外号，**不是** EXCLUSIONS 表行）。
- R21–R39 具名 / unnamed 面与上列停驻 / 分解 / 审计记录亦 plan-ban，**不**写入 EXCLUSIONS 表行。R32-A 重开条件哨兵审计（F12a–d）与 R32-B 闭合稳定性审计（54/54 裁决仍立；五扇残门 D1–D5 按归属关闭）按方法 / 停驻记录，**不**铸造新面、**不**写入 EXCLUSIONS 表行。R33-A 把 R32-B 三腿方法应用到 A 区 44 行账本（44/44 仍立）亦为方法卫生，**禁止**再铸「再查一遍闭合稳定性」式新面。**禁止**把「再查一遍重开条件 / 闭合稳定性 / 门扉」铸成新面。R39-G digest `06cbcf92c098c8f0` 第三十次相同 — 若本轮再同，记**第三十一次**相同，**禁止**再铸 digest 轴号。
- 落地条件、硬不变量、sim 家族与 [PROGRESS.md](../PROGRESS.md) / [EXCLUSIONS.md](../EXCLUSIONS.md) / [round-39/PLAN.md](../round-39/PLAN.md) 一致。

## 切片（与 R1–R39 相同）

| 切片 | 范围 | 状态 |
| --- | --- | --- |
| A | `src/tracking/` + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14） | 本波派出 |
| B | 在线路由 9 + `src/supervisor/model-router.ts`（10） | 本波派出 |
| C | 离线路由 9 | 本波派出 |
| D | `src/adaptation/`（14） | 待派 |
| E | `src/learning/`（10） | 待派 |
| F | `src/experiments/`（15） | 待派 |
| G | `src/run/`（除 A 两文件）+ `src/supervisor/`（除 model-router）+ `src/graph/` + `src/domain/`（42） | 待派 |
| H | evaluation 8 + requirement 7 + review 4 + rubric 2（21） | 待派 |
| I | cli 13 + pi-adapter 9 + config 2 + telemetry 1（25） | 待派 |
| J | cluster 3 + privacy 3 + preferences 7 + episode 5 + persist 2 + track 4 + context 2 + feedback 3（29） | 待派 |

默认对照取最近已合入轮：A = R39-A（13.6–16.0 µs/gate ⇒ ~68–80 µs/run）；B = R39-B（ceiling M=2 8.31–9.77 / M=10 16.99–17.36；replay M=2 9.63–10.00）；C = R39-C（中位 665.9–693.4；组合天花板 19.0–30.1 < 35；sink=7.309；中段宿主，freeze 0 行）；D = R39-D（S0c 3.46–3.50 ms）；E = R39-E（SLICE-CPU 15.0；默认带沿用 14.7–15.2；freeze 0 行）；F = R39-F（r5f 128.29/126.03/123.63、r6f 121.06/121.21/131.89、r7f 130.95/126.05/130.38；混合散射宿主窗，freeze 0 行）；G = R39-G（compute 0.283–0.302 vs I/O 80.8–99.0；digest 第三十次相同，**禁止**再铸 digest 轴号）；H = R39-H（默认链 9201/9008/9247 ns；宿主中窗，freeze 0 行）；I = R39-I（custom−builtin children +22.8~+24.1 / +41.9~+45.2、track +24.9~+29.2 / +47.8~+54.9、flowchart +12.6~+24.2 / +40.5~+43.9；freeze 0 行）；J = R39-J（preferences 140.7–226.1 / 404.9–536.5；jsonl 60.4–67.1 / fsync=true 242.2–395.3；J1 2468 / 2929.4×；freeze 0 行）。S12-B-2 条件陆器仍未触发。S8-I-1 两侧 file-level 封死。S13-B-1 仍为 loser ID。S7-F-1 ≠ S6-F-5。S5-H-1 保持。catalog 行序契约决策承载（R28-B W3）。npm POSIX `.bin` symlink 静默 no-op（R28-I）**禁止**当优化修。

## 第四十遍焦点

**A — 本波派出**：14 文件；基线 `7acb666`。预期冻结空；`wc -l` R39-A 记 1796。默认对照 R39-A（13.6–16.0 µs/gate ⇒ ~68–80 µs/run）。非再移植：R39-A 三项换名检查（turn.ts:75 `previous?.openMinors ?? []` / roller.ts:30/:32/:36 三重 `previous?.X ?? []` / roller.ts:84–85 条件 spread 空对象臂）、R38-A 三项换名检查、R37-A 三项换名检查、R33-A 44/44 闭合稳定性方法、R32-A 重开条件哨兵方法、R33-A … R39-J 空枚举。若落地：gate + 既有 A harness。报告 `docs/reports/sota-opt/round-40/R40-A.md`。禁止开 PR。

**B — 本波派出**：10 文件（r0 / assign / assign-plan / policy / live-cascade / live-selection / analyze-task / primary-catalog / catalog-model + `src/supervisor/model-router.ts`）。**不要**纳入 `catalog-observed.ts`。基线 `94ed3d9`。预期冻结空；`wc -l` R39-B 记 1359。默认对照 R39-B（ceiling M=2 8.31–9.77 / M=10 16.99–17.36；replay M=2 9.63–10.00）。S12-B-2 条件陆器仍未触发。S13-B-1 仍为 loser ID。catalog 行序契约（R28-B W3）决策承载，禁止预排序。非再移植：R39-B 零新站点级记录、R38-B 零新站点级记录、R37-B 零新站点级记录、R33-A … R39-J 空枚举。若落地：gate + 既有 B harness。报告 `docs/reports/sota-opt/round-40/R40-B.md`。禁止开 PR。

**C — 本波派出**：9 文件（r1 / r1-shadow-report / posterior / offline-logit / offline-prob-add / propensity / lin-alg / bandit / shadow）。基线 `183df9b`。预期冻结空；`wc -l` R39-C 记 2039。默认对照 R39-C（中位 665.9–693.4；组合天花板 19.0–30.1 < 35；sink=7.309）。非再移植：R39-C 零新站点级记录、R36-C `routeR1` cheapest-`reduce` 再算 `costOf`、R35-C `estimateForKey` 双 `weightedSampleSize` CSE、R33-A … R39-J 空枚举。若落地：gate + 既有 C harness。报告 `docs/reports/sota-opt/round-40/R40-C.md`。禁止开 PR。

**D — 待派**：14 文件；基线 `82bef36`。预期冻结空；`wc -l` R39-D 记 3294。默认对照 R39-D（S0c 3.46–3.50 ms）。S9-D-4 / S12-D-1 仍关闭。非再移植：R39-D 零新站点级记录、R36-D 四项换名检查、R35-D 四项换名检查、R33-A … R39-J 空枚举。若落地：gate + 既有 D harness。报告 `docs/reports/sota-opt/round-40/R40-D.md`。禁止开 PR。

**E — 待派**：10 文件；基线 `adb20d7`。预期冻结空；`wc -l` R39-E 记 1770。默认对照 R39-E（SLICE-CPU 15.0；默认带沿用 14.7–15.2）。S8-E-1 仍恰 3 处。非再移植：R39-E 零新站点级记录、R38-E 零新站点级记录、R35-E `runAutoAdaptLoop` L88 `signals.some`、I/O text-codec topology、R33-A … R39-J 空枚举。若落地：gate + 既有 E harness。报告 `docs/reports/sota-opt/round-40/R40-E.md`。禁止开 PR。

**F — 待派**：15 文件；基线 `519101f`。预期冻结空；`wc -l` R39-F 记 2550。默认对照 R39-F（r5f 128.29/126.03/123.63、r6f 121.06/121.21/131.89、r7f 130.95/126.05/130.38）。S7-F-1 ≠ S6-F-5。BINDX 10 token / 8 行维持。非再移植：R39-F 零新站点级记录、R38-F 零新站点级记录、R37-F 零新站点级记录、R33-A … R39-J 空枚举。若落地：gate + r5f/r6f/r7f + 既有 F harness。报告 `docs/reports/sota-opt/round-40/R40-F.md`。禁止开 PR。

**G — 待派**：42 文件（`src/run/` 除 child-tracking / gate-apply；`src/supervisor/` 除 model-router；`src/graph/`；`src/domain/`）。基线 `4efee23`。预期冻结空；`wc -l` R39-G 记 8960。默认对照 R39-G（compute 0.283–0.302 vs I/O 80.8–99.0；digest `06cbcf92c098c8f0` 第三十次相同，若再同记**第三十一次**，**禁止**再铸 digest 轴号）。非再移植：R31-G 18 门闭合审计、R39-G 零新站点级记录、R36-G 一项换名检查（`contract.ts` `validateRequirementContract` 溯源中间数组）、R35-G 两项换名检查（孪生 Map 物化 / `familyForFlowNode`）、R33-A … R39-J 空枚举。若落地：gate + 既有 G harness。报告 `docs/reports/sota-opt/round-40/R40-G.md`。禁止开 PR。

**H — 待派**：21 文件（evaluation 8：evaluator / precedence / delivery-adapter / check-adapter / adapters / diff-adapter / types / ownership；requirement 7：coverage / critic / extractor / heuristic / precedence / provenance / normalizer；review 4：pairwise / self-review / reconcile / critic；rubric 2：registry / types）。基线 `fd437a9`。预期冻结空；`wc -l` R39-H 记 1750。S5-H-1 保持。默认对照 R39-H（默认链 9201/9008/9247 ns）。非再移植：provenance-resolution pathway、R31-H 四扇边界参数残门、R39-H 零新站点级记录、R38-H 零新站点级记录、R37-H 零新站点级记录、R33-A … R39-J 空枚举。若落地：gate + 既有 H harness。报告 `docs/reports/sota-opt/round-40/R40-H.md`。禁止开 PR。

**I — 待派**：25 文件（cli 13：main / model-catalog / doctor-overlay / doctor / adapt / models / flowchart-io / commits / errors / episode / pause / auth / inject；pi-adapter 9：listed-model-lazy / listed-model-common / listed-model / auth-session / cluster-tools / index / pi-executor / file-credential-store / runtime；config 2：providers-config / model-ref；telemetry 1：model-invocation）。基线 `8dee7fb`。预期冻结空；`wc -l` R39-I 记 4708。S8-I-1 两侧 file-level 封死。**禁止**把 npm POSIX `.bin` symlink 静默 no-op 当优化修。默认对照 R39-I（custom−builtin children +22.8~+24.1 / +41.9~+45.2、track +24.9~+29.2 / +47.8~+54.9、flowchart +12.6~+24.2 / +40.5~+43.9）。非再移植：process-lifetime temporal-segment topology、R31-I CLI 进程边界门扉闭合审计、R39-I 零新站点级记录、R38-I 零新站点级记录、R37-I 零新站点级记录、R33-A … R39-J 空枚举。若落地：gate + r4i/r5i/r7i（68/119/80）。报告 `docs/reports/sota-opt/round-40/R40-I.md`。禁止开 PR。

**J — 待派**：29 文件；基线 `fb41417`。J1 锁定（2468 项逐位，2929.4× 宿主偏移）。默认对照 R39-J（preferences 140.7–226.1 / 404.9–536.5；jsonl 60.4–67.1 / fsync=true 242.2–395.3）。非再移植：**LINKTOP**、**CSPELL**、**ZREP**、**SIDEC**、**BINDX**、**MODEX**、R32-J 六个从未受控残余坐标、R34-J 四项换名检查、R39-J 零新站点级记录（`deleteObservation`=DELINV；`loadFromDisk` hydration=R22-J/R23-J/R26-J + once-per-configure；`loop.ts` 双投影=R2-J/S4-J-4 族）、R38-J 零新站点级记录、R37-J 零新站点级记录、R33-A … R39-J 空枚举。若落地：gate + J1 仿真（2468）+ 既有 J harness。报告 `docs/reports/sota-opt/round-40/R40-J.md`。禁止开 PR。

A–J 均要求返回首行 `MODEL_SLUG=claude-fable-5-thinking-xhigh`，末两行 `MORE_OPTIMA=yes|no` 与 `BRANCH=...`。模型必须是 **claude-fable-5-thinking-xhigh**，禁止静默降级。

## 期望

- 默认预期：诚实空枚举。空枚举轴外号只进本 PLAN「禁止再编号」+ 首段 unnamed plan-ban，**不**进 EXCLUSIONS 表。
- 若有候选：理论 + 确定性 sim + 真尺度非噪声（offline-logit ±35 ms；µs/ns 与 once-per-run CLI 噪声拒收）。输家脚本只进报告附录，不提交仓库。
- 平台硬顶 3 并发云 VM；本波保持 R40-A + R40-B + R40-C。
- Round 39 已 10/10 收口。Round 40 在 J 返回并合入后 10/10 收口，再开 Round 41。
