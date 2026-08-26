# Round 34 作战计划

**目标**：在 R33 十切片诚实空枚举关闭（无 S33-A-* … S33-J-*；R33-A A 账本 44/44 闭合稳定性卫生按方法记录，未铸造新面；R33-G digest 第二十四次相同，未铸造 digest 轴号；R33-J 五个换名检查拒列、六个从未受控残余坐标未过三合取）以及 **FITQ / NAMESHAPE / SCALEX / XPROC / YMIX / SCHEDWIN / KFAN / NVG / SEEDX / TERMCLASS / SHAPEK / ORDX / CKMIX / CALLB / OCCX / JB / RUNLIM / VALCLASS / CG / AGEX / COTARG / PRICEX / RTL / DELINV / PROBX / RVL / SIDEC / PWL / ZREP / PAIRX / CSPELL / REPRX / LINKTOP / BINDX / MODEX** 具名 ban 的前提下，对十切片做**第三十四遍**独立枚举。R33 已 10/10 关闭。本轮状态：**A–D 已合入；E/F/G 本波派出；H–J 待派**。

**约束**：

- R8–R33 已合入切片全部诚实空枚举。无新 S33-A-* … S33-J-*。R34-A … R34-D 亦诚实空枚举关闭（无 S34-A-* … S34-D-*）。
- 生产基线未变：最后 `src/` 提交仍为 `183df9b`（S7-C）。
- 禁止再编号：FITQ、NAMESHAPE、SCALEX、XPROC、YMIX、SCHEDWIN、KFAN、NVG、SEEDX、TERMCLASS、SHAPEK、ORDX、CKMIX、CALLB、OCCX、JB、RUNLIM、VALCLASS、CG、AGEX、COTARG、PRICEX、RTL、DELINV、PROBX、RVL、SIDEC、PWL、ZREP、PAIRX、CSPELL、REPRX、LINKTOP、BINDX、MODEX（空枚举轴外号，**不是** EXCLUSIONS 表行）。
- R21–R33 具名 / unnamed 面与上列停驻 / 分解 / 审计记录亦 plan-ban，**不**写入 EXCLUSIONS 表行。R32-A 重开条件哨兵审计（F12a–d）与 R32-B 闭合稳定性审计（54/54 裁决仍立；五扇残门 D1–D5 按归属关闭）按方法 / 停驻记录，**不**铸造新面、**不**写入 EXCLUSIONS 表行。R33-A 把 R32-B 三腿方法应用到 A 区 44 行账本（44/44 仍立）亦为方法卫生，**禁止**再铸「再查一遍闭合稳定性」式新面。**禁止**把「再查一遍重开条件 / 闭合稳定性 / 门扉」铸成新面。
- 落地条件、硬不变量、sim 家族与 [PROGRESS.md](../PROGRESS.md) / [EXCLUSIONS.md](../EXCLUSIONS.md) / [round-33/PLAN.md](../round-33/PLAN.md) 一致。

## 切片（与 R1–R33 相同）

| 切片 | 范围 | 状态 |
| --- | --- | --- |
| A | `src/tracking/` + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14） | 已合入（空枚举；未铸造新面；12.8–15.2 µs/gate ⇒ ~64–76 µs/run） |
| B | 在线路由 9 + `src/supervisor/model-router.ts`（10） | 已合入（空枚举；未铸造新面；M=2 8.5–9.5 / M=10 17–19；主机偏快） |
| C | 离线路由 9 | 已合入（空枚举；未铸造新面；中位 682.1–682.5；组合天花板 28.7–31.6 < 35；sink=7.309） |
| D | `src/adaptation/`（14） | 已合入（空枚举；未铸造新面；S0c 3.65–4.70；主机偏高） |
| E | `src/learning/`（10） | 本波派出 |
| F | `src/experiments/`（15） | 本波派出 |
| G | `src/run/`（除 A 两文件）+ `src/supervisor/`（除 model-router）+ `src/graph/` + `src/domain/`（42） | 本波派出 |
| H | evaluation 8 + requirement 7 + review 4 + rubric 2（21） | 待派 |
| I | cli 13 + pi-adapter 9 + config 2 + telemetry 1（25） | 待派 |
| J | cluster 3 + privacy 3 + preferences 7 + episode 5 + persist 2 + track 4 + context 2 + feedback 3（29） | 待派 |

默认对照取最近已合入轮：A = R34-A（12.8–15.2 µs/gate ⇒ ~64–76 µs/run）；B = R34-B（M=2 8.5–9.5 / M=10 17–19；主机偏快，freeze 0 行）；C = R34-C（中位 682.1–682.5；组合天花板 28.7–31.6 < 35；sink=7.309）；D = R34-D（S0c 3.65–4.70 ms；主机偏高，freeze 0 行）；E = R33-E（SLICE-CPU cmp25 15.1–15.3）；F = R33-F（r5f 124.47/118.96/129.73、r6f 122.96/122.14/121.70、r7f 127.78/127.36/127.07）；G = R33-G（compute 0.302–0.309 vs I/O 90.4–104.4；digest 第二十四次相同，**禁止**再铸 digest 轴号）；H = R33-H（默认链 8991/8820/8843 ns）；I = R33-I（custom−builtin children +42.0~+45.9 / +22.8~+25.8、track +48.2~+52.8 / +23.6~+24.3、flowchart-flat64 +39.4~+46.8 / +16.8~+19.9）；J = R33-J（preferences 134.8–237.4 / 408.0–541.2；jsonl 59.2–66.8 / 204.4–350.2 µs）。S12-B-2 条件陆器仍未触发。S8-I-1 两侧 file-level 封死。S13-B-1 仍为 loser ID。S7-F-1 ≠ S6-F-5。S5-H-1 保持。catalog 行序契约决策承载（R28-B W3）。npm POSIX `.bin` symlink 静默 no-op（R28-I）**禁止**当优化修。

## 第三十四遍焦点

**A — 已合入（空枚举；未铸造新面）**：[R34-A.md](./R34-A.md)。14 文件；基线 `7acb666`。14 文件相对 `7acb666` 三验 0 行；`wc -l` 1796。三项换名检查拒收不铸 ID。预算重锚 12.8–15.2 µs/gate ⇒ ~64–76 µs/run（落 R33-A 对照带）。哨兵卫生复跑无一触发。**禁止**再编号为新 A 轴；**禁止**把「再查一遍重开条件 / 闭合稳定性」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**B — 已合入（空枚举；未铸造新面）**：[R34-B.md](./R34-B.md)。10 文件；基线 `94ed3d9`。10 文件相对 `94ed3d9` 冻结 0 行；`wc -l` 1359。预算重锚 M=2 8.5–9.5 / M=10 17–19（本 VM 快于 R33-B 10.75–11.73 / 21.48–23.74；主机偏快，freeze 0 行）。S12-B-2 仍未触发；S13-B-1 仍为 loser ID；catalog 行序未触。残余微角换名拒列，零新 ID / 零新面 / 零 EXCLUSIONS 行。**禁止**再编号为新 B 轴；**禁止**写入 EXCLUSIONS 表行。

**C — 已合入（空枚举；未铸造新面）**：[R34-C.md](./R34-C.md)。9 文件；基线 `183df9b`。9 文件相对 `183df9b` 冻结 0 行；`wc -l` 2039。预算重锚中位 682.1–682.5（落 R33-C 670.2–708.7）；组合天花板 28.7–31.6 < 35；sink=7.309 八读全同。一项换名检查拒列（`isFabricatedPositiveSupport` `notOneHot` 吸收析取）。**禁止**再编号为新 C 轴；**禁止**写入 EXCLUSIONS 表行。

**D — 已合入（空枚举；未铸造新面）**：[R34-D.md](./R34-D.md)。14 文件；基线 `82bef36`。14 文件相对 `82bef36` 冻结 0 行；`wc -l` 3294。预算重锚 S0c 3.65–4.70 ms（本 VM 高侧主机偏置 +7~+28% vs R33-D 3.42–3.67；freeze 0 行）。三项换名检查拒列。S9-D-4 / S12-D-1 仍关闭。**禁止**再编号为新 D 轴；**禁止**写入 EXCLUSIONS 表行。

**E — 本波派出**：10 文件（auto-loop / learned-routing / from-episode / signals / signatures / bandit-store / task-success / attribution / diagnostics / patterns）。基线 `adb20d7`。预期冻结空；`wc -l` R33-E 记 1770。默认对照 R33-E（SLICE-CPU cmp25 15.1–15.3）。S8-E-1 禁止去重 `loadLearnedRouting`（恰 3 处生产调用：`cli/main.ts:708`、`run/flowchart-run.ts:712`、`track/loop.ts:88`）。S9-E-2 是负优化。非再移植：PWL、RVL、RTL、CG、JB、NVG、REPRX、**BINDX**、I/O text-codec topology、R32-A 重开条件哨兵、R32-B 闭合稳定性、R33-A … R33-J 空枚举、R34-A 空枚举、R34-B 空枚举、R34-C 空枚举、R34-D 空枚举。若落地：gate + 既有 E harness。报告 `docs/reports/sota-opt/round-34/R34-E.md`。禁止开 PR。

**F — 本波派出**：15 文件（canary / plan / shadow / gated-comparison / replay / comparison-report / threshold-calibration / shadow-compare / isolation / simulation-holdout / holdout / manifest / evaluation-card / dataset / attribution-report）。基线 `519101f`。预期冻结空；`wc -l` R33-F 记 2550。默认对照 R33-F（r5f 124.47/118.96/129.73、r6f 122.96/122.14/121.70、r7f 127.78/127.36/127.07）。S7-F-1 ≠ S6-F-5。非再移植：PAIRX、**BINDX**、R31-F 故障通道处置分解、R33-A … R33-J 空枚举、R34-A 空枚举、R34-B 空枚举、R34-C 空枚举、R34-D 空枚举。若落地：gate + r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）。报告 `docs/reports/sota-opt/round-34/R34-F.md`。禁止开 PR。

**G — 本波派出**：42 文件（`src/run/` 除 child-tracking / gate-apply；`src/supervisor/` 除 model-router；`src/graph/`；`src/domain/`）。基线 `4efee23`。预期冻结空。默认对照 R33-G（compute 0.302–0.309 vs I/O 90.4–104.4；digest `06cbcf92c098c8f0` 第二十四次相同，若再得同一 digest 记第二十五次相同，**禁止**再铸 digest 轴号）。非再移植：R31-G 18 门闭合审计、R33-A … R33-J 空枚举、R34-A 空枚举、R34-B 空枚举、R34-C 空枚举、R34-D 空枚举。若落地：gate + 既有 G harness。报告 `docs/reports/sota-opt/round-34/R34-G.md`。禁止开 PR。

**H — 待派**：21 文件（evaluation **8** 不是 9）；基线 `fd437a9`。S5-H-1 保持。默认对照 R33-H（默认链 8991/8820/8843 ns）。非再移植：provenance-resolution pathway、R31-H 四扇边界参数残门、R33-A … R33-J 空枚举、R34-A 空枚举、R34-B 空枚举、R34-C 空枚举、R34-D 空枚举。若落地：gate + 既有 H harness。报告 `docs/reports/sota-opt/round-34/R34-H.md`。禁止开 PR。

**I — 待派**：25 文件；基线 `8dee7fb`。S8-I-1 两侧 file-level 封死。**禁止**把 npm POSIX `.bin` symlink 静默 no-op 当优化修。默认对照 R33-I（custom−builtin children +42.0~+45.9 / +22.8~+25.8、track +48.2~+52.8 / +23.6~+24.3、flowchart-flat64 +39.4~+46.8 / +16.8~+19.9）。非再移植：process-lifetime temporal-segment topology、R31-I CLI 进程边界门扉闭合审计、R33-A … R33-J 空枚举、R34-A 空枚举、R34-B 空枚举、R34-C 空枚举、R34-D 空枚举。若落地：gate + r4i/r5i/r7i（68/119/80）。报告 `docs/reports/sota-opt/round-34/R34-I.md`。禁止开 PR。

**J — 待派**：29 文件；基线 `fb41417`。J1 锁定（2468 项逐位）。默认对照 R33-J（preferences 134.8–237.4 / 408.0–541.2；jsonl 59.2–66.8 / 204.4–350.2 µs）。非再移植：**LINKTOP**、**CSPELL**、**ZREP**、**SIDEC**、**BINDX**、**MODEX**、R32-J 六个从未受控残余坐标、R33-A … R33-J 空枚举、R34-A 空枚举、R34-B 空枚举、R34-C 空枚举、R34-D 空枚举。若落地：gate + J1 仿真（2468）+ 既有 J harness。报告 `docs/reports/sota-opt/round-34/R34-J.md`。禁止开 PR。

A–J 均要求返回首行 `MODEL_SLUG=claude-fable-5-thinking-xhigh`，末两行 `MORE_OPTIMA=yes|no` 与 `BRANCH=...`。模型必须是 **claude-fable-5-thinking-xhigh**，禁止静默降级。

## 期望

- 默认预期：诚实空枚举。空枚举轴外号只进本 PLAN「禁止再编号」+ 首段 unnamed plan-ban，**不**进 EXCLUSIONS 表。
- 若有候选：理论 + 确定性 sim + 真尺度非噪声（offline-logit ±35 ms；µs/ns 与 once-per-run CLI 噪声拒收）。输家脚本只进报告附录，不提交仓库。
- 平台硬顶 3 并发云 VM；本波保持 R34-E + R34-F + R34-G。
- Round 33 已 10/10 收口。Round 34 在 J 返回并合入后 10/10 收口，再开 Round 35。
