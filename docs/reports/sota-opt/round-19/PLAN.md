# Round 19 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–18 已对各区做过十八遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S18-* 条目（含已合入的 S13-B-1 与 R12–R18 全部空枚举收口，含刚合入的 R18-A … R18-J / R19-A / R19-B / R19-C / R19-D / R19-E / R19-H）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。禁止再编号 **FITQ**。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R19-A … R19-J），报告写入 `docs/reports/sota-opt/round-19/`。

状态：第 4 波 I 本波派出。A/B/C/D/E/H 已合入（空枚举）。F/G 运行中。Round 18 已收口 10/10。

A 切片已合入：空枚举，未铸 S19-A-*。切片 `git diff 7acb666..HEAD` 为空（十九遍零 diff）。预算复核 66–75 µs/run（13.2–15.1 µs/gate，与 R18-A 64–74 同带）。本轮新增 at-least-once 重投递面（GATE_TRANSITION 2926–2959 ns / TRACKING_ASSESSMENT 2834–2882 ns；仓内三调用方均不可达，重投递只降价）与 `wait_user` 指令类补全（7.85–8.57 µs，与 queue_analysis 同带）。R18-A skip-path / 拒绝终点与 R17-A / R16-A / R15-A / R14-A 轴不补铸。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S19-B-*。切片 `git diff 94ed3d9..HEAD` 为空。天花板复核 M=2 8.9–9.3 / M=10 18.4–20.4 / replay 7.05–9.90 / 10× 97.2–108.5 ms/eval（细粒度 live face 47.2–48.9 µs，与 R18-B 同带）。S12-B-2 / S13-B-1 重开条件未触发。本轮新增排序比较器第三腿普查（`id.localeCompare` 在六锚格执行 0 次；退化对 tie-tax 为符号翻转噪声）与目录基数 M 轴（M=100×N=2000 假设 102.6–120.2 ms，生产流量为零；10× 基数仅 ~6×，确认 O(M)）。R18-B 语料字宽/CJK / RoutingLimits 与 R17-B / R16-B / R15-B 轴不补铸。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片已合入：空枚举，未铸 S19-C-*。切片 `git diff 183df9b..HEAD` 为空。生产中位复核 667.5–675.1 ms/报告（对 R18-C 656.7–672.4 在 ±35 内）。本轮新增 **FITQ**（201 次拟合/报告；最坏抽取 4.05–6.67 ms；ITERX 迭代量对账；无胖尾）与 APC 地板复测（ceiling 13.9–24.0 < 35；sink=7.309 逐位相同）。r1c–r7c 绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / TAILG / REJX / **FITQ**。基线 `183df9b` 空 diff 再确认。

D 切片已合入：空枚举，未铸 S19-D-*。切片 `git diff 82bef36..HEAD` 为空。eval 地板复核配置态 3.85–4.22 ms（与 R18-D 3.75–4.14 交叠）。S9-D-4 / S12-D-1 未以任何形态重开。本轮新增冷进程模块图组成（`adapt status` 墙时 61.4–61.6 ms 中 ~99% 为 boot+import；D 可归因 ≤ ~4 ms once-per-CLI，属拒绝的一次-per-run 类）。R18-D 锁定事务组成账目与 R17-D / R16-D / R15-D / R14-D 轴不补铸。基线 `82bef36` 空 diff 再确认。

E 切片已合入：空枚举，未铸 S19-E-*。切片 `git diff adb20d7..HEAD` 为空。SLICE-CPU 本夹具 19.0–20.6 µs/run；R17-E 种子复现 18.5–19.7（落入 18.5–20.2）。本轮新增输入表示/来源保真（JSON.parse 暖态与生成器夹具持平或更便宜；首触 +4.9–7.8 µs once-per-process）与事件排序置换（collect 0.40–0.61 µs；route-before-result 是语义契约）。S8-E-1 / S9-E-2 / S13-B-1 未触。R18-E 冷层 / CJK 与 R17-E / R16-E 轴不补铸。基线 `adb20d7` 空 diff 再确认。

F 切片 = `src/experiments/` 15 文件。必须站在已落地 S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2。**S7-F-1 不是 S6-F-5**。R10-F…R18-F 空枚举、未铸 ID。全实验锚点复核 R18-F：120.8–129.1 ms。R18-F 对齐分数剂量 / 热进程税 / halt 后定价不补铸。R17-F 拒绝路径 / 冷进程 / 尾部与 R16-F / R15-F / R14-F 轴不补铸。若落地代码：重跑 r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）+ 新 r19f 仿真。基线 `519101f` 预期空 diff。运行中。

G 切片 = 42 文件：`src/run/` 除 child-tracking.ts / gate-apply.ts（属 A）、`src/supervisor/` 除 model-router.ts（属 B）、`src/graph/`、`src/domain/`。不要重开 S1-G-* … S9-G-3 / S10-G-1 / S11-G-1..3。R12-G…R18-G 空枚举、未铸 ID。禁止去 fsync / 完整性再哈希。计算顶 R18-G：0.290–0.299 ms vs I/O 94.4–110.7 ms。digest `06cbcf92c098c8f0` 第九次逐位相同。存储后端分解 / 拒绝路径定价 / SYSCENSUS / digest / R14-G / R15-G / **BYTESHAPE** 轴不补铸。基线 `4efee23` 预期空 diff。本波派出。

H 切片已合入：空枚举，未铸 S19-H-*。切片 `git diff fd437a9..HEAD` 为空（十九遍零 diff）。热层默认复核 9.53–10.39 µs/run（与 R18-H 9.40–9.55 / R17-H 9.17–10.18 交叠）。S5-H-1 字节级维持。本轮新增执行史剂量响应与平稳性普查（冷首呼 1670–1728 µs；瞬态积分 17.8–27.2 ms 为一次-per-process 且生产流量为零；隔离协议无悬崖；10×3000-rep 窗沉降后漂移 <0.5%）。R18-H 休眠分支普查与 R17-H / R16-H / R15-H / R14-H 轴不补铸。基线 `fd437a9` 空 diff 再确认。

I 切片 = 25 文件：`src/cli/` 13 + `src/pi-adapter/` 9 + `src/config/` 2 + `src/telemetry/` 1。必须站在已落地 S1-I / S4-I / S5-I-1 / S7-I-1。S4-I 淘汰项是 S4-I-2..5（无 S4-I-1）。S8-I-1 两臂文件级 blocked（含 Node 24），不要重开。R9-I…R18-I 十连空，未铸 ID。R18-I children-spec 基数轴不补铸。R17-I fail-closed 拒绝路径定价不补铸。R16-I flowchart 抽测格与增量采样归因不补铸。R15-I spawn A/A / 引擎代 / 堆足迹不补铸。R13-I 无名微观与 R14-I 肥配置态不补铸。若落地代码：重跑 r4i/r5i/r7i（68 / 119 / 80）+ 新 r19i 仿真。基线 `8dee7fb` 预期空 diff。本波派出。

J 切片 = 29 文件：`src/cluster/` 3 + `src/privacy/` 3 + `src/preferences/` 7 + `src/episode/` 5 + `src/persist/` 2 + `src/track/` 4 + `src/context/` 2 + `src/feedback/` 3。必须站在已落地 J1。S5-J-3 / S6-J-1 / S8-J-2 / J1 钉死。禁止去 fsync。R11-J…R18-J 空枚举、未铸 ID。R18-J skip-path 普查与整命令事务组成账目不补铸。R17-J fail-closed 拒绝路径普查与冷进程预算不补铸。R16-J SYSCENSUS-J 与 payload 字节形态轴不补铸。R15-J A/A 与引擎代、R14-J 规模越线不补铸。R18-G BYTESHAPE 不要移植到 J。若落地代码：重跑 J1 仿真（2468）+ 新 r19j 仿真。基线 `fb41417` 预期空 diff。
