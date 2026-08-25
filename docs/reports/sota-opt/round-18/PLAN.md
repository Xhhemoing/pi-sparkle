# Round 18 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–17 已对各区做过十七遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S17-* 条目（含已合入的 S13-B-1 与 R12–R17 全部空枚举收口，含刚合入的 R17-A … R17-J / R18-A … R18-I）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R18-A … R18-J），报告写入 `docs/reports/sota-opt/round-18/`。

状态：第 4 波收口中。A–I 已合入（空枚举）；J 运行中。第 19 轮已开，见 [round-19/PLAN.md](../round-19/PLAN.md)。

A 切片已合入：空枚举，未铸 S18-A-*。切片 `git diff 7acb666..HEAD` 为空（十八遍零 diff）。预算复核 64–74 µs/run（12.7–14.8 µs/gate，与 R17-A 65–74 同带）。本轮新增 skip-path 组成定价（五类 apply:false 272–1712 ns，全 apply 锚点即上界）与 fail-closed 拒绝终点普查（28 抛点；代表拒绝 8.9–13.3 µs once-per-fault）。R17-A 事件表组成 / 冷进程预算与 R16-A / R15-A / R14-A 轴不补铸。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S18-B-*。切片 `git diff 94ed3d9..HEAD` 为空。天花板复核 M=2 8.9–9.4 / M=10 18.3–18.5 / replay 6.96–7.12 / 10× 94.8–105.0 ms/eval（细粒度 live face 47.5–49.2 µs）。本轮新增语料字宽 + CJK 种群（M=10 全 CJK 15.5–16.7 ms，低于 ASCII 锚点）与有限 `RoutingLimits` 配置态（十七轮预算/截止分支零执行；假设 N=2000 双压 29.05–30.38 ms 但生产流量为零）。S12-B-2 / S13-B-1 重开条件未触发。R17-B 拒绝路径 / 尾部分布与 R16-B / R15-B 轴不补铸。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片已合入：空枚举，未铸 S18-C-*。切片 `git diff 183df9b..HEAD` 为空。生产中位复核 656.7 / 664.6 / 672.4 ms/报告（对 R17-C 带 657.6–689.3：A/B 带内，C 低 0.9 ms / 0.14%，判 VM 抖动贴下沿，非回归）。本轮新增 TAILG（`fitLogitAdditive` 终效应环三重卫，零池 memo）与 REJX（31 条 fail-closed 拒绝终点首次普查：15 throw + 16 值终点；once-per-fault，除 <20-draws 尾门 20.6–20.7 ms 外均 0.11–8.5 µs）。APC floor 再锚定：ceiling 12.1–20.9 ms < 35；sink=7.309 与 R14-C/R16-C/R17-C 逐位相同。r1c–r7c 绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / **TAILG / REJX**。基线 `183df9b` 空 diff 再确认。

D 切片已合入：空枚举，未铸 S18-D-*。切片 `git diff 82bef36..HEAD` 为空。eval 地板复核配置态 3.75–4.14 ms（与 R17-D 3.57–4.00 交叠）。本轮新增锁定事务组成账目（promote 整事务 2.67–2.94 / rollback 2.38–2.60 / lock glue 199.6–239.1 µs；无隐藏段；清零胶水 ≤ ~0.44 ms 亚线）。S9-D-4 / S12-D-1 未以任何形态重开。R17-D 拒绝路径普查与 R16-D / R15-D / R14-D 轴不补铸。基线 `82bef36` 空 diff 再确认。

E 切片已合入：空枚举，未铸 S18-E-*。切片 `git diff adb20d7..HEAD` 为空。SLICE-CPU 本夹具 12.4–14.8 µs/run；R17-E 种子复现 18.8–19.4（落入 R17-E 18.5–20.2）。本轮新增冷层/一次-per-process 定价（生产面冷复合 2.23–2.50 ms，仍亚线）与 CJK/字宽语料（CJK 每字符比 ASCII 便宜 2.4–3.1×）。S8-E-1 / S9-E-2 / S13-B-1 未触。R17-E 拒绝路径 / 事件类价表与 R16-E / R13–R15 轴不补铸。基线 `adb20d7` 空 diff 再确认。

F 切片已合入：空枚举，未铸 S18-F-*。切片 `git diff 519101f..HEAD` 为空（连续第十二轮字节不变）。全实验锚点复核 120.8–129.1 ms（与 R17-F 120.5–129.6 重叠）。四次序符号两轮同号为正。本轮新增 S7-F-1 对齐分数剂量反应（f≥2/16 单调为正；f*≈6–12%）、fresh-plan 热进程税（validate 49.6–51.5 µs / 实验 1.76 ms）与 halt 后操作定价（~51 µs 地板，生产流量为零）。r1f/r5f/r6f/r7f 绿（2668 / 224 / 27 / 169）。R17-F 拒绝路径 / 冷进程 / 尾部与 R16-F / R15-F / R14-F 轴不补铸。**S7-F-1 不是 S6-F-5**。基线 `519101f` 空 diff 再确认。

G 切片已合入：空枚举，未铸 S18-G-*（连续第七次）。切片 `git diff 4efee23..HEAD` 为空。计算顶复核 0.290–0.299 ms vs I/O 94.4–110.7 ms（~316–382×，与 R17-G 0.287–0.295 vs 95.8–98.4 同带）。digest `06cbcf92c098c8f0` 第九次逐位相同。本轮新增 BYTESHAPE（I/O 地板载荷字节形态 × 字宽分解：固定/op 即整份重锚地板 94.9–112.8 ms；每字节顶 16.9–18.6 ms 需删 run 历史；CJK/emoji 与 ASCII 写价逐字节相同）。禁止去 fsync / 完整性再哈希。存储后端分解 / 拒绝路径定价 / SYSCENSUS / digest / R14-G / R15-G / **BYTESHAPE** 轴不补铸。基线 `4efee23` 空 diff 再确认。

H 切片已合入：空枚举，未铸 S18-H-*。切片 `git diff fd437a9..HEAD` 为空（十八遍零 diff）。热层默认复核 9.40–9.55 µs/run（落入 R17-H 9.17–10.18）。配置态 A 6.9–8.4 / B 3.9–4.7 µs，三次均低于默认（无悬崖）。S5-H-1 字节级维持。PATH_RE 回溯重开条件未触发。本轮新增生产可达休眠分支普查（27×7=189 格 2.3–7.3 µs；8 个命名休眠态 12 ns–4.9 µs，全低于默认锚点）。R17-H 拒绝路径普查与 R16-H / R15-H / R14-H 轴不补铸。基线 `fd437a9` 空 diff 再确认。

I 切片已合入：空枚举，未铸 S18-I-*（十连空）。切片 `git diff 8dee7fb..HEAD` 为空（连续第十一轮字节不变）。custom−builtin 复核 children +49.5/+26.4、track +55.2/+25.0 ms（十一轮同构）。S8-I-1 重开条件第六次直接测量仍未满足。本轮新增 children-spec 基数轴（C=10/50 边际 ~4.5–7.6 ms/child，片内可归因总量在 C=50 仅 0.25 ms；S1-I-3 二次扫描 10 ms 越线 C≈2400，三量级高于生产个位数）。r4i/r5i/r7i 绿（68 / 119 / 80）。R17-I 拒绝路径与 R16-I / R15-I / R14-I / R13-I 轴不补铸。基线 `8dee7fb` 空 diff 再确认。

J 切片 = 29 文件：`src/cluster/` 3 + `src/privacy/` 3 + `src/preferences/` 7 + `src/episode/` 5 + `src/persist/` 2 + `src/track/` 4 + `src/context/` 2 + `src/feedback/` 3。必须站在已落地 J1。S5-J-3 / S6-J-1 / S8-J-2 / J1 钉死。禁止去 fsync。R11-J…R17-J 空枚举、未铸 ID。R17-J fail-closed 拒绝路径普查与冷进程预算不补铸。R16-J SYSCENSUS-J 与 payload 字节形态轴不补铸。R15-J A/A 与引擎代、R14-J 规模越线不补铸。若落地代码：重跑 J1 仿真（2468）+ 新 r18j 仿真。基线 `fb41417` 预期空 diff。运行中。
