# Round 36 作战计划

**目标**：在 R35 十切片诚实空枚举关闭（无 S35-A-* … S35-J-*；R35-A 三项换名检查拒列，未铸造新面；R35-G digest 第二十六次相同，未铸造 digest 轴号；R35-J 零新站点级换名记录、六个从未受控残余坐标未过三合取）以及 **FITQ / NAMESHAPE / SCALEX / XPROC / YMIX / SCHEDWIN / KFAN / NVG / SEEDX / TERMCLASS / SHAPEK / ORDX / CKMIX / CALLB / OCCX / JB / RUNLIM / VALCLASS / CG / AGEX / COTARG / PRICEX / RTL / DELINV / PROBX / RVL / SIDEC / PWL / ZREP / PAIRX / CSPELL / REPRX / LINKTOP / BINDX / MODEX** 具名 ban 的前提下，对十切片做**第三十六遍**独立枚举。R35 已 10/10 关闭。本轮状态：**A/B/C 本波派出；D–J 待派**。

**约束**：

- R8–R35 已合入切片全部诚实空枚举。无新 S35-A-* … S35-J-*。
- 生产基线未变：最后 `src/` 提交仍为 `183df9b`（S7-C）。
- 禁止再编号：FITQ、NAMESHAPE、SCALEX、XPROC、YMIX、SCHEDWIN、KFAN、NVG、SEEDX、TERMCLASS、SHAPEK、ORDX、CKMIX、CALLB、OCCX、JB、RUNLIM、VALCLASS、CG、AGEX、COTARG、PRICEX、RTL、DELINV、PROBX、RVL、SIDEC、PWL、ZREP、PAIRX、CSPELL、REPRX、LINKTOP、BINDX、MODEX（空枚举轴外号，**不是** EXCLUSIONS 表行）。
- R21–R35 具名 / unnamed 面与上列停驻 / 分解 / 审计记录亦 plan-ban，**不**写入 EXCLUSIONS 表行。R32-A 重开条件哨兵审计（F12a–d）与 R32-B 闭合稳定性审计（54/54 裁决仍立；五扇残门 D1–D5 按归属关闭）按方法 / 停驻记录，**不**铸造新面、**不**写入 EXCLUSIONS 表行。R33-A 把 R32-B 三腿方法应用到 A 区 44 行账本（44/44 仍立）亦为方法卫生，**禁止**再铸「再查一遍闭合稳定性」式新面。**禁止**把「再查一遍重开条件 / 闭合稳定性 / 门扉」铸成新面。R35-G digest `06cbcf92c098c8f0` 第二十六次相同 — 若本轮再同，记**第二十七次**相同，**禁止**再铸 digest 轴号。
- 落地条件、硬不变量、sim 家族与 [PROGRESS.md](../PROGRESS.md) / [EXCLUSIONS.md](../EXCLUSIONS.md) / [round-35/PLAN.md](../round-35/PLAN.md) 一致。

## 切片（与 R1–R35 相同）

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

默认对照取最近已合入轮：A = R35-A（12.6–19.0 µs/gate ⇒ ~63–95 µs/run；19.0 单格宿主抖动）；B = R35-B（ceiling M=2 9.78–10.25 / M=10 15.54–15.85；replay M=2 8.18–9.24；主机偏快，freeze 0 行）；C = R35-C（中位 657.9–662.3；组合天花板 22.3–27.7 < 35；sink=7.309；主机偏快，freeze 0 行）；D = R35-D（S0c 3.54–3.93 ms）；E = R35-E（SLICE-CPU cmp25 14.6–15.2；主机偏快，freeze 0 行）；F = R35-F（r5f 117.53/126.01/117.46、r6f 119.12/117.99/117.61、r7f 124.19/127.43/125.82；主机偏快，freeze 0 行）；G = R35-G（compute 0.293–0.303 vs I/O 87.0–100.0；digest 第二十六次相同，**禁止**再铸 digest 轴号）；H = R35-H（默认链 8927/9022/8970 ns）；I = R35-I（custom−builtin children +44.9~+58.9 / +20.8~+30.2、track +45.1~+69.6 / +23.2~+31.5、flowchart-flat64 +43.5~+48.9 / +10.5~+30.5；宿主窗动，freeze 0 行）；J = R35-J（preferences 146.3–253.7 / 438.7–509.9；jsonl 69.7–76.9 / pass-2 290.0–326.3；宿主窗，freeze 0 行）。S12-B-2 条件陆器仍未触发。S8-I-1 两侧 file-level 封死。S13-B-1 仍为 loser ID。S7-F-1 ≠ S6-F-5。S5-H-1 保持。catalog 行序契约决策承载（R28-B W3）。npm POSIX `.bin` symlink 静默 no-op（R28-I）**禁止**当优化修。

## 第三十六遍焦点

**A — 本波派出**：14 文件（tracking 12：analysis / combined-score / config / from-child / gates / human-score / index / isolation / prescore / roller / turn / types + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`）。基线 `7acb666`。预期冻结空；`wc -l` R35-A 记 1796。默认对照 R35-A（12.6–19.0 µs/gate ⇒ ~63–95 µs/run；19.0 单格宿主抖动）。非再移植：R32-A 重开条件哨兵审计（F12a–d）、R33-A A 账本 44/44 闭合稳定性卫生、R35-A 三项换名检查、R33-A … R35-J 空枚举。**禁止**把「再查一遍重开条件 / 闭合稳定性」铸成新面。若落地：gate + 既有 A harness。报告 `docs/reports/sota-opt/round-36/R36-A.md`。禁止开 PR。

**B — 本波派出**：10 文件（r0 / assign / assign-plan / policy / live-cascade / live-selection / analyze-task / primary-catalog / catalog-model + `src/supervisor/model-router.ts`；**不含** `catalog-observed.ts`）。基线 `94ed3d9`。预期冻结空；`wc -l` R35-B 记 1359。默认对照 R35-B（ceiling M=2 9.78–10.25 / M=10 15.54–15.85；replay M=2 8.18–9.24；主机偏快）。S12-B-2 仍未触发；S13-B-1 仍为 loser ID；catalog 行序未触。非再移植：R32-B 闭合稳定性审计、R35-B 零新站点级记录、R33-A … R35-J 空枚举。若落地：gate + 既有 B harness。报告 `docs/reports/sota-opt/round-36/R36-B.md`。禁止开 PR。

**C — 本波派出**：9 文件（r1 / r1-shadow-report / posterior / offline-logit / offline-prob-add / propensity / lin-alg / bandit / shadow）。基线 `183df9b`。预期冻结空；`wc -l` R35-C 记 2039。默认对照 R35-C（中位 657.9–662.3；组合天花板 22.3–27.7 < 35；sink=7.309；主机偏快）。非再移植：R35-C `estimateForKey` 双 `weightedSampleSize` CSE 换名检查、**BINDX**、R33-A … R35-J 空枚举。若落地：gate + 既有 C harness。报告 `docs/reports/sota-opt/round-36/R36-C.md`。禁止开 PR。

**D — 待派**：14 文件；基线 `82bef36`。预期冻结空；`wc -l` R35-D 记 3294。默认对照 R35-D（S0c 3.54–3.93 ms）。S9-D-4 / S12-D-1 仍关闭。非再移植：R35-D 四项换名检查、R33-A … R35-J 空枚举。若落地：gate + 既有 D harness。报告 `docs/reports/sota-opt/round-36/R36-D.md`。禁止开 PR。

**E — 待派**：10 文件；基线 `adb20d7`。预期冻结空；`wc -l` R35-E 记 1770。默认对照 R35-E（SLICE-CPU cmp25 14.6–15.2；主机偏快）。S8-E-1 仍恰 3 处。非再移植：R35-E `runAutoAdaptLoop` L88 `signals.some` 换名检查、I/O text-codec topology、R33-A … R35-J 空枚举。若落地：gate + 既有 E harness。报告 `docs/reports/sota-opt/round-36/R36-E.md`。禁止开 PR。

**F — 待派**：15 文件；基线 `519101f`。预期冻结空；`wc -l` R35-F 记 2550。默认对照 R35-F（r5f 117.53/126.01/117.46、r6f 119.12/117.99/117.61、r7f 124.19/127.43/125.82；主机偏快）。S7-F-1 ≠ S6-F-5。BINDX 10 token / 8 行维持。非再移植：R35-F 零新站点级记录、R33-A … R35-J 空枚举。若落地：gate + r5f/r6f/r7f + 既有 F harness。报告 `docs/reports/sota-opt/round-36/R36-F.md`。禁止开 PR。

**G — 待派**：42 文件（`src/run/` 除 child-tracking / gate-apply；`src/supervisor/` 除 model-router；`src/graph/`；`src/domain/`）。基线 `4efee23`。预期冻结空；`wc -l` R35-G 记 8960。默认对照 R35-G（compute 0.293–0.303 vs I/O 87.0–100.0；digest `06cbcf92c098c8f0` 第二十六次相同，若再同记**第二十七次**，**禁止**再铸 digest 轴号）。非再移植：R31-G 18 门闭合审计、R35-G 两项换名检查（孪生 Map 物化 / `familyForFlowNode`）、R33-A … R35-J 空枚举。若落地：gate + 既有 G harness。报告 `docs/reports/sota-opt/round-36/R36-G.md`。禁止开 PR。

**H — 待派**：21 文件（evaluation 8：evaluator / precedence / delivery-adapter / check-adapter / adapters / diff-adapter / types / ownership；requirement 7：coverage / critic / extractor / heuristic / precedence / provenance / normalizer；review 4：pairwise / self-review / reconcile / critic；rubric 2：registry / types）。基线 `fd437a9`。预期冻结空；`wc -l` R35-H 记 1750。S5-H-1 保持。默认对照 R35-H（默认链 8927/9022/8970 ns）。非再移植：provenance-resolution pathway、R31-H 四扇边界参数残门、R35-H 零新站点级记录、R33-A … R35-J 空枚举。若落地：gate + 既有 H harness。报告 `docs/reports/sota-opt/round-36/R36-H.md`。禁止开 PR。

**I — 待派**：25 文件（cli 13：main / model-catalog / doctor-overlay / doctor / adapt / models / flowchart-io / commits / errors / episode / pause / auth / inject；pi-adapter 9：listed-model-lazy / listed-model-common / listed-model / auth-session / cluster-tools / index / pi-executor / file-credential-store / runtime；config 2：providers-config / model-ref；telemetry 1：model-invocation）。基线 `8dee7fb`。预期冻结空；`wc -l` R35-I 记 4708。S8-I-1 两侧 file-level 封死。**禁止**把 npm POSIX `.bin` symlink 静默 no-op 当优化修。默认对照 R35-I（custom−builtin children +44.9~+58.9 / +20.8~+30.2、track +45.1~+69.6 / +23.2~+31.5、flowchart-flat64 +43.5~+48.9 / +10.5~+30.5）。非再移植：process-lifetime temporal-segment topology、R31-I CLI 进程边界门扉闭合审计、R35-I 零新站点级记录、R33-A … R35-J 空枚举。若落地：gate + r4i/r5i/r7i（68/119/80）。报告 `docs/reports/sota-opt/round-36/R36-I.md`。禁止开 PR。

**J — 待派**：29 文件；基线 `fb41417`。J1 锁定（2468 项逐位，2948.5× 宿主偏移）。默认对照 R35-J（preferences 146.3–253.7 / 438.7–509.9；jsonl 69.7–76.9 / pass-2 290.0–326.3；宿主窗）。非再移植：**LINKTOP**、**CSPELL**、**ZREP**、**SIDEC**、**BINDX**、**MODEX**、R32-J 六个从未受控残余坐标、R34-J 四项换名检查、R35-J 零新站点级记录、R33-A … R35-J 空枚举。若落地：gate + J1 仿真（2468）+ 既有 J harness。报告 `docs/reports/sota-opt/round-36/R36-J.md`。禁止开 PR。

A–J 均要求返回首行 `MODEL_SLUG=claude-fable-5-thinking-xhigh`，末两行 `MORE_OPTIMA=yes|no` 与 `BRANCH=...`。模型必须是 **claude-fable-5-thinking-xhigh**，禁止静默降级。

## 期望

- 默认预期：诚实空枚举。空枚举轴外号只进本 PLAN「禁止再编号」+ 首段 unnamed plan-ban，**不**进 EXCLUSIONS 表。
- 若有候选：理论 + 确定性 sim + 真尺度非噪声（offline-logit ±35 ms；µs/ns 与 once-per-run CLI 噪声拒收）。输家脚本只进报告附录，不提交仓库。
- 平台硬顶 3 并发云 VM；本波保持 R36-A + R36-B + R36-C。
- Round 35 已 10/10 收口。Round 36 在 J 返回并合入后 10/10 收口，再开 Round 37。
