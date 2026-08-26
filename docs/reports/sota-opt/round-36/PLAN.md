# Round 36 作战计划

**目标**：在 R35 十切片诚实空枚举关闭（无 S35-A-* … S35-J-*；R35-A 三项换名检查拒列，未铸造新面；R35-G digest 第二十六次相同，未铸造 digest 轴号；R35-J 零新站点级换名记录、六个从未受控残余坐标未过三合取）以及 **FITQ / NAMESHAPE / SCALEX / XPROC / YMIX / SCHEDWIN / KFAN / NVG / SEEDX / TERMCLASS / SHAPEK / ORDX / CKMIX / CALLB / OCCX / JB / RUNLIM / VALCLASS / CG / AGEX / COTARG / PRICEX / RTL / DELINV / PROBX / RVL / SIDEC / PWL / ZREP / PAIRX / CSPELL / REPRX / LINKTOP / BINDX / MODEX** 具名 ban 的前提下，对十切片做**第三十六遍**独立枚举。R35 已 10/10 关闭。本轮状态：**A–I 已合入；J 运行中**。

**约束**：

- R8–R35 已合入切片全部诚实空枚举。无新 S35-A-* … S35-J-*。R36-A / R36-B / R36-C / R36-D / R36-E / R36-F / R36-G / R36-H / R36-I 亦诚实空枚举关闭（无 S36-A-* / S36-B-* / S36-C-* / S36-D-* / S36-E-* / S36-F-* / S36-G-* / S36-H-* / S36-I-*）。
- 生产基线未变：最后 `src/` 提交仍为 `183df9b`（S7-C）。
- 禁止再编号：FITQ、NAMESHAPE、SCALEX、XPROC、YMIX、SCHEDWIN、KFAN、NVG、SEEDX、TERMCLASS、SHAPEK、ORDX、CKMIX、CALLB、OCCX、JB、RUNLIM、VALCLASS、CG、AGEX、COTARG、PRICEX、RTL、DELINV、PROBX、RVL、SIDEC、PWL、ZREP、PAIRX、CSPELL、REPRX、LINKTOP、BINDX、MODEX（空枚举轴外号，**不是** EXCLUSIONS 表行）。
- R21–R35 具名 / unnamed 面与上列停驻 / 分解 / 审计记录亦 plan-ban，**不**写入 EXCLUSIONS 表行。R32-A 重开条件哨兵审计（F12a–d）与 R32-B 闭合稳定性审计（54/54 裁决仍立；五扇残门 D1–D5 按归属关闭）按方法 / 停驻记录，**不**铸造新面、**不**写入 EXCLUSIONS 表行。R33-A 把 R32-B 三腿方法应用到 A 区 44 行账本（44/44 仍立）亦为方法卫生，**禁止**再铸「再查一遍闭合稳定性」式新面。**禁止**把「再查一遍重开条件 / 闭合稳定性 / 门扉」铸成新面。R36-G digest `06cbcf92c098c8f0` 第二十七次相同 — 若后再同，记**第二十八次**相同，**禁止**再铸 digest 轴号。
- 落地条件、硬不变量、sim 家族与 [PROGRESS.md](../PROGRESS.md) / [EXCLUSIONS.md](../EXCLUSIONS.md) / [round-35/PLAN.md](../round-35/PLAN.md) 一致。

## 切片（与 R1–R35 相同）

| 切片 | 范围 | 状态 |
| --- | --- | --- |
| A | `src/tracking/` + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14） | 已合入（空枚举；未铸造新面；13.8–17.6 µs/gate ⇒ ~69–88 µs/run） |
| B | 在线路由 9 + `src/supervisor/model-router.ts`（10） | 已合入（空枚举；未铸造新面；ceiling M=2 10.18–11.68 / M=10 18.10–19.18；replay M=2 8.38–8.53） |
| C | 离线路由 9 | 已合入（空枚举；未铸造新面；中位 667.9–681.0；组合天花板 20.9–34.1 < 35；sink=7.309） |
| D | `src/adaptation/`（14） | 已合入（空枚举；未铸造新面；S0c 3.48–3.83 ms） |
| E | `src/learning/`（10） | 已合入（空枚举；未铸造新面；SLICE-CPU cmp25 14.9–15.4；默认带沿用 14.7–15.2） |
| F | `src/experiments/`（15） | 已合入（空枚举；未铸造新面；r5f 123.76/119.45/118.82、r6f 120.24/122.96/118.50、r7f 128.74/125.52/128.33） |
| G | `src/run/`（除 A 两文件）+ `src/supervisor/`（除 model-router）+ `src/graph/` + `src/domain/`（42） | 已合入（空枚举；未铸造新面；compute 0.292–0.295 vs I/O 93.6–96.9；digest 第二十七次相同） |
| H | evaluation 8 + requirement 7 + review 4 + rubric 2（21） | 已合入（空枚举；未铸造新面；默认链 9781/9262/9139 ns；宿主暖窗，freeze 0 行） |
| I | cli 13 + pi-adapter 9 + config 2 + telemetry 1（25） | 已合入（空枚举；未铸造新面；custom−builtin children +25.1~+26.6 / +45.9~+47.0、track +23.2~+25.6 / +48.0~+51.4、flowchart +17.8~+22.6 / +42.1~+47.3） |
| J | cluster 3 + privacy 3 + preferences 7 + episode 5 + persist 2 + track 4 + context 2 + feedback 3（29） | 运行中 |

默认对照取最近已合入轮：A = R36-A（13.8–17.6 µs/gate ⇒ ~69–88 µs/run）；B = R36-B（ceiling M=2 10.18–11.68 / M=10 18.10–19.18；replay M=2 8.38–8.53）；C = R36-C（中位 667.9–681.0；组合天花板 20.9–34.1 < 35；sink=7.309）；D = R36-D（S0c 3.48–3.83 ms）；E = R36-E（SLICE-CPU cmp25 14.9–15.4；默认带沿用 14.7–15.2；宿主中偏高，freeze 0 行）；F = R36-F（r5f 123.76/119.45/118.82、r6f 120.24/122.96/118.50、r7f 128.74/125.52/128.33；中段主机，freeze 0 行）；G = R36-G（compute 0.292–0.295 vs I/O 93.6–96.9；digest 第二十七次相同，**禁止**再铸 digest 轴号）；H = R36-H（默认链 9781/9262/9139 ns；宿主暖窗，freeze 0 行）；I = R36-I（custom−builtin children +25.1~+26.6 / +45.9~+47.0、track +23.2~+25.6 / +48.0~+51.4、flowchart +17.8~+22.6 / +42.1~+47.3；主机偏快，freeze 0 行）；J = R35-J（preferences 146.3–253.7 / 438.7–509.9；jsonl 69.7–76.9 / pass-2 290.0–326.3；宿主窗，freeze 0 行）。S12-B-2 条件陆器仍未触发。S8-I-1 两侧 file-level 封死。S13-B-1 仍为 loser ID。S7-F-1 ≠ S6-F-5。S5-H-1 保持。catalog 行序契约决策承载（R28-B W3）。npm POSIX `.bin` symlink 静默 no-op（R28-I）**禁止**当优化修。

## 第三十六遍焦点

**A — 已合入（空枚举；未铸造新面）**：[R36-A.md](./R36-A.md)。14 文件；基线 `7acb666`。14 文件相对 `7acb666` 三验 0 行；`wc -l` 1796。三项新站点级换名检查拒收不铸 ID。预算重锚 13.8–17.6 µs/gate ⇒ ~69–88 µs/run（run 3 五格整体偏热宿主窗）。哨兵卫生复跑无一触发。**禁止**再编号为新 A 轴；**禁止**把「再查一遍重开条件 / 闭合稳定性」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**B — 已合入（空枚举；未铸造新面）**：[R36-B.md](./R36-B.md)。10 文件；基线 `94ed3d9`。10 文件相对 `94ed3d9` 冻结 0 行；`wc -l` 1359。预算重锚 ceiling M=2 10.18–11.68 / M=10 18.10–19.18；replay-faithful M=2 8.38–8.53。零新站点级换名记录。S12-B-2 仍未触发；S13-B-1 仍为 loser ID；catalog 行序未触。**禁止**再编号为新 B 轴；**禁止**写入 EXCLUSIONS 表行。

**C — 已合入（空枚举；未铸造新面）**：[R36-C.md](./R36-C.md)。9 文件；基线 `183df9b`。9 文件相对 `183df9b` 五验 0 行；`wc -l` 2039。预算重锚中位 667.9–681.0；组合天花板 20.9–34.1 < 35；sink=7.309 八读全同。一项换名检查拒列（`routeR1` cheapest-`reduce` 再算 `costOf`）。**禁止**再编号为新 C 轴；**禁止**写入 EXCLUSIONS 表行。

**D — 已合入（空枚举；未铸造新面）**：[R36-D.md](./R36-D.md)。14 文件；基线 `82bef36`。14 文件相对 `82bef36` 五验 0 行；`wc -l` 3294。预算重锚 S0c 3.48–3.83 ms（与 R35-D 3.54–3.93 交叠）。四项新站点级换名检查拒列。S9-D-4 / S12-D-1 仍关闭。**禁止**再编号为新 D 轴；**禁止**写入 EXCLUSIONS 表行。

**E — 已合入（空枚举；未铸造新面）**：[R36-E.md](./R36-E.md)。10 文件；基线 `adb20d7`。10 文件相对 `adb20d7` 三验 0 行；`wc -l` 1770。预算重锚 SLICE-CPU cmp25 14.9–15.4 µs/run（默认带沿用 14.7–15.2；run 6 高侧擦沿 0.2 为宿主项）。**零**新站点级换名记录。S8-E-1 仍恰 3 处。**禁止**再编号为新 E 轴；**禁止**写入 EXCLUSIONS 表行。

**F — 已合入（空枚举；未铸造新面）**：[R36-F.md](./R36-F.md)。15 文件；基线 `519101f`。15 文件相对 `519101f` 五验 0 行；`wc -l` 2550。预算重锚 r5f 123.76/119.45/118.82、r6f 120.24/122.96/118.50、r7f 128.74/125.52/128.33（中段主机，历史包络内）。**零**新站点级换名记录。S7-F-1 ≠ S6-F-5。BINDX 10 token / 8 行维持。**禁止**再编号为新 F 轴；**禁止**写入 EXCLUSIONS 表行。

**G — 已合入（空枚举；未铸造新面）**：[R36-G.md](./R36-G.md)。42 文件；基线 `4efee23`。42 文件相对 `4efee23` 四验 0 行；`wc -l` 8960。预算重锚 compute 0.292–0.295 vs I/O 93.6–96.9（支配 ~317–332×）。digest `06cbcf92c098c8f0` 第二十七次相同，**禁止**再铸 digest 轴号。一项新站点级换名检查拒列（`contract.ts` `validateRequirementContract` 溯源中间数组）。**禁止**再编号为新 G 轴；**禁止**写入 EXCLUSIONS 表行。

**H — 已合入（空枚举；未铸造新面）**：[R36-H.md](./R36-H.md)。21 文件；基线 `fd437a9`。21 文件相对 `fd437a9` 四验 0 行；`wc -l` 1750。预算重锚默认链 9781/9262/9139 ns（宿主暖窗，落 R30-H 邻域；freeze 0 行不作发现）。**零**新站点级换名记录。S5-H-1 保持。**禁止**再编号为新 H 轴；**禁止**写入 EXCLUSIONS 表行。

**I — 已合入（空枚举；未铸造新面）**：[R36-I.md](./R36-I.md)。25 文件；基线 `8dee7fb`。25 文件相对 `8dee7fb` 四验 0 行；`wc -l` 4708。预算重锚 custom−builtin children +25.1~+26.6 / +45.9~+47.0、track +23.2~+25.6 / +48.0~+51.4、flowchart +17.8~+22.6 / +42.1~+47.3（主机偏快，与世系带相交）。**零**新站点级换名记录。S8-I-1 两侧 file-level 封死。**禁止**再编号为新 I 轴；**禁止**写入 EXCLUSIONS 表行。

**J — 运行中**：29 文件；基线 `fb41417`。J1 锁定（2468 项逐位，2948.5× 宿主偏移）。默认对照 R35-J（preferences 146.3–253.7 / 438.7–509.9；jsonl 69.7–76.9 / pass-2 290.0–326.3；宿主窗）。非再移植：**LINKTOP**、**CSPELL**、**ZREP**、**SIDEC**、**BINDX**、**MODEX**、R32-J 六个从未受控残余坐标、R34-J 四项换名检查、R35-J 零新站点级记录、R33-A … R35-J 空枚举、R36-A 空枚举、R36-B 空枚举、R36-C 空枚举、R36-D 空枚举、R36-E 空枚举、R36-F 空枚举、R36-G 空枚举、R36-H 空枚举、R36-I 空枚举。若落地：gate + J1 仿真（2468）+ 既有 J harness。报告 `docs/reports/sota-opt/round-36/R36-J.md`。禁止开 PR。

A–J 均要求返回首行 `MODEL_SLUG=claude-fable-5-thinking-xhigh`，末两行 `MORE_OPTIMA=yes|no` 与 `BRANCH=...`。模型必须是 **claude-fable-5-thinking-xhigh**，禁止静默降级。

## 期望

- 默认预期：诚实空枚举。空枚举轴外号只进本 PLAN「禁止再编号」+ 首段 unnamed plan-ban，**不**进 EXCLUSIONS 表。
- 若有候选：理论 + 确定性 sim + 真尺度非噪声（offline-logit ±35 ms；µs/ns 与 once-per-run CLI 噪声拒收）。输家脚本只进报告附录，不提交仓库。
- 平台硬顶 3 并发云 VM；本波保持 R36-J（无未派切片，不提前开 Round 37）。
- Round 35 已 10/10 收口。Round 36 在 J 返回并合入后 10/10 收口，再开 Round 37。
