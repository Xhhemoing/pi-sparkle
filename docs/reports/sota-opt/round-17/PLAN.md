# Round 17 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–16 已对各区做过十六遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S16-* 条目（含已合入的 S13-B-1 与 R12–R16 全部空枚举收口，含刚合入的 R16-A … R16-J / R17-A / R17-B / R17-C / R17-D / R17-E / R17-F）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R17-A … R17-J），报告写入 `docs/reports/sota-opt/round-17/`。

状态：第 3 波 I 本波派出；G/H 运行中。A–F 已合入（空枚举）。Round 16 已收口 10/10。

A 切片已合入：空枚举，未铸 S17-A-*。预算复核 65–74 µs/run（13.0–14.8 µs/gate，与 R16-A 66–76 同带）。本轮新增事件表组成轴（GT 饱和 10 ms 越线收紧至 E≈4.7–5.2×10⁴，仍约 3.1 量级高于生产 E=41）与生产态冷进程预算（2.7–8.5 ms/run，主导为 `hashAssessment` localeCompare 触发的 ICU collator 惰性初始化 ~5.0 ms，once-per-run）。R14-A / R15-A / R16-A 轴不补铸。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S17-B-*。天花板复核 M=2 9.1–11.4 / M=10 19.0–23.8 / replay 7.2–8.2 / 10× 104–128 ms/eval（粗格偏慢属 VM 噪声；细粒度 live face 48.1–48.9 µs 稳定）。S12-B-2 / S13-B-1 重开条件未触发。本轮新增拒绝/异常路径定价（单次抛出 11.6–12.1 µs；全拒批 21–25 µs）与逐任务尾部分布（max/p50 1.4–1.6×，tail-cap 9.3–10.9 ms）。R15-B / R16-B 轴不补铸。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片已合入：空枚举，未铸 S17-C-*。切片 `git diff 183df9b..HEAD` 为空。生产中位复核 657.6–689.3 ms（本机 659.9–662.8，仍在 R14-C 带）。三处从未点名位点关闭不铸 ID：NSQRT（IRLS 收敛范数 `Math.sqrt`，8,966 次/报告，独立池 0.21–0.23 ms，约 150× 低于 ±35 ms）、PMV（void 保留的死 `pM`/`pMp` shrink；整份 `fitProbabilityAdditive` ~1.16 ms，零池 memo）、OSTZ（`oneSidedTail(_z)` 死参；生产走 `betaQuantileLcb`，亚 µs）。APC floor 再锚定：ceiling = 池 − floor 全程 < 35 ms；sink=7.309 与 R14-C/R16-C 逐位相同。r1c–r7c 绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / R13–R15 未编号 / **NSQRT / PMV / OSTZ**。基线 `183df9b` 空 diff 再确认。

D 切片已合入：空枚举，未铸 S17-D-*。eval 地板复核配置态 3.57–4.00 ms（成功对照 3.25–3.33，与 R16-D 3.47–3.62 交叠）。本轮新增 fail-closed 拒绝路径普查（28 条终点；最贵拒绝 2.20–2.28 ms，稳态流量为零）。S9-D-4 / S12-D-1 未以任何形态重开。R14-D / R15-D / R16-D 轴不补铸。基线 `82bef36` 空 diff 再确认。

E 切片已合入：空枚举，未铸 S17-E-*。SLICE-CPU 复核 18.5–20.2 µs/run（与 R16-E 19.0–22.0 同带）。本轮新增拒绝路径定价（parse/load/outcomes 全部单数 µs，catch 为防御纵深）与逐事件类价表（`collectSignalsFromEvents` 各类 ns–低 µs，解释历轮夹具构成漂移）。S8-E-1 / S9-E-2 / S13-B-1 未触。R13–R16 轴不补铸。基线 `adb20d7` 空 diff 再确认。

F 切片已合入：空枚举，未铸 S17-F-*。切片 `git diff 519101f..HEAD` 为空（连续第十一轮字节不变）。全实验锚点复核 120.5–129.6 ms（与 R16-F 118.5–133.5 / R15-F 120.7–132.3 重叠）。四次序符号两轮同号为正。本轮新增 fail-closed 拒绝路径普查（142 抛点；最贵拒绝 0.31–0.47 ms，稳态流量为零）、冷进程预算（首实验 +16.8–22.0 ms once-per-process）与操作粒度尾部分布（p50 ~56–58 µs，无悬崖）。r1f/r5f/r6f/r7f 绿（2668 / 224 / 27 / 169）。R16-F 剖析归属 / A 越线点 / 编码格与 R14-F / R15-F 轴不补铸。**S7-F-1 不是 S6-F-5**。基线 `519101f` 空 diff 再确认。

G 切片 = 42 文件：`src/run/` 除 child-tracking.ts / gate-apply.ts（属 A）、`src/supervisor/` 除 model-router.ts（属 B）、`src/graph/`、`src/domain/`。不要重开 S1-G-* … S9-G-3 / S10-G-1 / S11-G-1..3。R12-G…R16-G 空枚举、未铸 ID。禁止去 fsync / 完整性再哈希。计算顶 R16-G：0.288–0.294 ms vs I/O 96.2–105.0 ms。SYSCENSUS / digest `06cbcf92c098c8f0` / R14-G / R15-G 轴不补铸。基线 `4efee23` 预期空 diff。

H 切片 = 21 文件：`src/evaluation/` **8**（不是 9）+ `src/requirement/` 7 + `src/review/` 4 + `src/rubric/` 2。S5-H-1 必须保留。不要重开 S1-H-* … S9-H-2。R10-H…R16-H 空枚举、未铸 ID。热层默认 R16-H：9.35–9.78 µs/run。PATH_RE 回溯形态已候选化后拒列，不补铸；重开仅当 objective 出现程序化/对抗来源，或现实载荷出现 ≥~3.2K 字符无斜杠 `[\w.-]` 段。R14-H / R15-H / R16-H 基底格不补铸。基线 `fd437a9` 预期空 diff。本波派出。

I 切片 = 25 文件：`src/cli/` 13 + `src/pi-adapter/` 9 + `src/config/` 2 + `src/telemetry/` 1。必须站在已落地 S1-I / S4-I / S5-I-1 / S7-I-1。S4-I 淘汰项是 S4-I-2..5（无 S4-I-1）。S8-I-1 两臂文件级 blocked（含 Node 24），不要重开。R9-I…R16-I 八连空，未铸 ID。R16-I flowchart 抽测格与增量采样归因不补铸。R15-I spawn A/A / 引擎代 / 堆足迹不补铸。R13-I 无名微观与 R14-I 肥配置态不补铸。若落地代码：重跑 r4i/r5i/r7i（68 / 119 / 80）+ 新 r17i 仿真。基线 `8dee7fb` 预期空 diff。本波派出。

J 切片 = 29 文件：`src/cluster/` 3 + `src/privacy/` 3 + `src/preferences/` 7 + `src/episode/` 5 + `src/persist/` 2 + `src/track/` 4 + `src/context/` 2 + `src/feedback/` 3。必须站在已落地 J1。S5-J-3 / S6-J-1 / S8-J-2 / J1 钉死。禁止去 fsync。R11-J…R16-J 空枚举、未铸 ID。R16-J SYSCENSUS-J 与 payload 字节形态轴不补铸。R15-J A/A 与引擎代、R14-J 规模越线不补铸。若落地代码：重跑 J1 仿真（2468）+ 新 r17j 仿真。基线 `fb41417` 预期空 diff。
