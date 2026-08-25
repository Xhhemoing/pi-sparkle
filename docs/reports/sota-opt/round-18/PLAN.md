# Round 18 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–17 已对各区做过十七遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S17-* 条目（含已合入的 S13-B-1 与 R12–R17 全部空枚举收口，含刚合入的 R17-A … R17-J / R18-A / R18-B / R18-D / R18-E / R18-F）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R18-A … R18-J），报告写入 `docs/reports/sota-opt/round-18/`。

状态：第 3 波 H 本波派出；C/G 运行中。A/B/D/E/F 已合入（空枚举）。Round 17 已收口 10/10。

A 切片已合入：空枚举，未铸 S18-A-*。切片 `git diff 7acb666..HEAD` 为空（十八遍零 diff）。预算复核 64–74 µs/run（12.7–14.8 µs/gate，与 R17-A 65–74 同带）。本轮新增 skip-path 组成定价（五类 apply:false 272–1712 ns，全 apply 锚点即上界）与 fail-closed 拒绝终点普查（28 抛点；代表拒绝 8.9–13.3 µs once-per-fault）。R17-A 事件表组成 / 冷进程预算与 R16-A / R15-A / R14-A 轴不补铸。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S18-B-*。切片 `git diff 94ed3d9..HEAD` 为空。天花板复核 M=2 8.9–9.4 / M=10 18.3–18.5 / replay 6.96–7.12 / 10× 94.8–105.0 ms/eval（细粒度 live face 47.5–49.2 µs）。本轮新增语料字宽 + CJK 种群（M=10 全 CJK 15.5–16.7 ms，低于 ASCII 锚点）与有限 `RoutingLimits` 配置态（十七轮预算/截止分支零执行；假设 N=2000 双压 29.05–30.38 ms 但生产流量为零）。S12-B-2 / S13-B-1 重开条件未触发。R17-B 拒绝路径 / 尾部分布与 R16-B / R15-B 轴不补铸。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片 = 离线路由 9 文件：`src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`。必须站在已落地 S1-C / S2-C / S3-C / S4-C / S5-C / S6-C / S7-C。不要另起平行 S7-C。R11-C…R17-C 空枚举、未铸 ID。生产中位 R17-C：657.6–689.3 ms/报告（本机 659.9–662.8）；落地线 ±35 ms。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ 与 R13–R16 无名微观。若落地代码：重跑 r1c–r7c（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）+ 新 r18c 仿真。基线 `183df9b` 预期空 diff。

D 切片已合入：空枚举，未铸 S18-D-*。切片 `git diff 82bef36..HEAD` 为空。eval 地板复核配置态 3.75–4.14 ms（与 R17-D 3.57–4.00 交叠）。本轮新增锁定事务组成账目（promote 整事务 2.67–2.94 / rollback 2.38–2.60 / lock glue 199.6–239.1 µs；无隐藏段；清零胶水 ≤ ~0.44 ms 亚线）。S9-D-4 / S12-D-1 未以任何形态重开。R17-D 拒绝路径普查与 R16-D / R15-D / R14-D 轴不补铸。基线 `82bef36` 空 diff 再确认。

E 切片已合入：空枚举，未铸 S18-E-*。切片 `git diff adb20d7..HEAD` 为空。SLICE-CPU 本夹具 12.4–14.8 µs/run；R17-E 种子复现 18.8–19.4（落入 R17-E 18.5–20.2）。本轮新增冷层/一次-per-process 定价（生产面冷复合 2.23–2.50 ms，仍亚线）与 CJK/字宽语料（CJK 每字符比 ASCII 便宜 2.4–3.1×）。S8-E-1 / S9-E-2 / S13-B-1 未触。R17-E 拒绝路径 / 事件类价表与 R16-E / R13–R15 轴不补铸。基线 `adb20d7` 空 diff 再确认。

F 切片已合入：空枚举，未铸 S18-F-*。切片 `git diff 519101f..HEAD` 为空（连续第十二轮字节不变）。全实验锚点复核 120.8–129.1 ms（与 R17-F 120.5–129.6 重叠）。四次序符号两轮同号为正。本轮新增 S7-F-1 对齐分数剂量反应（f≥2/16 单调为正；f*≈6–12%）、fresh-plan 热进程税（validate 49.6–51.5 µs / 实验 1.76 ms）与 halt 后操作定价（~51 µs 地板，生产流量为零）。r1f/r5f/r6f/r7f 绿（2668 / 224 / 27 / 169）。R17-F 拒绝路径 / 冷进程 / 尾部与 R16-F / R15-F / R14-F 轴不补铸。**S7-F-1 不是 S6-F-5**。基线 `519101f` 空 diff 再确认。

G 切片 = 42 文件：`src/run/` 除 child-tracking.ts / gate-apply.ts（属 A）、`src/supervisor/` 除 model-router.ts（属 B）、`src/graph/`、`src/domain/`。不要重开 S1-G-* … S9-G-3 / S10-G-1 / S11-G-1..3。R12-G…R17-G 空枚举、未铸 ID。禁止去 fsync / 完整性再哈希。计算顶 R17-G：0.287–0.295 ms vs I/O 95.8–98.4 ms。存储后端分解（物理上限 6.0–7.4 ms，需易失存储）/ 拒绝路径定价 / SYSCENSUS / digest `06cbcf92c098c8f0` / R14-G / R15-G 轴不补铸。基线 `4efee23` 预期空 diff。

H 切片 = 21 文件：`src/evaluation/` **8**（不是 9）+ `src/requirement/` 7 + `src/review/` 4 + `src/rubric/` 2。S5-H-1 必须保留。不要重开 S1-H-* … S9-H-2。R10-H…R17-H 空枚举、未铸 ID。热层默认 R17-H：9.17–10.18 µs/run。R17-H fail-closed 拒绝路径普查不补铸。PATH_RE 回溯形态已候选化后拒列，不补铸；重开仅当 objective 出现程序化/对抗来源，或现实载荷出现 ≥~3.2K 字符无斜杠 `[\w.-]` 段。R14-H / R15-H / R16-H 基底格不补铸。基线 `fd437a9` 预期空 diff。本波派出。

I 切片 = 25 文件：`src/cli/` 13 + `src/pi-adapter/` 9 + `src/config/` 2 + `src/telemetry/` 1。必须站在已落地 S1-I / S4-I / S5-I-1 / S7-I-1。S4-I 淘汰项是 S4-I-2..5（无 S4-I-1）。S8-I-1 两臂文件级 blocked（含 Node 24），不要重开。R9-I…R17-I 九连空，未铸 ID。R17-I fail-closed 拒绝路径定价不补铸。R16-I flowchart 抽测格与增量采样归因不补铸。R15-I spawn A/A / 引擎代 / 堆足迹不补铸。R13-I 无名微观与 R14-I 肥配置态不补铸。若落地代码：重跑 r4i/r5i/r7i（68 / 119 / 80）+ 新 r18i 仿真。基线 `8dee7fb` 预期空 diff。

J 切片 = 29 文件：`src/cluster/` 3 + `src/privacy/` 3 + `src/preferences/` 7 + `src/episode/` 5 + `src/persist/` 2 + `src/track/` 4 + `src/context/` 2 + `src/feedback/` 3。必须站在已落地 J1。S5-J-3 / S6-J-1 / S8-J-2 / J1 钉死。禁止去 fsync。R11-J…R17-J 空枚举、未铸 ID。R17-J fail-closed 拒绝路径普查与冷进程预算不补铸。R16-J SYSCENSUS-J 与 payload 字节形态轴不补铸。R15-J A/A 与引擎代、R14-J 规模越线不补铸。若落地代码：重跑 J1 仿真（2468）+ 新 r18j 仿真。基线 `fb41417` 预期空 diff。
