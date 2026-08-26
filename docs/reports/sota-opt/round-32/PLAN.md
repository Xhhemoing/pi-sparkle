# Round 32 作战计划

**目标**：在 R30 十面与 R31 已合入面（**BINDX** / I/O text-codec topology / per-run transcode-byte manifest；R31-A injected-callable 停驻；R31-B 面格六门停驻；R31-D R22-D 所有权单元格；R31-F 故障通道处置分解；R31-G 全切片门扉闭合审计；R31-H 边界参数平面四门分解/停驻；R31-I CLI 进程边界门扉闭合审计；R31-J **MODEX**）以及 **FITQ / NAMESHAPE / SCALEX / XPROC / YMIX / SCHEDWIN / KFAN / NVG / SEEDX / TERMCLASS / SHAPEK / ORDX / CKMIX / CALLB / OCCX / JB / RUNLIM / VALCLASS / CG / AGEX / COTARG / PRICEX / RTL / DELINV / PROBX / RVL / SIDEC / PWL / ZREP / PAIRX / CSPELL / REPRX / LINKTOP / BINDX / MODEX** 具名 ban 的前提下，对十切片做**第三十二遍**独立枚举。R31 已 10/10 关闭（铸造 **MODEX**）。本轮状态：**A–I 已合入；J 运行中**。

**约束**：

- R8–R31 已合入切片全部诚实空枚举。无新 S31-A-* … S31-J-*。R32-A … R32-I 亦诚实空枚举关闭（无 S32-A-* … S32-I-*）。
- 生产基线未变：最后 `src/` 提交仍为 `183df9b`（S7-C）。
- 禁止再编号：FITQ、NAMESHAPE、SCALEX、XPROC、YMIX、SCHEDWIN、KFAN、NVG、SEEDX、TERMCLASS、SHAPEK、ORDX、CKMIX、CALLB、OCCX、JB、RUNLIM、VALCLASS、CG、AGEX、COTARG、PRICEX、RTL、DELINV、PROBX、RVL、SIDEC、PWL、ZREP、PAIRX、CSPELL、REPRX、LINKTOP、BINDX、MODEX（空枚举轴外号，**不是** EXCLUSIONS 表行）。
- R21–R31 具名 / unnamed 面与上列停驻 / 分解 / 审计记录亦 plan-ban，**不**写入 EXCLUSIONS 表行。R32-A 重开条件哨兵审计（F12a–d）与 R32-B 闭合稳定性审计（54/54 裁决仍立；五扇残门 D1–D5 按归属关闭）按方法 / 停驻记录，**不**铸造新面、**不**写入 EXCLUSIONS 表行。
- 落地条件、硬不变量、sim 家族与 [PROGRESS.md](../PROGRESS.md) / [EXCLUSIONS.md](../EXCLUSIONS.md) / [round-31/PLAN.md](../round-31/PLAN.md) 一致。

## 切片（与 R1–R31 相同）

| 切片 | 范围 | 状态 |
| --- | --- | --- |
| A | `src/tracking/` + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14） | 已合入（空枚举；未铸造新面；重开条件哨兵审计 F12a–d；13.5–15.7 µs/gate ⇒ ~68–79 µs/run） |
| B | 在线路由 9 + `src/supervisor/model-router.ts`（10） | 已合入（空枚举；未铸造新面；闭合稳定性审计 54/54；五扇残门 D1–D5 关闭；M=2 9.04–9.62 / M=10 17.84–18.43） |
| C | 离线路由 9 | 已合入（空枚举；未铸造新面；中位 659.0–662.0；组合天花板 20.2–26.6 < 35；sink=7.309） |
| D | `src/adaptation/`（14） | 已合入（空枚举；未铸造新面；元闭合 35 行无一松动；S0c 3.37–3.60 ms） |
| E | `src/learning/`（10） | 已合入（空枚举；未铸造新面；SLICE-CPU cmp25 14.8–15.3） |
| F | `src/experiments/`（15） | 已合入（空枚举；未铸造新面；r5f 119.46/120.27/125.31、r6f 124.25/119.48/119.70、r7f 125.62/129.79/129.50） |
| G | `src/run/`（除 A 两文件）+ `src/supervisor/`（除 model-router）+ `src/graph/` + `src/domain/`（42） | 已合入（空枚举；未铸造新面；compute 0.289–0.293 vs I/O 88.2–93.5；digest 第二十三次相同） |
| H | evaluation 8 + requirement 7 + review 4 + rubric 2（21） | 已合入（空枚举；未铸造新面；默认链 9100/9108/8975 ns） |
| I | cli 13 + pi-adapter 9 + config 2 + telemetry 1（25） | 已合入（空枚举；未铸造新面；custom−builtin children +45.5~+50.1 / +23.1~+24.8、track +48.3~+55.3 / +21.8~+26.1、flowchart-flat64 +42.4~+45.4 / +16.8~+19.4） |
| J | cluster 3 + privacy 3 + preferences 7 + episode 5 + persist 2 + track 4 + context 2 + feedback 3（29） | 运行中 |

默认对照取最近已合入轮：A = R31-A（13.6–16.9 µs/gate ⇒ ~68–84 µs/run）；B = R32-B（M=2 9.04–9.62 / M=10 17.84–18.43）；C = R32-C（中位 659.0–662.0；组合天花板 20.2–26.6 < 35；sink=7.309）；D = R32-D（S0c 3.37–3.60 ms）；E = R32-E（SLICE-CPU cmp25 14.8–15.3）；F = R32-F（r5f 119.46/120.27/125.31、r6f 124.25/119.48/119.70、r7f 125.62/129.79/129.50）；G = R32-G（compute 0.289–0.293 vs I/O 88.2–93.5；digest 第二十三次相同，**禁止**再铸 digest 轴号）；H = R32-H（默认链 9100/9108/8975 ns）；I = R32-I（custom−builtin children +45.5~+50.1 / +23.1~+24.8、track +48.3~+55.3 / +21.8~+26.1、flowchart-flat64 +42.4~+45.4 / +16.8~+19.4）；J = R31-J（preferences 127.8–248.9 / 410.5–540.0；jsonl 59.1–65.7 / 253.3–304.6 µs）。S12-B-2 条件陆器仍未触发。S8-I-1 两侧 file-level 封死。S13-B-1 仍为 loser ID。S7-F-1 ≠ S6-F-5。S5-H-1 保持。catalog 行序契约决策承载（R28-B W3）。npm POSIX `.bin` symlink 静默 no-op（R28-I）**禁止**当优化修。

## 第三十二遍焦点

**A — 已合入（空枚举；未铸造新面；重开条件哨兵审计 F12a–d）**：[R32-A.md](./R32-A.md)。14 文件；基线 `7acb666`。14 文件相对 `7acb666` 三验 0 行；`wc -l` 1796。本轮系统性验证全部在案重开条件均未触发（F12a 四入口无新调用方；F12b Math.* = 6 token 未变、切片零 fs/codec、零 `JSON.parse`；F12c `requiredChecks` 仍契约封顶；F12d `DEFAULT_TRACKING_CONFIG` 未变）。预算重锚 13.5–15.7 µs/gate ⇒ ~68–79 µs/run。**禁止**再编号为新 A 轴；**禁止**把「再查一遍重开条件」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**B — 已合入（空枚举；未铸造新面；闭合稳定性审计）**：[R32-B.md](./R32-B.md)。10 文件；基线 `94ed3d9`。10 文件相对 `94ed3d9` 三验 0 行；`wc -l` 1359。本轮不重走 R31-B 面格，改做闭合稳定性审计：54/54 既有 B 排除裁决至少一腿仍立，无一重开。五扇残门（D1 决策记录字段活性普查——19/20 字段被消费，整构造份额 158.9–163.3 ns/task ≈ 0.65 ms/eval；D2–D5 故障对象通道 / 每呼闭包分配 / one-hot 载体形 / ESM live-binding）按普查 / 属地 / 量级关闭。天花板重锚 M=2 9.04–9.62 / M=10 17.84–18.43（回落 R30-B 带；R31-B +10–27% 为主机偏置）。S12-B-2 腿 (a) 仍未触发；S13-B-1 仍为 loser ID。**禁止**再编号为新 B 轴；**禁止**把「再查一遍闭合稳定性」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**C — 已合入（空枚举；未铸造新面）**：[R32-C.md](./R32-C.md)。9 文件；基线 `183df9b`。9 文件相对 `183df9b` 三验 0 行；`wc -l` 2039。从未点名站点数连续第十四遍为零。中位重锚 659.0–662.0；组合天花板 20.2–26.6 < 35；sink=floorSink=7.309 八读数位等。r1c–r7c 8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193 全绿。两项换名检查（pow 强度削减 / TypedArray 数值排序）拒收不铸 ID。**禁止**再编号为新 C 轴；**禁止**把「再查一遍未点名站点」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**D — 已合入（空枚举；未铸造新面）**：[R32-D.md](./R32-D.md)。14 文件；基线 `82bef36`。14 文件相对 `82bef36` 两验 0 行；`wc -l` 3294。R31-D 元闭合 35 行从零重推无一松动；R22-D 属地格前提（零生产调用方）第三十二次成立。哨兵按 R32-A 方法仅作卫生应用，**不**铸「再查一遍重开条件」式新面。地板重锚 S0c 3.37–3.60 ms（与 R31-D 3.38–3.64 / R30-D 3.29–3.66 带交叠）。S9-D-4 / S12-D-1 永不再开。**禁止**再编号为新 D 轴；**禁止**写入 EXCLUSIONS 表行。

**E — 已合入（空枚举；未铸造新面）**：[R32-E.md](./R32-E.md)。10 文件；基线 `adb20d7`。10 文件相对 `adb20d7` 多验 0 行；`wc -l` 1770。零未点名站点。SLICE-CPU cmp25 重锚 14.8–15.3 µs/run（5/6 落 14.7–15.2 带，一读数贴上沿 0.1）。两项换名检查（`stableProjectKey` 记忆化 / `outcomeKindFromResult` 死形参）拒收不铸 ID。S8-E-1 未触（`loadLearnedRouting` 仍恰三处生产调用）。**禁止**再编号为新 E 轴；**禁止**写入 EXCLUSIONS 表行。

**F — 已合入（空枚举；未铸造新面）**：[R32-F.md](./R32-F.md)。15 文件；基线 `519101f`。15 文件相对 `519101f` 三验 0 行；`wc -l` 2550。面格属主表独立重推无一格松动；故障通道处置残格维持分解归属。哨兵按 R32-A 方法仅作卫生应用，**不**铸「再查一遍重开条件」式新面。锚点重锚 r5f 119.46/120.27/125.31、r6f 124.25/119.48/119.70、r7f 125.62/129.79/129.50；S7-F-1 ≠ S6-F-5 三轮全正复核。三项换名检查（stableStringify 内部形态 / HoldoutVault 注入缝默认臂 / restore 返回值防御拷贝）拒收不铸 ID。**禁止**再编号为新 F 轴；**禁止**写入 EXCLUSIONS 表行。

**G — 已合入（空枚举；未铸造新面）**：[R32-G.md](./R32-G.md)。42 文件；基线 `4efee23`。42 文件相对 `4efee23` 三验 0 行；`wc -l` 8960。R31-G 18 门属主无一松动，**禁止**再铸「门扉审计」轴。digest `06cbcf92c098c8f0` **第二十三次**位等，**禁止**再铸 digest 轴号。计算顶重锚 0.289–0.293 vs I/O 88.2–93.5（~304–324×）。哨兵按 R32-A 方法仅作卫生应用。**禁止**再编号为新 G 轴；**禁止**写入 EXCLUSIONS 表行。

**H — 已合入（空枚举；未铸造新面）**：[R32-H.md](./R32-H.md)。21 文件（evaluation **8** 不是 9）；基线 `fd437a9`。21 文件相对 `fd437a9` 四验 0 行；`wc -l` 1750。S5-H-1 保持（`precedence.ts:24`）。R31-H D1–D4 重开条件均未触发。三项换名检查拒收不铸 ID。默认链重锚 9100/9108/8975 ns（落 R29-H 带）。**禁止**再编号为新 H 轴；**禁止**把「再查一遍边界参数门」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**I — 已合入（空枚举；未铸造新面）**：[R32-I.md](./R32-I.md)。25 文件；基线 `8dee7fb`。25 文件相对 `8dee7fb` 多验 0 行；`wc -l` 4708。S8-I-1 第二十五次 file-level 封死（pi-ai 0.84.1；`all.models.js` 不存在）。未重走 R31-I 门扉审计。五项换名检查拒收不铸 ID。custom−builtin 重锚 children +45.5~+50.1 / +23.1~+24.8、track +48.3~+55.3 / +21.8~+26.1、flowchart-flat64 +42.4~+45.4 / +16.8~+19.4（与 R31-I 带交叠）。r4i/r5i/r7i 68/119/80 全绿。**禁止**再编号为新 I 轴；**禁止**把「再查一遍进程边界」铸成新面；**禁止**把 npm POSIX `.bin` symlink 静默 no-op 当优化修；**禁止**写入 EXCLUSIONS 表行。

**J — 运行中**：29 文件（cluster 3：mailbox / spawn / host；privacy 3：deletion / state-layout / record-classes；preferences 7：loop-eval / export / precedence / materialize / service / store / types；episode 5：manager / replay / events / store / closure；persist 2：file-lock / jsonl；track 4：primary-split / plan / clarify / loop；context 2：index / packet；feedback 3：types / store / redaction）。基线 `fb41417`。J1 锁定（2468 项逐位）。默认对照 R31-J（preferences 127.8–248.9 / 410.5–540.0；jsonl 59.1–65.7 / 253.3–304.6 µs）。非再移植：**LINKTOP**、**CSPELL**、**ZREP**、**SIDEC**、**BINDX**、**MODEX**（inode 模式字面；全网格平坦、生产只能铸默认 0644/0755，**禁止**再铸 chmod/umask 臂）、I/O text-codec topology / per-run transcode-byte manifest、R31-I CLI 进程边界门扉闭合审计、R32-I 空枚举（未铸新面，五项换名检查拒列）、R31-H 四扇边界参数残门、R32-H 空枚举（未铸新面，三项换名检查拒列）、R32-A 重开条件哨兵审计、R32-B 闭合稳定性审计。若落地：gate + J1 仿真（2468）+ 既有 J harness。报告 `docs/reports/sota-opt/round-32/R32-J.md`。禁止开 PR。

A–J 均要求返回首行 `MODEL_SLUG=claude-fable-5-thinking-xhigh`，末两行 `MORE_OPTIMA=yes|no` 与 `BRANCH=...`。模型必须是 **claude-fable-5-thinking-xhigh**，禁止静默降级。

## 期望

- 默认预期：诚实空枚举。空枚举轴外号只进本 PLAN「禁止再编号」+ 首段 unnamed plan-ban，**不**进 EXCLUSIONS 表。
- 若有候选：理论 + 确定性 sim + 真尺度非噪声（offline-logit ±35 ms；µs/ns 与 once-per-run CLI 噪声拒收）。输家脚本只进报告附录，不提交仓库。
- 平台硬顶 3 并发云 VM；本波剩余 R32-J（无未派出的 Round 32 切片；J 返回后 10/10 收口再开 Round 33）。
- Round 31 已 10/10 收口。Round 32 在 J 返回并合入后 10/10 收口，再开 Round 33。
