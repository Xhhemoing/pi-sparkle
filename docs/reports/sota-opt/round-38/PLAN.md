# Round 38 作战计划

**目标**：在 R37 十切片诚实空枚举关闭（无 S37-A-* … S37-J-*；R37-A 三项换名检查拒列；R37-G digest 第二十八次相同，未铸造 digest 轴号；R37-B / R37-C / R37-D / R37-E / R37-F / R37-H / R37-I / R37-J 零新站点级换名记录）以及 **FITQ / NAMESHAPE / SCALEX / XPROC / YMIX / SCHEDWIN / KFAN / NVG / SEEDX / TERMCLASS / SHAPEK / ORDX / CKMIX / CALLB / OCCX / JB / RUNLIM / VALCLASS / CG / AGEX / COTARG / PRICEX / RTL / DELINV / PROBX / RVL / SIDEC / PWL / ZREP / PAIRX / CSPELL / REPRX / LINKTOP / BINDX / MODEX** 具名 ban 的前提下，对十切片做**第三十八遍**独立枚举。R37 已 10/10 关闭。本轮状态：**A–J 已合入（10/10）**。Round 39 已开，见 [round-39/PLAN.md](../round-39/PLAN.md)。

**约束**：

- R8–R37 已合入切片全部诚实空枚举。无新 S37-A-* … S37-J-*。R38-A / R38-B / R38-C / R38-D / R38-E / R38-F / R38-G / R38-H / R38-I / R38-J 亦诚实空枚举关闭（无 S38-A-* … S38-J-*）。
- 生产基线未变：最后 `src/` 提交仍为 `183df9b`（S7-C）。
- 禁止再编号：FITQ、NAMESHAPE、SCALEX、XPROC、YMIX、SCHEDWIN、KFAN、NVG、SEEDX、TERMCLASS、SHAPEK、ORDX、CKMIX、CALLB、OCCX、JB、RUNLIM、VALCLASS、CG、AGEX、COTARG、PRICEX、RTL、DELINV、PROBX、RVL、SIDEC、PWL、ZREP、PAIRX、CSPELL、REPRX、LINKTOP、BINDX、MODEX（空枚举轴外号，**不是** EXCLUSIONS 表行）。
- R21–R37 具名 / unnamed 面与上列停驻 / 分解 / 审计记录亦 plan-ban，**不**写入 EXCLUSIONS 表行。R32-A 重开条件哨兵审计（F12a–d）与 R32-B 闭合稳定性审计（54/54 裁决仍立；五扇残门 D1–D5 按归属关闭）按方法 / 停驻记录，**不**铸造新面、**不**写入 EXCLUSIONS 表行。R33-A 把 R32-B 三腿方法应用到 A 区 44 行账本（44/44 仍立）亦为方法卫生，**禁止**再铸「再查一遍闭合稳定性」式新面。**禁止**把「再查一遍重开条件 / 闭合稳定性 / 门扉」铸成新面。R38-G digest `06cbcf92c098c8f0` 第二十九次相同 — 若后再同，记**第三十次**相同，**禁止**再铸 digest 轴号。
- 落地条件、硬不变量、sim 家族与 [PROGRESS.md](../PROGRESS.md) / [EXCLUSIONS.md](../EXCLUSIONS.md) / [round-37/PLAN.md](../round-37/PLAN.md) 一致。

## 切片（与 R1–R37 相同）

| 切片 | 范围 | 状态 |
| --- | --- | --- |
| A | `src/tracking/` + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14） | 已合入（空枚举；未铸造新面；14.0–19.0 µs/gate ⇒ ~70–95 µs/run） |
| B | 在线路由 9 + `src/supervisor/model-router.ts`（10） | 已合入（空枚举；未铸造新面；ceiling M=2 10.91–11.98 / M=10 16.91–18.00；replay M=2 9.00–10.14） |
| C | 离线路由 9 | 已合入（空枚举；未铸造新面；中位 683.6–688.2；组合天花板 23.3–29.7 < 35；sink=7.309） |
| D | `src/adaptation/`（14） | 已合入（空枚举；未铸造新面；S0c 3.47–3.79 ms） |
| E | `src/learning/`（10） | 已合入（空枚举；未铸造新面；SLICE-CPU cmp25 15.0–15.2；默认带沿用 14.7–15.2） |
| F | `src/experiments/`（15） | 已合入（空枚举；未铸造新面；r5f 120.85/130.94/130.63、r6f 121.66/123.17/119.60、r7f 127.12/129.75/127.34） |
| G | `src/run/`（除 A 两文件）+ `src/supervisor/`（除 model-router）+ `src/graph/` + `src/domain/`（42） | 已合入（空枚举；未铸造新面；compute 0.291–0.296 vs I/O 87.0–106.1；digest 第二十九次相同） |
| H | evaluation 8 + requirement 7 + review 4 + rubric 2（21） | 已合入（空枚举；未铸造新面；默认链 9316/8866/8926 ns；宿主中窗，freeze 0 行） |
| I | cli 13 + pi-adapter 9 + config 2 + telemetry 1（25） | 已合入（空枚举；未铸造新面；custom−builtin children +20.0~+29.2 / +44.6~+47.1、track +20.0~+27.5 / +47.2~+52.3、flowchart +18.7~+21.8 / +34.0~+43.0） |
| J | cluster 3 + privacy 3 + preferences 7 + episode 5 + persist 2 + track 4 + context 2 + feedback 3（29） | 已合入（空枚举；未铸造新面；preferences 124.4–255.4 / 400.8–519.0；jsonl 60.6–66.9 / fsync=true 230.0–334.9；J1 2468 / 2951.7×） |

默认对照取最近已合入轮：A = R38-A（14.0–19.0 µs/gate ⇒ ~70–95 µs/run）；B = R38-B（ceiling M=2 10.91–11.98 / M=10 16.91–18.00；replay M=2 9.00–10.14）；C = R38-C（中位 683.6–688.2；组合天花板 23.3–29.7 < 35；sink=7.309；中段宿主，freeze 0 行）；D = R38-D（S0c 3.47–3.79 ms）；E = R38-E（SLICE-CPU cmp25 15.0–15.2；默认带沿用 14.7–15.2；freeze 0 行）；F = R38-F（r5f 120.85/130.94/130.63、r6f 121.66/123.17/119.60、r7f 127.12/129.75/127.34；双向宿主窗，freeze 0 行）；G = R38-G（compute 0.291–0.296 vs I/O 87.0–106.1；digest 第二十九次相同，**禁止**再铸 digest 轴号）；H = R38-H（默认链 9316/8866/8926 ns；宿主中窗，freeze 0 行）；I = R38-I（custom−builtin children +20.0~+29.2 / +44.6~+47.1、track +20.0~+27.5 / +47.2~+52.3、flowchart +18.7~+21.8 / +34.0~+43.0；freeze 0 行）；J = R38-J（preferences 124.4–255.4 / 400.8–519.0；jsonl 60.6–66.9 / fsync=true 230.0–334.9；J1 2468 / 2951.7×；freeze 0 行）。S12-B-2 条件陆器仍未触发。S8-I-1 两侧 file-level 封死。S13-B-1 仍为 loser ID。S7-F-1 ≠ S6-F-5。S5-H-1 保持。catalog 行序契约决策承载（R28-B W3）。npm POSIX `.bin` symlink 静默 no-op（R28-I）**禁止**当优化修。

## 第三十八遍焦点

**A — 已合入（空枚举；未铸造新面）**：[R38-A.md](./R38-A.md)。14 文件；基线 `7acb666`。14 文件相对 `7acb666` 三验 0 行；`wc -l` 1796。预算重锚 14.0–19.0 µs/gate ⇒ ~70–95 µs/run。三项新站点级换名检查拒列。哨兵卫生复跑无一触发。**禁止**再编号为新 A 轴；**禁止**把「再查一遍重开条件 / 闭合稳定性」铸成新面；**禁止**写入 EXCLUSIONS 表行。

**B — 已合入（空枚举；未铸造新面）**：[R38-B.md](./R38-B.md)。10 文件；基线 `94ed3d9`。10 文件相对 `94ed3d9` 三验 0 行；`wc -l` 1359。预算重锚 ceiling M=2 10.91–11.98 / M=10 16.91–18.00；replay M=2 9.00–10.14。**零**新站点级换名记录。S12-B-2 仍未触发；S13-B-1 仍为 loser ID；catalog 行序未触。**禁止**再编号为新 B 轴；**禁止**写入 EXCLUSIONS 表行。

**C — 已合入（空枚举；未铸造新面）**：[R38-C.md](./R38-C.md)。9 文件；基线 `183df9b`。9 文件相对 `183df9b` 五验 0 行；`wc -l` 2039。预算重锚中位 683.6–688.2（中段宿主，落 ±35 带内）；组合天花板 23.3–29.7 < 35；sink=7.309 八读全同。**零**新站点级换名记录。**禁止**再编号为新 C 轴；**禁止**写入 EXCLUSIONS 表行。

**D — 已合入（空枚举；未铸造新面）**：[R38-D.md](./R38-D.md)。14 文件；基线 `82bef36`。14 文件相对 `82bef36` 五验 0 行；`wc -l` 3294。预算重锚 S0c 3.47–3.79 ms（落 R37-D 3.40–3.80 带内）。**零**新站点级换名记录。S9-D-4 / S12-D-1 仍关闭。**禁止**再编号为新 D 轴；**禁止**写入 EXCLUSIONS 表行。

**E — 已合入（空枚举；未铸造新面）**：[R38-E.md](./R38-E.md)。10 文件；基线 `adb20d7`。10 文件相对 `adb20d7` 五验 0 行；`wc -l` 1770。预算重锚 SLICE-CPU cmp25 15.0–15.2（默认带沿用 14.7–15.2）。**零**新站点级换名记录。S8-E-1 仍恰 3 处。**禁止**再编号为新 E 轴；**禁止**写入 EXCLUSIONS 表行。

**F — 已合入（空枚举；未铸造新面）**：[R38-F.md](./R38-F.md)。15 文件；基线 `519101f`。15 文件相对 `519101f` 四验 0 行；`wc -l` 2550。预算重锚 r5f 120.85/130.94/130.63、r6f 121.66/123.17/119.60、r7f 127.12/129.75/127.34（双向宿主窗，历史包络内）。**零**新站点级换名记录。S7-F-1 ≠ S6-F-5。BINDX 10 token / 8 行维持。**禁止**再编号为新 F 轴；**禁止**写入 EXCLUSIONS 表行。

**G — 已合入（空枚举；未铸造新面）**：[R38-G.md](./R38-G.md)。42 文件；基线 `4efee23`。42 文件相对 `4efee23` 五验 0 行；`wc -l` 8960。预算重锚 compute 0.291–0.296 vs I/O 87.0–106.1。digest `06cbcf92c098c8f0` **第二十九次**相同，**禁止**再铸 digest 轴号。**零**新站点级换名记录。**禁止**再编号为新 G 轴；**禁止**写入 EXCLUSIONS 表行。

**H — 已合入（空枚举；未铸造新面）**：[R38-H.md](./R38-H.md)。21 文件；基线 `fd437a9`。21 文件相对 `fd437a9` 四验 0 行；`wc -l` 1750。预算重锚默认链 9316/8866/8926 ns（宿主中窗，落历史包络）。**零**新站点级换名记录。S5-H-1 保持。**禁止**再编号为新 H 轴；**禁止**写入 EXCLUSIONS 表行。

**I — 已合入（空枚举；未铸造新面）**：[R38-I.md](./R38-I.md)。25 文件；基线 `8dee7fb`。25 文件相对 `8dee7fb` 五验 0 行；`wc -l` 4708。预算重锚 custom−builtin children +20.0~+29.2 / +44.6~+47.1、track +20.0~+27.5 / +47.2~+52.3、flowchart +18.7~+21.8 / +34.0~+43.0（与世系带相交）。**零**新站点级换名记录。S8-I-1 两侧 file-level 封死。**禁止**再编号为新 I 轴；**禁止**写入 EXCLUSIONS 表行。

**J — 已合入（空枚举；未铸造新面）**：[R38-J.md](./R38-J.md)。29 文件；基线 `fb41417`。29 文件相对 `fb41417` 四验 0 行；`wc -l` 3655。预算重锚 preferences 124.4–255.4 / 400.8–519.0；jsonl 60.6–66.9 / fsync=true 230.0–334.9。J1 2468 / 2951.7×。**零**新站点级换名记录。**禁止**再编号为新 J 轴；**禁止**写入 EXCLUSIONS 表行。

A–J 均要求返回首行 `MODEL_SLUG=claude-fable-5-thinking-xhigh`，末两行 `MORE_OPTIMA=yes|no` 与 `BRANCH=...`。模型必须是 **claude-fable-5-thinking-xhigh**，禁止静默降级。

## 期望

- 默认预期：诚实空枚举。空枚举轴外号只进本 PLAN「禁止再编号」+ 首段 unnamed plan-ban，**不**进 EXCLUSIONS 表。
- 若有候选：理论 + 确定性 sim + 真尺度非噪声（offline-logit ±35 ms；µs/ns 与 once-per-run CLI 噪声拒收）。输家脚本只进报告附录，不提交仓库。
- Round 38 已 10/10 收口。Round 39 已开，本波派出 R39-A / R39-B / R39-C。
