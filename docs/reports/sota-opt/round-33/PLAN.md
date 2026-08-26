# Round 33 作战计划

**目标**：在 R32 十切片诚实空枚举关闭（无 S32-A-* … S32-J-*；R32-A 重开条件哨兵审计 F12a–d 与 R32-B 闭合稳定性审计按方法 / 停驻记录，未铸造新面；R32-J 六个从未受控残余坐标未过三合取，未铸造新面）以及 **FITQ / NAMESHAPE / SCALEX / XPROC / YMIX / SCHEDWIN / KFAN / NVG / SEEDX / TERMCLASS / SHAPEK / ORDX / CKMIX / CALLB / OCCX / JB / RUNLIM / VALCLASS / CG / AGEX / COTARG / PRICEX / RTL / DELINV / PROBX / RVL / SIDEC / PWL / ZREP / PAIRX / CSPELL / REPRX / LINKTOP / BINDX / MODEX** 具名 ban 的前提下，对十切片做**第三十三遍**独立枚举。R32 已 10/10 关闭。本轮状态：**A–I 已合入；J 运行中**。

**约束**：

- R8–R32 已合入切片全部诚实空枚举。无新 S32-A-* … S32-J-*。R33-A … R33-I 亦诚实空枚举关闭（无 S33-A-* … S33-I-*）。
- 生产基线未变：最后 `src/` 提交仍为 `183df9b`（S7-C）。
- 禁止再编号：FITQ、NAMESHAPE、SCALEX、XPROC、YMIX、SCHEDWIN、KFAN、NVG、SEEDX、TERMCLASS、SHAPEK、ORDX、CKMIX、CALLB、OCCX、JB、RUNLIM、VALCLASS、CG、AGEX、COTARG、PRICEX、RTL、DELINV、PROBX、RVL、SIDEC、PWL、ZREP、PAIRX、CSPELL、REPRX、LINKTOP、BINDX、MODEX（空枚举轴外号，**不是** EXCLUSIONS 表行）。
- R21–R32 具名 / unnamed 面与上列停驻 / 分解 / 审计记录亦 plan-ban，**不**写入 EXCLUSIONS 表行。R32-A 重开条件哨兵审计（F12a–d）与 R32-B 闭合稳定性审计（54/54 裁决仍立；五扇残门 D1–D5 按归属关闭）按方法 / 停驻记录，**不**铸造新面、**不**写入 EXCLUSIONS 表行。R33-A 把 R32-B 三腿方法应用到 A 区 44 行账本（44/44 仍立）亦为方法卫生，**禁止**再铸「再查一遍闭合稳定性」式新面。**禁止**把「再查一遍重开条件 / 闭合稳定性 / 门扉」铸成新面。
- 落地条件、硬不变量、sim 家族与 [PROGRESS.md](../PROGRESS.md) / [EXCLUSIONS.md](../EXCLUSIONS.md) / [round-32/PLAN.md](../round-32/PLAN.md) 一致。

## 切片（与 R1–R32 相同）

| 切片 | 范围 | 状态 |
| --- | --- | --- |
| A | `src/tracking/` + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14） | 已合入（空枚举；未铸造新面；11.8–17.6 µs/gate ⇒ ~59–88 µs/run；A 账本 44/44 闭合稳定性卫生） |
| B | 在线路由 9 + `src/supervisor/model-router.ts`（10） | 已合入（空枚举；未铸造新面；M=2 10.75–11.73 / M=10 21.48–23.74；主机偏置） |
| C | 离线路由 9 | 已合入（空枚举；未铸造新面；中位 670.2–708.7；组合天花板 25.7–31.7 < 35；sink=7.309） |
| D | `src/adaptation/`（14） | 已合入（空枚举；未铸造新面；S0c 3.42–3.67 ms） |
| E | `src/learning/`（10） | 已合入（空枚举；未铸造新面；SLICE-CPU cmp25 15.1–15.3） |
| F | `src/experiments/`（15） | 已合入（空枚举；未铸造新面；r5f 124.47/118.96/129.73、r6f 122.96/122.14/121.70、r7f 127.78/127.36/127.07） |
| G | `src/run/`（除 A 两文件）+ `src/supervisor/`（除 model-router）+ `src/graph/` + `src/domain/`（42） | 已合入（空枚举；未铸造新面；compute 0.302–0.309 vs I/O 90.4–104.4；digest 第二十四次相同） |
| H | evaluation 8 + requirement 7 + review 4 + rubric 2（21） | 已合入（空枚举；未铸造新面；默认链 8991/8820/8843 ns） |
| I | cli 13 + pi-adapter 9 + config 2 + telemetry 1（25） | 已合入（空枚举；未铸造新面；children +42.0~+45.9 / +22.8~+25.8、track +48.2~+52.8 / +23.6~+24.3、flowchart-flat64 +39.4~+46.8 / +16.8~+19.9） |
| J | cluster 3 + privacy 3 + preferences 7 + episode 5 + persist 2 + track 4 + context 2 + feedback 3（29） | 运行中 |

默认对照取最近已合入轮：A = R33-A（11.8–17.6 µs/gate ⇒ ~59–88 µs/run）；B = R33-B（M=2 10.75–11.73 / M=10 21.48–23.74；主机偏置，freeze 0 行）；C = R33-C（中位 670.2–708.7；组合天花板 25.7–31.7 < 35；sink=7.309）；D = R33-D（S0c 3.42–3.67 ms）；E = R33-E（SLICE-CPU cmp25 15.1–15.3）；F = R33-F（r5f 124.47/118.96/129.73、r6f 122.96/122.14/121.70、r7f 127.78/127.36/127.07）；G = R33-G（compute 0.302–0.309 vs I/O 90.4–104.4；digest 第二十四次相同，**禁止**再铸 digest 轴号）；H = R33-H（默认链 8991/8820/8843 ns）；I = R33-I（custom−builtin children +42.0~+45.9 / +22.8~+25.8、track +48.2~+52.8 / +23.6~+24.3、flowchart-flat64 +39.4~+46.8 / +16.8~+19.9）；J = R32-J（preferences 124.0–230.7 / 406.9–528.9；jsonl 59.7–66.8 / 199.9–296.8 µs）。S12-B-2 条件陆器仍未触发。S8-I-1 两侧 file-level 封死。S13-B-1 仍为 loser ID。S7-F-1 ≠ S6-F-5。S5-H-1 保持。catalog 行序契约决策承载（R28-B W3）。npm POSIX `.bin` symlink 静默 no-op（R28-I）**禁止**当优化修。

## 第三十三遍焦点

**A — 已合入（空枚举；未铸造新面）**：[R33-A.md](./R33-A.md)。14 文件；基线 `7acb666`。14 文件相对 `7acb666` 三验 0 行；`wc -l` 1796。R32-B 三腿方法第一次应用到 A 区 44 行账本（44/44 仍立，方法卫生不铸面）。F12a–d / F11a/b 哨兵卫生复跑无一触发。三项换名检查拒收不铸 ID。预算重锚 11.8–17.6 µs/gate ⇒ ~59–88 µs/run（与历史并集交叠）。**禁止**再编号为新 A 轴；**禁止**把「再查一遍重开条件 / 闭合稳定性」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**B — 已合入（空枚举；未铸造新面）**：[R33-B.md](./R33-B.md)。10 文件；基线 `94ed3d9`。10 文件相对 `94ed3d9` 四验 0 行；`wc -l` 1359。未重走 R31-B 面格或 R32-B 闭合稳定性审计。一处从未点名站点（`ROLE_FAMILY` 死回退）拒收不铸 ID。天花板重锚 M=2 10.75–11.73 / M=10 21.48–23.74（相对 R32-B +12–29% 为主机偏置，freeze 0 行）。S12-B-2 腿 (a) 仍未触发；S13-B-1 仍为 loser ID。**禁止**再编号为新 B 轴；**禁止**把「再查一遍面格 / 闭合稳定性」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**C — 已合入（空枚举；未铸造新面）**：[R33-C.md](./R33-C.md)。9 文件；基线 `183df9b`。9 文件相对 `183df9b` 四验 0 行；`wc -l` 2039。从未点名站点数连续第十五遍为零。两项换名检查拒收不铸 ID。中位重锚 670.2–708.7（主机干扰窗，freeze 0 行）；组合天花板 25.7–31.7 < 35；sink=floorSink=7.309 八读数位等。r1c–r7c 8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193 全绿。**禁止**再编号为新 C 轴；**禁止**把「再查一遍未点名站点」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**D — 已合入（空枚举；未铸造新面）**：[R33-D.md](./R33-D.md)。14 文件；基线 `82bef36`。14 文件相对 `82bef36` 两验 0 行；`wc -l` 3294。休眠模块零生产调用方第三十三次成立。三项换名检查拒收不铸 ID。地板重锚 S0c 3.42–3.67 ms（与 R29-D…R32-D 带交叠）。S9-D-4 / S12-D-1 永不再开。**禁止**再编号为新 D 轴；**禁止**写入 EXCLUSIONS 表行。

**E — 已合入（空枚举；未铸造新面）**：[R33-E.md](./R33-E.md)。10 文件；基线 `adb20d7`。10 文件相对 `adb20d7` 四验 0 行；`wc -l` 1770。从未点名站点数为零，且本轮零新站点级换名记录（严于 R32-E 的 2 项：`isCompleteRoute` typeof 收窄与 `unique()`/`mode()` Set 化均为已点名复命中）。SLICE-CPU cmp25 重锚 15.1–15.3（6/6 落 R32-E 对照带 14.8–15.3）。`loadLearnedRouting` 生产调用位点仍恰 3 处（S8-E-1 未触）。**禁止**再编号为新 E 轴；**禁止**写入 EXCLUSIONS 表行。

**F — 已合入（空枚举；未铸造新面）**：[R33-F.md](./R33-F.md)。15 文件；基线 `519101f`。15 文件相对 `519101f` 四验 0 行；`wc -l` 2550。四项换名检查拒收不铸 ID。BINDX 划界计数订正 9→10 token（同 8 行，坐标未动）。锚点重锚 r5f 124.47/118.96/129.73、r6f 122.96/122.14/121.70、r7f 127.78/127.36/127.07。S7-F-1 ≠ S6-F-5 复核成立。**禁止**再编号为新 F 轴；**禁止**写入 EXCLUSIONS 表行。

**G — 已合入（空枚举；未铸造新面）**：[R33-G.md](./R33-G.md)。42 文件；基线 `4efee23`。42 文件相对 `4efee23` 三验 0 行；`wc -l` 8960。三项换名检查拒收不铸 ID（`failurePathCompletedGraph` 共享 visiting 真路径保留独立重推命中 S2-G-2 原文）。计算顶重锚 0.302–0.309 vs I/O 90.4–104.4（相对 R32-G 主机偏置高侧）。digest `06cbcf92c098c8f0` 第二十四次逐位相同，**禁止**再铸 digest 轴号。**禁止**再编号为新 G 轴；**禁止**把「再查一遍门扉」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**H — 已合入（空枚举；未铸造新面）**：[R33-H.md](./R33-H.md)。21 文件；基线 `fd437a9`。21 文件相对 `fd437a9` 三验 0 行；`wc -l` 1750。S5-H-1 保持（`precedence.ts:24`）。本轮零新站点级换名记录（`reconcileReviews` 双 filter 融合命中 S1-H-6；`findUnsourcedItems` 融合落 R30-H 属地）。默认链重锚 8991/8820/8843 ns（R29-H 邻域低侧窗）。**禁止**再编号为新 H 轴；**禁止**把「再查一遍边界参数门」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**I — 已合入（空枚举；未铸造新面）**：[R33-I.md](./R33-I.md)。25 文件；基线 `8dee7fb`。25 文件相对 `8dee7fb` 多验 0 行；`wc -l` 4708。S8-I-1 第三十三次 file-level 封死（pi-ai 0.84.1；`all.models.js` 不存在）。未重走 R31-I 门扉审计。两项换名检查拒收不铸 ID（均命中既有行）。custom−builtin 重锚 children +42.0~+45.9 / +22.8~+25.8、track +48.2~+52.8 / +23.6~+24.3、flowchart-flat64 +39.4~+46.8 / +16.8~+19.9（与 R32-I 带交叠）。r4i/r5i/r7i 68/119/80 全绿。**禁止**再编号为新 I 轴；**禁止**把「再查一遍进程边界」铸成新面；**禁止**把 npm POSIX `.bin` symlink 静默 no-op 当优化修；**禁止**写入 EXCLUSIONS 表行。

**J — 运行中**：29 文件（cluster 3：mailbox / spawn / host；privacy 3：deletion / state-layout / record-classes；preferences 7：loop-eval / export / precedence / materialize / service / store / types；episode 5：manager / replay / events / store / closure；persist 2：file-lock / jsonl；track 4：primary-split / plan / clarify / loop；context 2：index / packet；feedback 3：redaction / store / types）。基线 `fb41417`。预期冻结空；`wc -l` R32-J 记 3655。J1 锁定（2468 项逐位）。默认对照 R32-J（preferences 124.0–230.7 / 406.9–528.9；jsonl 59.7–66.8 / 199.9–296.8 µs）。非再移植：**LINKTOP**、**CSPELL**、**ZREP**、**SIDEC**、**BINDX**、**MODEX**（inode 模式字面；全网格平坦、生产只能铸默认 0644/0755，**禁止**再铸 chmod/umask 臂）、I/O text-codec topology、R31-I CLI 进程边界门扉闭合审计、R32-J 六个从未受控残余坐标（inode 时间元数据 / extent 布局 / 属主字 / ACL-xattr / dirent 序 / 线程池宽度，均未过三合取，**禁止**再铸「我又审了一遍门」式新面）、R32-A 重开条件哨兵审计、R32-B 闭合稳定性审计、R33-A 空枚举、R33-B 空枚举、R33-C 空枚举、R33-D 空枚举、R33-E 空枚举、R33-F 空枚举、R33-G 空枚举（digest 第二十四次相同，**禁止**再铸 digest 轴号）、R33-H 空枚举、R33-I 空枚举。若落地：gate + J1 仿真（2468）+ 既有 J harness。报告 `docs/reports/sota-opt/round-33/R33-J.md`。禁止开 PR。

A–J 均要求返回首行 `MODEL_SLUG=claude-fable-5-thinking-xhigh`，末两行 `MORE_OPTIMA=yes|no` 与 `BRANCH=...`。模型必须是 **claude-fable-5-thinking-xhigh**，禁止静默降级。

## 期望

- 默认预期：诚实空枚举。空枚举轴外号只进本 PLAN「禁止再编号」+ 首段 unnamed plan-ban，**不**进 EXCLUSIONS 表。
- 若有候选：理论 + 确定性 sim + 真尺度非噪声（offline-logit ±35 ms；µs/ns 与 once-per-run CLI 噪声拒收）。输家脚本只进报告附录，不提交仓库。
- 平台硬顶 3 并发云 VM；本波保持 R33-J（本轮无未派切片，不另开 Round 34）。
- Round 32 已 10/10 收口。Round 33 在 J 返回并合入后 10/10 收口，再开 Round 34。
