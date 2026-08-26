# Round 32 作战计划

**目标**：在 R30 十面与 R31 已合入面（**BINDX** / I/O text-codec topology / per-run transcode-byte manifest；R31-A injected-callable 停驻；R31-B 面格六门停驻；R31-D R22-D 所有权单元格；R31-F 故障通道处置分解；R31-G 全切片门扉闭合审计；R31-H 边界参数平面四门分解/停驻；R31-I CLI 进程边界门扉闭合审计；R31-J **MODEX**）以及 **FITQ / NAMESHAPE / SCALEX / XPROC / YMIX / SCHEDWIN / KFAN / NVG / SEEDX / TERMCLASS / SHAPEK / ORDX / CKMIX / CALLB / OCCX / JB / RUNLIM / VALCLASS / CG / AGEX / COTARG / PRICEX / RTL / DELINV / PROBX / RVL / SIDEC / PWL / ZREP / PAIRX / CSPELL / REPRX / LINKTOP / BINDX / MODEX** 具名 ban 的前提下，对十切片做**第三十二遍**独立枚举。R31 已 10/10 关闭（铸造 **MODEX**）。本轮状态：**A–B、D 已合入；C 运行中；E 运行中；F 本波派出；G–J 待派出**。

**约束**：

- R8–R31 已合入切片全部诚实空枚举。无新 S31-A-* … S31-J-*。R32-A / R32-B / R32-D 亦诚实空枚举关闭（无 S32-A-* / S32-B-* / S32-D-*）。
- 生产基线未变：最后 `src/` 提交仍为 `183df9b`（S7-C）。
- 禁止再编号：FITQ、NAMESHAPE、SCALEX、XPROC、YMIX、SCHEDWIN、KFAN、NVG、SEEDX、TERMCLASS、SHAPEK、ORDX、CKMIX、CALLB、OCCX、JB、RUNLIM、VALCLASS、CG、AGEX、COTARG、PRICEX、RTL、DELINV、PROBX、RVL、SIDEC、PWL、ZREP、PAIRX、CSPELL、REPRX、LINKTOP、BINDX、MODEX（空枚举轴外号，**不是** EXCLUSIONS 表行）。
- R21–R31 具名 / unnamed 面与上列停驻 / 分解 / 审计记录亦 plan-ban，**不**写入 EXCLUSIONS 表行。R32-A 重开条件哨兵审计（F12a–d）与 R32-B 闭合稳定性审计（54/54 裁决仍立；五扇残门 D1–D5 按归属关闭）按方法 / 停驻记录，**不**铸造新面、**不**写入 EXCLUSIONS 表行。
- 落地条件、硬不变量、sim 家族与 [PROGRESS.md](../PROGRESS.md) / [EXCLUSIONS.md](../EXCLUSIONS.md) / [round-31/PLAN.md](../round-31/PLAN.md) 一致。

## 切片（与 R1–R31 相同）

| 切片 | 范围 | 状态 |
| --- | --- | --- |
| A | `src/tracking/` + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14） | 已合入（空枚举；未铸造新面；重开条件哨兵审计 F12a–d；13.5–15.7 µs/gate ⇒ ~68–79 µs/run） |
| B | 在线路由 9 + `src/supervisor/model-router.ts`（10） | 已合入（空枚举；未铸造新面；闭合稳定性审计 54/54；五扇残门 D1–D5 关闭；M=2 9.04–9.62 / M=10 17.84–18.43） |
| C | 离线路由 9 | 运行中 |
| D | `src/adaptation/`（14） | 已合入（空枚举；未铸造新面；元闭合 35 行无一松动；S0c 3.37–3.60 ms） |
| E | `src/learning/`（10） | 运行中 |
| F | `src/experiments/`（15） | 本波派出 |
| G | `src/run/`（除 A 两文件）+ `src/supervisor/`（除 model-router）+ `src/graph/` + `src/domain/`（42） | 待派出 |
| H | evaluation 8 + requirement 7 + review 4 + rubric 2（21） | 待派出 |
| I | cli 13 + pi-adapter 9 + config 2 + telemetry 1（25） | 待派出 |
| J | cluster 3 + privacy 3 + preferences 7 + episode 5 + persist 2 + track 4 + context 2 + feedback 3（29） | 待派出 |

默认对照取最近已合入轮：A = R31-A（13.6–16.9 µs/gate ⇒ ~68–84 µs/run）；B = R32-B（M=2 9.04–9.62 / M=10 17.84–18.43）；C = R31-C（中位 658.1–660.1；APC 20.7–25.1 < 35；sink=7.309）；D = R32-D（S0c 3.37–3.60 ms）；E = R31-E（SLICE-CPU cmp25 14.9–15.3）；F = R31-F（r5f 119.97/121.51/122.37、r6f 119.70/119.52/117.11、r7f 127.81/129.00/130.55）；G = R31-G（compute 0.284–0.293 vs I/O 92.6–105.2；digest 第二十二次相同，**禁止**再铸 digest 轴号）；H = R31-H（默认链 8889/9350/8996 ns）；I = R31-I（custom−builtin children +44.6~+46.0 / +21.4~+24.1、track +48.0~+55.4 / +24.0~+27.9、flowchart-flat64 +42.2~+50.2 / +15.3~+19.1）；J = R31-J（preferences 127.8–248.9 / 410.5–540.0；jsonl 59.1–65.7 / 253.3–304.6 µs）。S12-B-2 条件陆器仍未触发。S8-I-1 两侧 file-level 封死。S13-B-1 仍为 loser ID。S7-F-1 ≠ S6-F-5。S5-H-1 保持。catalog 行序契约决策承载（R28-B W3）。npm POSIX `.bin` symlink 静默 no-op（R28-I）**禁止**当优化修。

## 第三十二遍焦点

**A — 已合入（空枚举；未铸造新面；重开条件哨兵审计 F12a–d）**：[R32-A.md](./R32-A.md)。14 文件；基线 `7acb666`。14 文件相对 `7acb666` 三验 0 行；`wc -l` 1796。本轮系统性验证全部在案重开条件均未触发（F12a 四入口无新调用方；F12b Math.* = 6 token 未变、切片零 fs/codec、零 `JSON.parse`；F12c `requiredChecks` 仍契约封顶；F12d `DEFAULT_TRACKING_CONFIG` 未变）。预算重锚 13.5–15.7 µs/gate ⇒ ~68–79 µs/run。**禁止**再编号为新 A 轴；**禁止**把「再查一遍重开条件」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**B — 已合入（空枚举；未铸造新面；闭合稳定性审计）**：[R32-B.md](./R32-B.md)。10 文件；基线 `94ed3d9`。10 文件相对 `94ed3d9` 三验 0 行；`wc -l` 1359。本轮不重走 R31-B 面格，改做闭合稳定性审计：54/54 既有 B 排除裁决至少一腿仍立，无一重开。五扇残门（D1 决策记录字段活性普查——19/20 字段被消费，整构造份额 158.9–163.3 ns/task ≈ 0.65 ms/eval；D2–D5 故障对象通道 / 每呼闭包分配 / one-hot 载体形 / ESM live-binding）按普查 / 属地 / 量级关闭。天花板重锚 M=2 9.04–9.62 / M=10 17.84–18.43（回落 R30-B 带；R31-B +10–27% 为主机偏置）。S12-B-2 腿 (a) 仍未触发；S13-B-1 仍为 loser ID。**禁止**再编号为新 B 轴；**禁止**把「再查一遍闭合稳定性」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**C — 运行中**：9 文件（`src/routing/r1.ts`、`r1-shadow-report.ts`、`posterior.ts`、`offline-logit.ts`、`offline-prob-add.ts`、`propensity.ts`、`lin-alg.ts`、`bandit.ts`、`shadow.ts`）。基线 `183df9b`（S7-C；最后 `src/routing/` 生产改动）。默认对照 R31-C（中位 658.1–660.1；APC 20.7–25.1 < 35；sink=floorSink=7.309）。r1c–r7c 8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193。非再移植：input object-representation / **REPRX**、**BINDX**（realm-level 绑定态；C1 capture-hoist 已价并拒——TurboFan 折叠 ambient load）、KFAN、COTARG、PROBX、DELINV、PRICEX、VALCLASS、PAIRX、**MODEX**、R32-A 重开条件哨兵审计、R32-B 闭合稳定性审计、R31-I CLI 进程边界门扉闭合审计。digest / sink=7.309 位等不另铸轴。若落地：重跑 r1c–r7c + gate；offline-logit ±35 ms。报告 `docs/reports/sota-opt/round-32/R32-C.md`。禁止开 PR。

**D — 已合入（空枚举；未铸造新面）**：[R32-D.md](./R32-D.md)。14 文件；基线 `82bef36`。14 文件相对 `82bef36` 两验 0 行；`wc -l` 3294。R31-D 元闭合 35 行从零重推无一松动；R22-D 属地格前提（零生产调用方）第三十二次成立。哨兵按 R32-A 方法仅作卫生应用，**不**铸「再查一遍重开条件」式新面。地板重锚 S0c 3.37–3.60 ms（与 R31-D 3.38–3.64 / R30-D 3.29–3.66 带交叠）。S9-D-4 / S12-D-1 永不再开。**禁止**再编号为新 D 轴；**禁止**写入 EXCLUSIONS 表行。

**E — 运行中**：10 文件（`src/learning/`：auto-loop.ts、learned-routing.ts、from-episode.ts、signals.ts、signatures.ts、bandit-store.ts、task-success.ts、attribution.ts、diagnostics.ts、patterns.ts）。基线 `adb20d7`。默认对照 R31-E（SLICE-CPU cmp25 14.9–15.3）。非再移植：async suspension-point topology / per-run suspension-manifest、PWL、RVL、RTL、CG、JB、NVG、REPRX、PAIRX、ZREP、LINKTOP、**BINDX**、**MODEX**、I/O text-codec topology / per-run transcode-byte manifest、R32-A 重开条件哨兵审计、R32-B 闭合稳定性审计。若落地：gate + 既有 E harness。报告 `docs/reports/sota-opt/round-32/R32-E.md`。禁止开 PR。

**F — 本波派出**：15 文件（`src/experiments/`：canary.ts、plan.ts、shadow.ts、gated-comparison.ts、replay.ts、comparison-report.ts、threshold-calibration.ts、shadow-compare.ts、isolation.ts、simulation-holdout.ts、holdout.ts、manifest.ts、evaluation-card.ts、dataset.ts、attribution-report.ts）。基线 `519101f`。S7-F-1 ≠ S6-F-5。默认对照 R31-F（r5f 119.97/121.51/122.37、r6f 119.70/119.52/117.11、r7f 127.81/129.00/130.55）。非再移植：boundary output-consumption / snapshot-readback topology、输出保留、调用协议、访问路径、存储状态、PAIRX、**BINDX**、**MODEX**、I/O text-codec topology / per-run transcode-byte manifest、R31-F 故障通道处置残格（propagate/swallow/read message/materialize stack/retain/wrap-rethrow 已分解，不新停驻）、R32-A 重开条件哨兵审计、R32-B 闭合稳定性审计。若落地：gate + r5f/r6f/r7f。报告 `docs/reports/sota-opt/round-32/R32-F.md`。禁止开 PR。

**G — 待派出**：42 文件；基线 `4efee23`。digest `06cbcf92c098c8f0` **禁止**再铸轴号。非再移植：M1 / M2 / decision-gate / join-policy、**RUNLIM** / **CKMIX** / **TERMCLASS** / **SCHEDWIN** / **XPROC** / **NAMESHAPE**、**ZREP**、**BINDX**、**MODEX**、I/O text-codec、R31-G 门扉闭合审计。

**H — 待派出**：21 文件；基线 `fd437a9`。S5-H-1 保持。非再移植：provenance-resolution、coverage-relation、argument-slot、execution-substrate、**BINDX**、**MODEX**、I/O text-codec、R31-H 四扇边界参数残门。

**I — 待派出**：25 文件；基线 `8dee7fb`。S8-I-1 两侧 file-level 封死。**禁止**把 npm POSIX `.bin` symlink 静默 no-op 当优化修。非再移植：process-lifetime temporal-segment、JSON serialization-form、invocation-identity、**NAMESHAPE**、**BINDX**、**MODEX**、I/O text-codec、R31-I CLI 进程边界门扉闭合审计。

**J — 待派出**：29 文件；基线 `fb41417`。J1 锁定。非再移植：**LINKTOP**、**CSPELL**、**ZREP**、**SIDEC**、**BINDX**、**MODEX**、I/O text-codec。

A–J 均要求返回首行 `MODEL_SLUG=claude-fable-5-thinking-xhigh`，末两行 `MORE_OPTIMA=yes|no` 与 `BRANCH=...`。模型必须是 **claude-fable-5-thinking-xhigh**，禁止静默降级。

## 期望

- 默认预期：诚实空枚举。空枚举轴外号只进本 PLAN「禁止再编号」+ 首段 unnamed plan-ban，**不**进 EXCLUSIONS 表。
- 若有候选：理论 + 确定性 sim + 真尺度非噪声（offline-logit ±35 ms；µs/ns 与 once-per-run CLI 噪声拒收）。输家脚本只进报告附录，不提交仓库。
- 平台硬顶 3 并发云 VM；本波保持 R32-C + R32-E + R32-F。
- Round 31 已 10/10 收口。Round 32 在 J 返回并合入后 10/10 收口，再开 Round 33。
