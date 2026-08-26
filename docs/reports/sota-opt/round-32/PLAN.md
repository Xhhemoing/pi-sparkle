# Round 32 作战计划

**目标**：在 R30 十面与 R31 已合入面（**BINDX** / I/O text-codec topology / per-run transcode-byte manifest；R31-A injected-callable 停驻；R31-B 面格六门停驻；R31-D R22-D 所有权单元格；R31-F 故障通道处置分解；R31-G 全切片门扉闭合审计；R31-H 边界参数平面四门分解/停驻）以及 **FITQ / NAMESHAPE / SCALEX / XPROC / YMIX / SCHEDWIN / KFAN / NVG / SEEDX / TERMCLASS / SHAPEK / ORDX / CKMIX / CALLB / OCCX / JB / RUNLIM / VALCLASS / CG / AGEX / COTARG / PRICEX / RTL / DELINV / PROBX / RVL / SIDEC / PWL / ZREP / PAIRX / CSPELL / REPRX / LINKTOP / BINDX** 具名 ban 的前提下，对十切片做**第三十二遍**独立枚举。R31 尚未 10/10（I/J 仍运行中）；R31-I / R31-J 合入后若铸新面，本轮在飞子代理须 rebase docs-only 并把新轴加入非移植清单。本轮状态：**A 本波派出；B–J 待派出**。

**约束**：

- R8–R31 已合入切片全部诚实空枚举（R31-I/J 待回）。无新 S31-A-* … S31-H-*。
- 生产基线未变：最后 `src/` 提交仍为 `183df9b`（S7-C）。
- 禁止再编号：FITQ、NAMESHAPE、SCALEX、XPROC、YMIX、SCHEDWIN、KFAN、NVG、SEEDX、TERMCLASS、SHAPEK、ORDX、CKMIX、CALLB、OCCX、JB、RUNLIM、VALCLASS、CG、AGEX、COTARG、PRICEX、RTL、DELINV、PROBX、RVL、SIDEC、PWL、ZREP、PAIRX、CSPELL、REPRX、LINKTOP、BINDX（空枚举轴外号，**不是** EXCLUSIONS 表行）。
- R21–R31 具名 / unnamed 面与上列停驻 / 分解 / 审计记录亦 plan-ban，**不**写入 EXCLUSIONS 表行。
- 落地条件、硬不变量、sim 家族与 [PROGRESS.md](../PROGRESS.md) / [EXCLUSIONS.md](../EXCLUSIONS.md) / [round-31/PLAN.md](../round-31/PLAN.md) 一致。

## 切片（与 R1–R31 相同）

| 切片 | 范围 | 状态 |
| --- | --- | --- |
| A | `src/tracking/` + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14） | 本波派出 |
| B | 在线路由 9 + `src/supervisor/model-router.ts`（10） | 待派出 |
| C | 离线路由 9 | 待派出 |
| D | `src/adaptation/`（14） | 待派出 |
| E | `src/learning/`（10） | 待派出 |
| F | `src/experiments/`（15） | 待派出 |
| G | `src/run/`（除 A 两文件）+ `src/supervisor/`（除 model-router）+ `src/graph/` + `src/domain/`（42） | 待派出 |
| H | evaluation 8 + requirement 7 + review 4 + rubric 2（21） | 待派出 |
| I | cli 13 + pi-adapter 9 + config 2 + telemetry 1（25） | 待派出 |
| J | cluster 3 + privacy 3 + preferences 7 + episode 5 + persist 2 + track 4 + context 2 + feedback 3（29） | 待派出 |

默认对照取最近已合入轮：A = R31-A（13.6–16.9 µs/gate ⇒ ~68–84 µs/run）；B = R31-B（M=2 9.25–11.46 / M=10 21.02–23.17）；C = R31-C（中位 658.1–660.1；APC 20.7–25.1 < 35；sink=7.309）；D = R31-D（S0c 3.38–3.64 ms）；E = R31-E（SLICE-CPU cmp25 14.9–15.3）；F = R31-F（r5f 119.97/121.51/122.37、r6f 119.70/119.52/117.11、r7f 127.81/129.00/130.55）；G = R31-G（compute 0.284–0.293 vs I/O 92.6–105.2；digest 第二十二次相同，**禁止**再铸 digest 轴号）；H = R31-H（默认链 8889/9350/8996 ns）；I = R30-I（custom−builtin 带；R31-I 回后改用其锚）；J = R30-J（I/O 地板；R31-J 回后改用其锚）。S12-B-2 条件陆器仍未触发。S8-I-1 两侧 file-level 封死。S13-B-1 仍为 loser ID。S7-F-1 ≠ S6-F-5。S5-H-1 保持。catalog 行序契约决策承载（R28-B W3）。npm POSIX `.bin` symlink 静默 no-op（R28-I）**禁止**当优化修。

## 第三十二遍焦点

**A — 本波派出**：14 文件（`src/tracking/` 12 + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`）。基线 `7acb666`。默认对照 R31-A（13.6–16.9 µs/gate ⇒ ~68–84 µs/run）。非再移植：call-stream ordering / dispatch-history、跨工具调用序 / 跨工具时序拓扑、FITQ、CALLB、OCCX、SEEDX、KFAN、injected-callable 平面（R31-A 停驻；`generateEventId` / `readers.readToolBodies` 不是独立物理对象）、**BINDX**、I/O text-codec topology / per-run transcode-byte manifest、R31-B 六个停驻门、R31-D 的 R22-D 单元格、R31-F 故障通道处置残格、R31-G 门扉闭合审计、R31-H 四扇边界参数残门。若落地：gate + 既有 A harness。报告 `docs/reports/sota-opt/round-32/R32-A.md`。禁止开 PR。

**B — 待派出**：10 文件；基线 `94ed3d9`。S12-B-2 条件陆器仍未触发。非再移植：scale-cube 二阶交互、SCALEX、ORDX、AGEX、YMIX、SHAPEK、REPRX、LINKTOP、R31-B 六个停驻门。

**C — 待派出**：9 文件；基线 `183df9b`。非再移植：**REPRX**、**BINDX**（realm-level 绑定态；C1 capture-hoist 已拒）、KFAN、COTARG、PROBX、DELINV、PRICEX、VALCLASS。digest / sink=7.309 位等不另铸轴。

**D — 待派出**：14 文件；基线 `82bef36`。S9-D-4 / S12-D-1 永不再开。非再移植：approval-profile constraint-list geometry、SIDEC、PAIRX、CSPELL、ZREP、R31-D 的 R22-D 单元格。

**E — 待派出**：10 文件；基线 `adb20d7`。非再移植：async suspension-point、PWL、RVL、RTL、CG、JB、NVG、REPRX、PAIRX、ZREP、LINKTOP、**BINDX**、I/O text-codec topology / per-run transcode-byte manifest。

**F — 待派出**：15 文件；基线 `519101f`。S7-F-1 ≠ S6-F-5。非再移植：boundary output-consumption、输出保留、调用协议、访问路径、存储状态、PAIRX、**BINDX**、I/O text-codec、R31-F 故障通道处置残格。

**G — 待派出**：42 文件；基线 `4efee23`。digest `06cbcf92c098c8f0` **禁止**再铸轴号。非再移植：M1 / M2 / decision-gate / join-policy、**RUNLIM** / **CKMIX** / **TERMCLASS** / **SCHEDWIN** / **XPROC** / **NAMESHAPE**、**ZREP**、**BINDX**、I/O text-codec、R31-G 门扉闭合审计。

**H — 待派出**：21 文件；基线 `fd437a9`。S5-H-1 保持。非再移植：provenance-resolution、coverage-relation、argument-slot、execution-substrate、**BINDX**、I/O text-codec、R31-H 四扇边界参数残门。

**I — 待派出**：25 文件；基线 `8dee7fb`。S8-I-1 两侧 file-level 封死。**禁止**把 npm POSIX `.bin` symlink 静默 no-op 当优化修。非再移植：process-lifetime temporal-segment、JSON serialization-form、invocation-identity、**NAMESHAPE**、**BINDX**、I/O text-codec。

**J — 待派出**：29 文件；基线 `fb41417`。J1 锁定。非再移植：**LINKTOP**、**CSPELL**、**ZREP**、**SIDEC**、**BINDX**、I/O text-codec。

A–J 均要求返回首行 `MODEL_SLUG=claude-fable-5-thinking-xhigh`，末两行 `MORE_OPTIMA=yes|no` 与 `BRANCH=...`。模型必须是 **claude-fable-5-thinking-xhigh**，禁止静默降级。

## 期望

- 默认预期：诚实空枚举。空枚举轴外号只进本 PLAN「禁止再编号」+ 首段 unnamed plan-ban，**不**进 EXCLUSIONS 表。
- 若有候选：理论 + 确定性 sim + 真尺度非噪声（offline-logit ±35 ms；µs/ns 与 once-per-run CLI 噪声拒收）。输家脚本只进报告附录，不提交仓库。
- 平台硬顶 3 并发云 VM；本波保持 R31-I + R31-J + R32-A。
- Round 31 在 J 返回并合入后 10/10 收口；Round 32 在 J 返回并合入后 10/10 收口，再开 Round 33。
