# Round 39 作战计划

**目标**：在 R38 十切片诚实空枚举关闭（无 S38-A-* … S38-J-*；R38-A 三项换名检查拒列；R38-G digest 第二十九次相同，未铸造 digest 轴号；R38-B / R38-C / R38-D / R38-E / R38-F / R38-H / R38-I / R38-J 零新站点级换名记录）以及 **FITQ / NAMESHAPE / SCALEX / XPROC / YMIX / SCHEDWIN / KFAN / NVG / SEEDX / TERMCLASS / SHAPEK / ORDX / CKMIX / CALLB / OCCX / JB / RUNLIM / VALCLASS / CG / AGEX / COTARG / PRICEX / RTL / DELINV / PROBX / RVL / SIDEC / PWL / ZREP / PAIRX / CSPELL / REPRX / LINKTOP / BINDX / MODEX** 具名 ban 的前提下，对十切片做**第三十九遍**独立枚举。R38 已 10/10 关闭。本轮状态：**A–G/I 已合入；H/J 运行中**。

**约束**：

- R8–R38 已合入切片全部诚实空枚举。无新 S38-A-* … S38-J-*。R39-A / R39-B / R39-C / R39-D / R39-E / R39-F / R39-G / R39-I 亦诚实空枚举关闭（无 S39-A-* / S39-B-* / S39-C-* / S39-D-* / S39-E-* / S39-F-* / S39-G-* / S39-I-*）。
- 生产基线未变：最后 `src/` 提交仍为 `183df9b`（S7-C）。
- 禁止再编号：FITQ、NAMESHAPE、SCALEX、XPROC、YMIX、SCHEDWIN、KFAN、NVG、SEEDX、TERMCLASS、SHAPEK、ORDX、CKMIX、CALLB、OCCX、JB、RUNLIM、VALCLASS、CG、AGEX、COTARG、PRICEX、RTL、DELINV、PROBX、RVL、SIDEC、PWL、ZREP、PAIRX、CSPELL、REPRX、LINKTOP、BINDX、MODEX（空枚举轴外号，**不是** EXCLUSIONS 表行）。
- R21–R38 具名 / unnamed 面与上列停驻 / 分解 / 审计记录亦 plan-ban，**不**写入 EXCLUSIONS 表行。R32-A 重开条件哨兵审计（F12a–d）与 R32-B 闭合稳定性审计（54/54 裁决仍立；五扇残门 D1–D5 按归属关闭）按方法 / 停驻记录，**不**铸造新面、**不**写入 EXCLUSIONS 表行。R33-A 把 R32-B 三腿方法应用到 A 区 44 行账本（44/44 仍立）亦为方法卫生，**禁止**再铸「再查一遍闭合稳定性」式新面。**禁止**把「再查一遍重开条件 / 闭合稳定性 / 门扉」铸成新面。R39-G digest `06cbcf92c098c8f0` 第三十次相同 — 若后再同，记**第三十一次**相同，**禁止**再铸 digest 轴号。
- 落地条件、硬不变量、sim 家族与 [PROGRESS.md](../PROGRESS.md) / [EXCLUSIONS.md](../EXCLUSIONS.md) / [round-38/PLAN.md](../round-38/PLAN.md) 一致。

## 切片（与 R1–R38 相同）

| 切片 | 范围 | 状态 |
| --- | --- | --- |
| A | `src/tracking/` + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14） | 已合入（空枚举；未铸造新面；13.6–16.0 µs/gate ⇒ ~68–80 µs/run） |
| B | 在线路由 9 + `src/supervisor/model-router.ts`（10） | 已合入（空枚举；未铸造新面；ceiling M=2 8.31–9.77 / M=10 16.99–17.36；replay M=2 9.63–10.00） |
| C | 离线路由 9 | 已合入（空枚举；未铸造新面；中位 665.9–693.4；组合天花板 19.0–30.1 < 35；sink=7.309） |
| D | `src/adaptation/`（14） | 已合入（空枚举；未铸造新面；S0c 3.46–3.50 ms） |
| E | `src/learning/`（10） | 已合入（空枚举；未铸造新面；SLICE-CPU 15.0；默认带沿用 14.7–15.2） |
| F | `src/experiments/`（15） | 已合入（空枚举；未铸造新面；r5f 128.29/126.03/123.63、r6f 121.06/121.21/131.89、r7f 130.95/126.05/130.38） |
| G | `src/run/`（除 A 两文件）+ `src/supervisor/`（除 model-router）+ `src/graph/` + `src/domain/`（42） | 已合入（空枚举；未铸造新面；compute 0.283–0.302 vs I/O 80.8–99.0；digest 第三十次相同） |
| H | evaluation 8 + requirement 7 + review 4 + rubric 2（21） | 运行中 |
| I | cli 13 + pi-adapter 9 + config 2 + telemetry 1（25） | 已合入（空枚举；未铸造新面；custom−builtin children +22.8~+24.1 / +41.9~+45.2、track +24.9~+29.2 / +47.8~+54.9、flowchart +12.6~+24.2 / +40.5~+43.9） |
| J | cluster 3 + privacy 3 + preferences 7 + episode 5 + persist 2 + track 4 + context 2 + feedback 3（29） | 运行中 |

默认对照取最近已合入轮：A = R39-A（13.6–16.0 µs/gate ⇒ ~68–80 µs/run）；B = R39-B（ceiling M=2 8.31–9.77 / M=10 16.99–17.36；replay M=2 9.63–10.00）；C = R39-C（中位 665.9–693.4；组合天花板 19.0–30.1 < 35；sink=7.309；中段宿主，freeze 0 行）；D = R39-D（S0c 3.46–3.50 ms）；E = R39-E（SLICE-CPU 15.0；默认带沿用 14.7–15.2；freeze 0 行）；F = R39-F（r5f 128.29/126.03/123.63、r6f 121.06/121.21/131.89、r7f 130.95/126.05/130.38；混合散射宿主窗，freeze 0 行）；G = R39-G（compute 0.283–0.302 vs I/O 80.8–99.0；digest 第三十次相同，**禁止**再铸 digest 轴号）；H = R38-H（默认链 9316/8866/8926 ns；宿主中窗，freeze 0 行）；I = R39-I（custom−builtin children +22.8~+24.1 / +41.9~+45.2、track +24.9~+29.2 / +47.8~+54.9、flowchart +12.6~+24.2 / +40.5~+43.9；freeze 0 行）；J = R38-J（preferences 124.4–255.4 / 400.8–519.0；jsonl 60.6–66.9 / fsync=true 230.0–334.9；J1 2468 / 2951.7×；freeze 0 行）。S12-B-2 条件陆器仍未触发。S8-I-1 两侧 file-level 封死。S13-B-1 仍为 loser ID。S7-F-1 ≠ S6-F-5。S5-H-1 保持。catalog 行序契约决策承载（R28-B W3）。npm POSIX `.bin` symlink 静默 no-op（R28-I）**禁止**当优化修。

## 第三十九遍焦点

**A — 已合入（空枚举；未铸造新面）**：[R39-A.md](./R39-A.md)。14 文件；基线 `7acb666`。14 文件相对 `7acb666` 三验 0 行；`wc -l` 1796。预算重锚 13.6–16.0 µs/gate ⇒ ~68–80 µs/run。三项新站点级换名检查拒列。哨兵卫生复跑无一触发。**禁止**再编号为新 A 轴；**禁止**把「再查一遍重开条件 / 闭合稳定性」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**B — 已合入（空枚举；未铸造新面）**：[R39-B.md](./R39-B.md)。10 文件；基线 `94ed3d9`。10 文件相对 `94ed3d9` 四验 0 行；`wc -l` 1359。预算重锚 ceiling M=2 8.31–9.77 / M=10 16.99–17.36；replay M=2 9.63–10.00。**零**新站点级换名记录。S12-B-2 仍未触发；S13-B-1 仍为 loser ID；catalog 行序未触。**禁止**再编号为新 B 轴；**禁止**写入 EXCLUSIONS 表行。

**C — 已合入（空枚举；未铸造新面）**：[R39-C.md](./R39-C.md)。9 文件；基线 `183df9b`。9 文件相对 `183df9b` 五验 0 行；`wc -l` 2039。预算重锚中位 665.9–693.4（含 R38-C 683.6–688.2，落 ±35 带内）；组合天花板 19.0–30.1 < 35；sink=7.309 十二读全同。**零**新站点级换名记录。**禁止**再编号为新 C 轴；**禁止**写入 EXCLUSIONS 表行。

**D — 已合入（空枚举；未铸造新面）**：[R39-D.md](./R39-D.md)。14 文件；基线 `82bef36`。14 文件相对 `82bef36` 四验 0 行；`wc -l` 3294。预算重锚 S0c 3.46–3.50 ms（落 R38-D 3.47–3.79 与 R37-D 3.40–3.80 带内）。**零**新站点级换名记录。S9-D-4 / S12-D-1 仍关闭。**禁止**再编号为新 D 轴；**禁止**写入 EXCLUSIONS 表行。

**E — 已合入（空枚举；未铸造新面）**：[R39-E.md](./R39-E.md)。10 文件；基线 `adb20d7`。10 文件相对 `adb20d7` 五验 0 行；`wc -l` 1770。预算重锚 SLICE-CPU 15.0（默认带沿用 14.7–15.2）。**零**新站点级换名记录。S8-E-1 仍恰 3 处。**禁止**再编号为新 E 轴；**禁止**写入 EXCLUSIONS 表行。

**F — 已合入（空枚举；未铸造新面）**：[R39-F.md](./R39-F.md)。15 文件；基线 `519101f`。15 文件相对 `519101f` 四验 0 行；`wc -l` 2550。预算重锚 r5f 128.29/126.03/123.63、r6f 121.06/121.21/131.89、r7f 130.95/126.05/130.38（混合散射宿主窗，历史包络内）。**零**新站点级换名记录。S7-F-1 ≠ S6-F-5。BINDX 10 token / 8 行维持。**禁止**再编号为新 F 轴；**禁止**写入 EXCLUSIONS 表行。

**G — 已合入（空枚举；未铸造新面）**：[R39-G.md](./R39-G.md)。42 文件；基线 `4efee23`。42 文件相对 `4efee23` 五验 0 行；`wc -l` 8960。预算重锚 compute 0.283–0.302 vs I/O 80.8–99.0。digest `06cbcf92c098c8f0` **第三十次**相同，**禁止**再铸 digest 轴号。**零**新站点级换名记录。**禁止**再编号为新 G 轴；**禁止**写入 EXCLUSIONS 表行。

**H — 运行中**：21 文件（evaluation 8：evaluator / precedence / delivery-adapter / check-adapter / adapters / diff-adapter / types / ownership；requirement 7：coverage / critic / extractor / heuristic / precedence / provenance / normalizer；review 4：pairwise / self-review / reconcile / critic；rubric 2：registry / types）。基线 `fd437a9`。预期冻结空；`wc -l` R38-H 记 1750。S5-H-1 保持。默认对照 R38-H（默认链 9316/8866/8926 ns）。非再移植：provenance-resolution pathway、R31-H 四扇边界参数残门、R38-H 零新站点级记录、R37-H 零新站点级记录、R36-H 零新站点级记录、R33-A … R38-J 空枚举、R39-A 空枚举、R39-B 空枚举、R39-D 空枚举、R39-C 空枚举、R39-F 空枚举、R39-E 空枚举、R39-G 空枚举、R39-I 空枚举。若落地：gate + 既有 H harness。报告 `docs/reports/sota-opt/round-39/R39-H.md`。禁止开 PR。

**I — 已合入（空枚举；未铸造新面）**：[R39-I.md](./R39-I.md)。25 文件；基线 `8dee7fb`。25 文件相对 `8dee7fb` 四验 0 行；`wc -l` 4708。预算重锚 custom−builtin children +22.8~+24.1 / +41.9~+45.2、track +24.9~+29.2 / +47.8~+54.9、flowchart +12.6~+24.2 / +40.5~+43.9（与世系带相交）。**零**新站点级换名记录。S8-I-1 两侧 file-level 封死。**禁止**再编号为新 I 轴；**禁止**写入 EXCLUSIONS 表行。

**J — 运行中**：29 文件；基线 `fb41417`。J1 锁定（2468 项逐位，2951.7× 宿主偏移）。默认对照 R38-J（preferences 124.4–255.4 / 400.8–519.0；jsonl 60.6–66.9 / fsync=true 230.0–334.9）。非再移植：**LINKTOP**、**CSPELL**、**ZREP**、**SIDEC**、**BINDX**、**MODEX**、R32-J 六个从未受控残余坐标、R34-J 四项换名检查、R38-J 零新站点级记录（`deleteObservation`=DELINV；`loadFromDisk` hydration=R22-J/R23-J/R26-J + once-per-run；`loop.ts` 双投影=R2-J/S4-J-4 族）、R37-J 零新站点级记录、R36-J 零新站点级记录、R33-A … R38-J 空枚举、R39-A 空枚举、R39-B 空枚举、R39-D 空枚举、R39-C 空枚举、R39-F 空枚举、R39-E 空枚举、R39-G 空枚举、R39-I 空枚举。若落地：gate + J1 仿真（2468）+ 既有 J harness。报告 `docs/reports/sota-opt/round-39/R39-J.md`。禁止开 PR。

A–J 均要求返回首行 `MODEL_SLUG=claude-fable-5-thinking-xhigh`，末两行 `MORE_OPTIMA=yes|no` 与 `BRANCH=...`。模型必须是 **claude-fable-5-thinking-xhigh**，禁止静默降级。

## 期望

- 默认预期：诚实空枚举。空枚举轴外号只进本 PLAN「禁止再编号」+ 首段 unnamed plan-ban，**不**进 EXCLUSIONS 表。
- 若有候选：理论 + 确定性 sim + 真尺度非噪声（offline-logit ±35 ms；µs/ns 与 once-per-run CLI 噪声拒收）。输家脚本只进报告附录，不提交仓库。
- 平台硬顶 3 并发云 VM；本波保持 R39-H + R39-J。无未派切片。
- Round 38 已 10/10 收口。Round 39 在 J 返回并合入后 10/10 收口，再开 Round 40。
