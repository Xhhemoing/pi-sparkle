# Round 35 作战计划

**目标**：在 R34 十切片诚实空枚举关闭（无 S34-A-* … S34-J-*；R34-A 三项换名检查拒列，未铸造新面；R34-G digest 第二十五次相同，未铸造 digest 轴号；R34-J 四项换名检查拒列、六个从未受控残余坐标未过三合取）以及 **FITQ / NAMESHAPE / SCALEX / XPROC / YMIX / SCHEDWIN / KFAN / NVG / SEEDX / TERMCLASS / SHAPEK / ORDX / CKMIX / CALLB / OCCX / JB / RUNLIM / VALCLASS / CG / AGEX / COTARG / PRICEX / RTL / DELINV / PROBX / RVL / SIDEC / PWL / ZREP / PAIRX / CSPELL / REPRX / LINKTOP / BINDX / MODEX** 具名 ban 的前提下，对十切片做**第三十五遍**独立枚举。R34 已 10/10 关闭。本轮状态：**A/B/C 已合入；D/E 运行中；F 本波派出；G–J 待派**。

**约束**：

- R8–R34 已合入切片全部诚实空枚举。无新 S34-A-* … S34-J-*。R35-A / R35-B / R35-C 亦诚实空枚举关闭（无 S35-A-* / S35-B-* / S35-C-*）。
- 生产基线未变：最后 `src/` 提交仍为 `183df9b`（S7-C）。
- 禁止再编号：FITQ、NAMESHAPE、SCALEX、XPROC、YMIX、SCHEDWIN、KFAN、NVG、SEEDX、TERMCLASS、SHAPEK、ORDX、CKMIX、CALLB、OCCX、JB、RUNLIM、VALCLASS、CG、AGEX、COTARG、PRICEX、RTL、DELINV、PROBX、RVL、SIDEC、PWL、ZREP、PAIRX、CSPELL、REPRX、LINKTOP、BINDX、MODEX（空枚举轴外号，**不是** EXCLUSIONS 表行）。
- R21–R34 具名 / unnamed 面与上列停驻 / 分解 / 审计记录亦 plan-ban，**不**写入 EXCLUSIONS 表行。R32-A 重开条件哨兵审计（F12a–d）与 R32-B 闭合稳定性审计（54/54 裁决仍立；五扇残门 D1–D5 按归属关闭）按方法 / 停驻记录，**不**铸造新面、**不**写入 EXCLUSIONS 表行。R33-A 把 R32-B 三腿方法应用到 A 区 44 行账本（44/44 仍立）亦为方法卫生，**禁止**再铸「再查一遍闭合稳定性」式新面。**禁止**把「再查一遍重开条件 / 闭合稳定性 / 门扉」铸成新面。R34-G digest `06cbcf92c098c8f0` 第二十五次相同 — 若本轮再同，记**第二十六次**相同，**禁止**再铸 digest 轴号。
- 落地条件、硬不变量、sim 家族与 [PROGRESS.md](../PROGRESS.md) / [EXCLUSIONS.md](../EXCLUSIONS.md) / [round-34/PLAN.md](../round-34/PLAN.md) 一致。

## 切片（与 R1–R34 相同）

| 切片 | 范围 | 状态 |
| --- | --- | --- |
| A | `src/tracking/` + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14） | 已合入（空枚举；未铸造新面；12.6–19.0 µs/gate ⇒ ~63–95 µs/run；19.0 单格宿主抖动） |
| B | 在线路由 9 + `src/supervisor/model-router.ts`（10） | 已合入（空枚举；未铸造新面；ceiling M=2 9.78–10.25 / M=10 15.54–15.85；replay M=2 8.18–9.24；主机偏快） |
| C | 离线路由 9 | 已合入（空枚举；未铸造新面；中位 657.9–662.3；组合天花板 22.3–27.7 < 35；sink=7.309；主机偏快） |
| D | `src/adaptation/`（14） | 运行中 |
| E | `src/learning/`（10） | 运行中 |
| F | `src/experiments/`（15） | 本波派出 |
| G | `src/run/`（除 A 两文件）+ `src/supervisor/`（除 model-router）+ `src/graph/` + `src/domain/`（42） | 待派 |
| H | evaluation 8 + requirement 7 + review 4 + rubric 2（21） | 待派 |
| I | cli 13 + pi-adapter 9 + config 2 + telemetry 1（25） | 待派 |
| J | cluster 3 + privacy 3 + preferences 7 + episode 5 + persist 2 + track 4 + context 2 + feedback 3（29） | 待派 |

默认对照取最近已合入轮：A = R35-A（12.6–19.0 µs/gate ⇒ ~63–95 µs/run；19.0 单格宿主抖动）；B = R35-B（ceiling M=2 9.78–10.25 / M=10 15.54–15.85；replay M=2 8.18–9.24；主机偏快，freeze 0 行）；C = R35-C（中位 657.9–662.3；组合天花板 22.3–27.7 < 35；sink=7.309；主机偏快，freeze 0 行）；D = R34-D（S0c 3.65–4.70 ms；主机偏高，freeze 0 行）；E = R34-E（SLICE-CPU cmp25 14.8–15.1；主机偏快，freeze 0 行）；F = R34-F（r5f 119.21/119.51/128.96、r6f 121.63/123.10/121.90、r7f 129.72/130.28/128.18）；G = R34-G（compute 0.292–0.301 vs I/O 86.8–94.4；digest 第二十五次相同，**禁止**再铸 digest 轴号）；H = R34-H（默认链 8989/9021/8926 ns）；I = R34-I（custom−builtin children +48.1~+54.8 / +25.7~+27.4、track +52.8~+53.7 / +24.5~+29.1、flowchart-flat64 +39.1~+42.9 / +15.6~+34.2；宿主窗动）；J = R34-J（preferences 141.9–234.4 / 429.1–533.4；jsonl 61.2–69.4 / 227.1–338.2 µs）。S12-B-2 条件陆器仍未触发。S8-I-1 两侧 file-level 封死。S13-B-1 仍为 loser ID。S7-F-1 ≠ S6-F-5。S5-H-1 保持。catalog 行序契约决策承载（R28-B W3）。npm POSIX `.bin` symlink 静默 no-op（R28-I）**禁止**当优化修。

## 第三十五遍焦点

**A — 已合入（空枚举；未铸造新面）**：[R35-A.md](./R35-A.md)。14 文件；基线 `7acb666`。14 文件相对 `7acb666` 三验 0 行；`wc -l` 1796。三项新站点级换名检查拒收不铸 ID。预算重锚 12.6–19.0 µs/gate ⇒ ~63–95 µs/run（19.0 单格宿主抖动；剔除后 12.6–17.1 与 R34-A 交叠）。哨兵卫生复跑无一触发。**禁止**再编号为新 A 轴；**禁止**把「再查一遍重开条件 / 闭合稳定性」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**B — 已合入（空枚举；未铸造新面）**：[R35-B.md](./R35-B.md)。10 文件；基线 `94ed3d9`。10 文件相对 `94ed3d9` 冻结 0 行；`wc -l` 1359。预算重锚 ceiling M=2 9.78–10.25 / M=10 15.54–15.85；replay-faithful M=2 8.18–9.24（M=10 低于对照 17–19 窗；主机偏快，freeze 0 行）。零新站点级换名记录。S12-B-2 仍未触发；S13-B-1 仍为 loser ID；catalog 行序未触。**禁止**再编号为新 B 轴；**禁止**写入 EXCLUSIONS 表行。

**C — 已合入（空枚举；未铸造新面）**：[R35-C.md](./R35-C.md)。9 文件；基线 `183df9b`。9 文件相对 `183df9b` 五验 0 行；`wc -l` 2039。预算重锚中位 657.9–662.3（本 VM 快于 R34-C 682.1–682.5，交叠 R32-C 带；主机偏快，freeze 0 行）；组合天花板 22.3–27.7 < 35；sink=7.309 八读全同。一项换名检查拒列（`estimateForKey` 双 `weightedSampleSize` CSE）。**禁止**再编号为新 C 轴；**禁止**写入 EXCLUSIONS 表行。

**D — 运行中**：14 文件（promotion-rules / registry / eval-routing / promotion / active-pointer / monitor / retirement / approval-profile / resource / mutate / reflection / rollback / candidate / pareto）。基线 `82bef36`。预期冻结空；`wc -l` R34-D 记 3294。默认对照 R34-D（S0c 3.65–4.70 ms；主机偏高）。S9-D-4 / S12-D-1 永不再开。非再移植：R33-A … R34-J 空枚举、R35-A 空枚举、R35-B 空枚举、R35-C 空枚举。若落地：gate + 既有 D harness。报告 `docs/reports/sota-opt/round-35/R35-D.md`。禁止开 PR。

**E — 运行中**：10 文件（auto-loop / learned-routing / from-episode / signals / signatures / bandit-store / task-success / attribution / diagnostics / patterns）。基线 `adb20d7`。预期冻结空；`wc -l` R34-E 记 1770。默认对照 R34-E（SLICE-CPU cmp25 14.8–15.1；主机偏快）。S8-E-1 禁止去重 `loadLearnedRouting`（恰 3 处生产调用）。非再移植：PWL、RVL、RTL、CG、JB、NVG、REPRX、**BINDX**、I/O text-codec topology、R33-A … R34-J 空枚举、R35-A 空枚举、R35-B 空枚举、R35-C 空枚举。若落地：gate + 既有 E harness。报告 `docs/reports/sota-opt/round-35/R35-E.md`。禁止开 PR。

**F — 本波派出**：15 文件（canary / plan / shadow / gated-comparison / replay / comparison-report / threshold-calibration / shadow-compare / isolation / simulation-holdout / holdout / manifest / evaluation-card / dataset / attribution-report）。基线 `519101f`。预期冻结空；`wc -l` R34-F 记 2550。默认对照 R34-F（r5f 119.21/119.51/128.96、r6f 121.63/123.10/121.90、r7f 129.72/130.28/128.18）。S7-F-1 ≠ S6-F-5。非再移植：PAIRX、**BINDX**、R31-F 故障通道处置分解、R33-A … R34-J 空枚举、R35-A 空枚举、R35-B 空枚举、R35-C 空枚举。若落地：gate + r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）。报告 `docs/reports/sota-opt/round-35/R35-F.md`。禁止开 PR。

**G — 待派**：42 文件；基线 `4efee23`。默认对照 R34-G（compute 0.292–0.301 vs I/O 86.8–94.4；digest `06cbcf92c098c8f0` 第二十五次相同，若再同记**第二十六次**，**禁止**再铸 digest 轴号）。非再移植：R31-G 18 门闭合审计、R33-A … R34-J 空枚举、R35-A 空枚举、R35-B 空枚举、R35-C 空枚举。若落地：gate + 既有 G harness。报告 `docs/reports/sota-opt/round-35/R35-G.md`。禁止开 PR。

**H — 待派**：21 文件（evaluation **8** 不是 9）；基线 `fd437a9`。S5-H-1 保持。默认对照 R34-H（默认链 8989/9021/8926 ns）。非再移植：provenance-resolution pathway、R31-H 四扇边界参数残门、R33-A … R34-J 空枚举、R35-A 空枚举、R35-B 空枚举、R35-C 空枚举。若落地：gate + 既有 H harness。报告 `docs/reports/sota-opt/round-35/R35-H.md`。禁止开 PR。

**I — 待派**：25 文件；基线 `8dee7fb`。S8-I-1 两侧 file-level 封死。**禁止**把 npm POSIX `.bin` symlink 静默 no-op 当优化修。默认对照 R34-I（custom−builtin children +48.1~+54.8 / +25.7~+27.4、track +52.8~+53.7 / +24.5~+29.1、flowchart-flat64 +39.1~+42.9 / +15.6~+34.2）。非再移植：process-lifetime temporal-segment topology、R31-I CLI 进程边界门扉闭合审计、R33-A … R34-J 空枚举、R35-A 空枚举、R35-B 空枚举、R35-C 空枚举。若落地：gate + r4i/r5i/r7i（68/119/80）。报告 `docs/reports/sota-opt/round-35/R35-I.md`。禁止开 PR。

**J — 待派**：29 文件；基线 `fb41417`。J1 锁定（2468 项逐位，2760.9×）。默认对照 R34-J（preferences 141.9–234.4 / 429.1–533.4；jsonl 61.2–69.4 / 227.1–338.2 µs）。非再移植：**LINKTOP**、**CSPELL**、**ZREP**、**SIDEC**、**BINDX**、**MODEX**、R32-J 六个从未受控残余坐标、R34-J 四项换名检查（`track/plan.ts` 内联 regex / `readFeedback` 串行双读 / `host.ts` broadcast trim/slice / `closure.ts` legacy-match 模板）、R33-A … R34-J 空枚举、R35-A 空枚举、R35-B 空枚举、R35-C 空枚举。若落地：gate + J1 仿真（2468）+ 既有 J harness。报告 `docs/reports/sota-opt/round-35/R35-J.md`。禁止开 PR。

A–J 均要求返回首行 `MODEL_SLUG=claude-fable-5-thinking-xhigh`，末两行 `MORE_OPTIMA=yes|no` 与 `BRANCH=...`。模型必须是 **claude-fable-5-thinking-xhigh**，禁止静默降级。

## 期望

- 默认预期：诚实空枚举。空枚举轴外号只进本 PLAN「禁止再编号」+ 首段 unnamed plan-ban，**不**进 EXCLUSIONS 表。
- 若有候选：理论 + 确定性 sim + 真尺度非噪声（offline-logit ±35 ms；µs/ns 与 once-per-run CLI 噪声拒收）。输家脚本只进报告附录，不提交仓库。
- 平台硬顶 3 并发云 VM；本波保持 R35-D + R35-E + R35-F。
- Round 34 已 10/10 收口。Round 35 在 J 返回并合入后 10/10 收口，再开 Round 36。
