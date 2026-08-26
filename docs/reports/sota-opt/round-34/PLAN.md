# Round 34 作战计划

**目标**：在 R33 十切片诚实空枚举关闭（无 S33-A-* … S33-J-*；R33-A A 账本 44/44 闭合稳定性卫生按方法记录，未铸造新面；R33-G digest 第二十四次相同，未铸造 digest 轴号；R33-J 五个换名检查拒列、六个从未受控残余坐标未过三合取）以及 **FITQ / NAMESHAPE / SCALEX / XPROC / YMIX / SCHEDWIN / KFAN / NVG / SEEDX / TERMCLASS / SHAPEK / ORDX / CKMIX / CALLB / OCCX / JB / RUNLIM / VALCLASS / CG / AGEX / COTARG / PRICEX / RTL / DELINV / PROBX / RVL / SIDEC / PWL / ZREP / PAIRX / CSPELL / REPRX / LINKTOP / BINDX / MODEX** 具名 ban 的前提下，对十切片做**第三十四遍**独立枚举。R33 已 10/10 关闭。本轮状态：**A 已合入；B/C 运行中；D 本波派出；E–J 待派**。

**约束**：

- R8–R33 已合入切片全部诚实空枚举。无新 S33-A-* … S33-J-*。R34-A 亦诚实空枚举关闭（无 S34-A-*）。
- 生产基线未变：最后 `src/` 提交仍为 `183df9b`（S7-C）。
- 禁止再编号：FITQ、NAMESHAPE、SCALEX、XPROC、YMIX、SCHEDWIN、KFAN、NVG、SEEDX、TERMCLASS、SHAPEK、ORDX、CKMIX、CALLB、OCCX、JB、RUNLIM、VALCLASS、CG、AGEX、COTARG、PRICEX、RTL、DELINV、PROBX、RVL、SIDEC、PWL、ZREP、PAIRX、CSPELL、REPRX、LINKTOP、BINDX、MODEX（空枚举轴外号，**不是** EXCLUSIONS 表行）。
- R21–R33 具名 / unnamed 面与上列停驻 / 分解 / 审计记录亦 plan-ban，**不**写入 EXCLUSIONS 表行。R32-A 重开条件哨兵审计（F12a–d）与 R32-B 闭合稳定性审计（54/54 裁决仍立；五扇残门 D1–D5 按归属关闭）按方法 / 停驻记录，**不**铸造新面、**不**写入 EXCLUSIONS 表行。R33-A 把 R32-B 三腿方法应用到 A 区 44 行账本（44/44 仍立）亦为方法卫生，**禁止**再铸「再查一遍闭合稳定性」式新面。**禁止**把「再查一遍重开条件 / 闭合稳定性 / 门扉」铸成新面。
- 落地条件、硬不变量、sim 家族与 [PROGRESS.md](../PROGRESS.md) / [EXCLUSIONS.md](../EXCLUSIONS.md) / [round-33/PLAN.md](../round-33/PLAN.md) 一致。

## 切片（与 R1–R33 相同）

| 切片 | 范围 | 状态 |
| --- | --- | --- |
| A | `src/tracking/` + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14） | 已合入（空枚举；未铸造新面；12.8–15.2 µs/gate ⇒ ~64–76 µs/run） |
| B | 在线路由 9 + `src/supervisor/model-router.ts`（10） | 运行中 |
| C | 离线路由 9 | 运行中 |
| D | `src/adaptation/`（14） | 本波派出 |
| E | `src/learning/`（10） | 待派 |
| F | `src/experiments/`（15） | 待派 |
| G | `src/run/`（除 A 两文件）+ `src/supervisor/`（除 model-router）+ `src/graph/` + `src/domain/`（42） | 待派 |
| H | evaluation 8 + requirement 7 + review 4 + rubric 2（21） | 待派 |
| I | cli 13 + pi-adapter 9 + config 2 + telemetry 1（25） | 待派 |
| J | cluster 3 + privacy 3 + preferences 7 + episode 5 + persist 2 + track 4 + context 2 + feedback 3（29） | 待派 |

默认对照取最近已合入轮：A = R34-A（12.8–15.2 µs/gate ⇒ ~64–76 µs/run）；B = R33-B（M=2 10.75–11.73 / M=10 21.48–23.74；主机偏置，freeze 0 行）；C = R33-C（中位 670.2–708.7；组合天花板 25.7–31.7 < 35；sink=7.309）；D = R33-D（S0c 3.42–3.67 ms）；E = R33-E（SLICE-CPU cmp25 15.1–15.3）；F = R33-F（r5f 124.47/118.96/129.73、r6f 122.96/122.14/121.70、r7f 127.78/127.36/127.07）；G = R33-G（compute 0.302–0.309 vs I/O 90.4–104.4；digest 第二十四次相同，**禁止**再铸 digest 轴号）；H = R33-H（默认链 8991/8820/8843 ns）；I = R33-I（custom−builtin children +42.0~+45.9 / +22.8~+25.8、track +48.2~+52.8 / +23.6~+24.3、flowchart-flat64 +39.4~+46.8 / +16.8~+19.9）；J = R33-J（preferences 134.8–237.4 / 408.0–541.2；jsonl 59.2–66.8 / 204.4–350.2 µs）。S12-B-2 条件陆器仍未触发。S8-I-1 两侧 file-level 封死。S13-B-1 仍为 loser ID。S7-F-1 ≠ S6-F-5。S5-H-1 保持。catalog 行序契约决策承载（R28-B W3）。npm POSIX `.bin` symlink 静默 no-op（R28-I）**禁止**当优化修。

## 第三十四遍焦点

**A — 已合入（空枚举；未铸造新面）**：[R34-A.md](./R34-A.md)。14 文件；基线 `7acb666`。14 文件相对 `7acb666` 三验 0 行；`wc -l` 1796。三项换名检查拒收不铸 ID。预算重锚 12.8–15.2 µs/gate ⇒ ~64–76 µs/run（落 R33-A 对照带）。哨兵卫生复跑无一触发。**禁止**再编号为新 A 轴；**禁止**把「再查一遍重开条件 / 闭合稳定性」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**B — 运行中**：10 文件（在线路由 9：r0 / assign / assign-plan / policy / live-cascade / live-selection / analyze-task / primary-catalog / catalog-model；+ `src/supervisor/model-router.ts`）。**不要**纳入 `catalog-observed.ts`。基线 `94ed3d9`。预期冻结空；`wc -l` R33-B 记 1359。默认对照 R33-B（M=2 10.75–11.73 / M=10 21.48–23.74；主机偏置）。非再移植：R31-B 面格六门停驻、R32-B 闭合稳定性审计、R33-A 空枚举、R33-B 空枚举（`ROLE_FAMILY` 死回退已拒列）、R33-C … R33-J 空枚举、R34-A 空枚举。S12-B-2 条件陆器仍未触发。S13-B-1 仍为 loser ID。catalog 行序契约决策承载（R28-B W3）。若落地：gate + 既有 B harness。报告 `docs/reports/sota-opt/round-34/R34-B.md`。禁止开 PR。

**C — 运行中**：9 文件（r1 / r1-shadow-report / posterior / offline-logit / offline-prob-add / propensity / lin-alg / bandit / shadow）。基线 `183df9b`。预期冻结空；`wc -l` R33-C 记 2039。默认对照 R33-C（中位 670.2–708.7；组合天花板 25.7–31.7 < 35；sink=7.309）。非再移植：**BINDX**、**PAIRX**、**REPRX**、R33-A … R33-J 空枚举、R34-A 空枚举。双 LCB 与双归因必须都留。若落地：gate + r1c–r7c（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。报告 `docs/reports/sota-opt/round-34/R34-C.md`。禁止开 PR。

**D — 本波派出**：14 文件（promotion-rules / registry / eval-routing / promotion / active-pointer / monitor / retirement / approval-profile / resource / mutate / reflection / rollback / candidate / pareto）。基线 `82bef36`。预期冻结空；`wc -l` R33-D 记 3294。默认对照 R33-D（S0c 3.42–3.67 ms）。S9-D-4 / S12-D-1 永不再开。非再移植：R33-A … R33-J 空枚举、R34-A 空枚举。若落地：gate + 既有 D harness。报告 `docs/reports/sota-opt/round-34/R34-D.md`。禁止开 PR。

**E — 待派**：10 文件；基线 `adb20d7`。默认对照 R33-E（SLICE-CPU cmp25 15.1–15.3）。S8-E-1 禁止去重 `loadLearnedRouting`（恰 3 处生产调用）。非再移植：PWL、RVL、RTL、CG、JB、NVG、REPRX、**BINDX**、I/O text-codec topology、R33-A … R33-J 空枚举。若落地：gate + 既有 E harness。报告 `docs/reports/sota-opt/round-34/R34-E.md`。禁止开 PR。

**F — 待派**：15 文件；基线 `519101f`。默认对照 R33-F（r5f 124.47/118.96/129.73、r6f 122.96/122.14/121.70、r7f 127.78/127.36/127.07）。S7-F-1 ≠ S6-F-5。非再移植：PAIRX、**BINDX**、R31-F 故障通道处置分解、R33-A … R33-J 空枚举。若落地：gate + r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）。报告 `docs/reports/sota-opt/round-34/R34-F.md`。禁止开 PR。

**G — 待派**：42 文件；基线 `4efee23`。默认对照 R33-G（compute 0.302–0.309 vs I/O 90.4–104.4；digest `06cbcf92c098c8f0` 第二十四次相同，**禁止**再铸 digest 轴号）。非再移植：R31-G 18 门闭合审计、R33-A … R33-J 空枚举。若落地：gate + 既有 G harness。报告 `docs/reports/sota-opt/round-34/R34-G.md`。禁止开 PR。

**H — 待派**：21 文件（evaluation **8** 不是 9）；基线 `fd437a9`。S5-H-1 保持。默认对照 R33-H（默认链 8991/8820/8843 ns）。非再移植：provenance-resolution pathway、R31-H 四扇边界参数残门、R33-A … R33-J 空枚举。若落地：gate + 既有 H harness。报告 `docs/reports/sota-opt/round-34/R34-H.md`。禁止开 PR。

**I — 待派**：25 文件；基线 `8dee7fb`。S8-I-1 两侧 file-level 封死。**禁止**把 npm POSIX `.bin` symlink 静默 no-op 当优化修。默认对照 R33-I（custom−builtin children +42.0~+45.9 / +22.8~+25.8、track +48.2~+52.8 / +23.6~+24.3、flowchart-flat64 +39.4~+46.8 / +16.8~+19.9）。非再移植：process-lifetime temporal-segment topology、R31-I CLI 进程边界门扉闭合审计、R33-A … R33-J 空枚举。若落地：gate + r4i/r5i/r7i（68/119/80）。报告 `docs/reports/sota-opt/round-34/R34-I.md`。禁止开 PR。

**J — 待派**：29 文件；基线 `fb41417`。J1 锁定（2468 项逐位）。默认对照 R33-J（preferences 134.8–237.4 / 408.0–541.2；jsonl 59.2–66.8 / 204.4–350.2 µs）。非再移植：**LINKTOP**、**CSPELL**、**ZREP**、**SIDEC**、**BINDX**、**MODEX**、R32-J 六个从未受控残余坐标、R33-A … R33-J 空枚举。若落地：gate + J1 仿真（2468）+ 既有 J harness。报告 `docs/reports/sota-opt/round-34/R34-J.md`。禁止开 PR。

A–J 均要求返回首行 `MODEL_SLUG=claude-fable-5-thinking-xhigh`，末两行 `MORE_OPTIMA=yes|no` 与 `BRANCH=...`。模型必须是 **claude-fable-5-thinking-xhigh**，禁止静默降级。

## 期望

- 默认预期：诚实空枚举。空枚举轴外号只进本 PLAN「禁止再编号」+ 首段 unnamed plan-ban，**不**进 EXCLUSIONS 表。
- 若有候选：理论 + 确定性 sim + 真尺度非噪声（offline-logit ±35 ms；µs/ns 与 once-per-run CLI 噪声拒收）。输家脚本只进报告附录，不提交仓库。
- 平台硬顶 3 并发云 VM；本波保持 R34-B + R34-C + R34-D。
- Round 33 已 10/10 收口。Round 34 在 J 返回并合入后 10/10 收口，再开 Round 35。
