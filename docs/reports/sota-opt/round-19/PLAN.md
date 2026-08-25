# Round 19 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–18 已对各区做过十八遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S18-* 条目（含已合入的 S13-B-1 与 R12–R18 全部空枚举收口，含刚合入的 R18-A … R18-J / R19-A … R19-J）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。禁止再编号 **FITQ** / **NAMESHAPE**。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R19-A … R19-J），报告写入 `docs/reports/sota-opt/round-19/`。

状态：完成 10/10。A–J 全部合入（空枚举）。无新落地。第 20 轮进行中，见 [round-20/PLAN.md](../round-20/PLAN.md)。

A 切片已合入：空枚举，未铸 S19-A-*。切片 `git diff 7acb666..HEAD` 为空（十九遍零 diff）。预算复核 66–75 µs/run（13.2–15.1 µs/gate，与 R18-A 64–74 同带）。本轮新增 at-least-once 重投递面（GATE_TRANSITION 2926–2959 ns / TRACKING_ASSESSMENT 2834–2882 ns；仓内三调用方均不可达，重投递只降价）与 `wait_user` 指令类补全（7.85–8.57 µs，与 queue_analysis 同带）。R18-A skip-path / 拒绝终点与 R17-A / R16-A / R15-A / R14-A 轴不补铸。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S19-B-*。切片 `git diff 94ed3d9..HEAD` 为空。天花板复核 M=2 8.9–9.3 / M=10 18.4–20.4 / replay 7.05–9.90 / 10× 97.2–108.5 ms/eval（细粒度 live face 47.2–48.9 µs，与 R18-B 同带）。S12-B-2 / S13-B-1 重开条件未触发。本轮新增排序比较器第三腿普查（`id.localeCompare` 在六锚格执行 0 次；退化对 tie-tax 为符号翻转噪声）与目录基数 M 轴（M=100×N=2000 假设 102.6–120.2 ms，生产流量为零；10× 基数仅 ~6×，确认 O(M)）。R18-B 语料字宽/CJK / RoutingLimits 与 R17-B / R16-B / R15-B 轴不补铸。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片已合入：空枚举，未铸 S19-C-*。切片 `git diff 183df9b..HEAD` 为空。生产中位复核 667.5–675.1 ms/报告（对 R18-C 656.7–672.4 在 ±35 内）。本轮新增 **FITQ**（201 次拟合/报告；最坏抽取 4.05–6.67 ms；ITERX 迭代量对账；无胖尾）与 APC 地板复测（ceiling 13.9–24.0 < 35；sink=7.309 逐位相同）。r1c–r7c 绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / TAILG / REJX / **FITQ**。基线 `183df9b` 空 diff 再确认。

D 切片已合入：空枚举，未铸 S19-D-*。切片 `git diff 82bef36..HEAD` 为空。eval 地板复核配置态 3.85–4.22 ms（与 R18-D 3.75–4.14 交叠）。S9-D-4 / S12-D-1 未以任何形态重开。本轮新增冷进程模块图组成（`adapt status` 墙时 61.4–61.6 ms 中 ~99% 为 boot+import；D 可归因 ≤ ~4 ms once-per-CLI，属拒绝的一次-per-run 类）。R18-D 锁定事务组成账目与 R17-D / R16-D / R15-D / R14-D 轴不补铸。基线 `82bef36` 空 diff 再确认。

E 切片已合入：空枚举，未铸 S19-E-*。切片 `git diff adb20d7..HEAD` 为空。SLICE-CPU 本夹具 19.0–20.6 µs/run；R17-E 种子复现 18.5–19.7（落入 18.5–20.2）。本轮新增输入表示/来源保真（JSON.parse 暖态与生成器夹具持平或更便宜；首触 +4.9–7.8 µs once-per-process）与事件排序置换（collect 0.40–0.61 µs；route-before-result 是语义契约）。S8-E-1 / S9-E-2 / S13-B-1 未触。R18-E 冷层 / CJK 与 R17-E / R16-E 轴不补铸。基线 `adb20d7` 空 diff 再确认。

F 切片已合入：空枚举，未铸 S19-F-*。切片 `git diff 519101f..HEAD` 为空（连续第十三轮字节不变）。全实验锚点复核 120.4–130.2 ms（与 R18-F 120.8–129.1 重叠）。本轮新增 runner 家族完备性（canary 全实验 113.6–116.3 vs shadow 115.6–118.1；第二宿主四次序同构；形状污染净效应 −2.1/−2.3 ms 与零不可分）。**S7-F-1 不是 S6-F-5**。R18-F 剂量 / 暖计划税 / halt 后路径与 R17-F / R16-F / R15-F / R14-F 轴不补铸。基线 `519101f` 空 diff 再确认。

G 切片已合入：空枚举，未铸 S19-G-*（连续第八次）。切片 `git diff 4efee23..HEAD` 为空。计算顶复核 0.292–0.296 ms vs I/O 94.9–108.2 ms。digest `06cbcf92c098c8f0` 第十次逐位相同。本轮新增 **NAMESHAPE**（路径深度/组件长度/扇出；生产份额 0.04–0.24 ms；拍平布局上界 0.048–0.095 ms）。禁止去 fsync / 完整性再哈希。BYTESHAPE / 存储后端 / 拒绝路径 / SYSCENSUS / digest / R14-G / R15-G 轴不补铸。基线 `4efee23` 空 diff 再确认。

H 切片已合入：空枚举，未铸 S19-H-*。切片 `git diff fd437a9..HEAD` 为空（十九遍零 diff）。热层默认复核 9.53–10.39 µs/run（与 R18-H 9.40–9.55 / R17-H 9.17–10.18 交叠）。S5-H-1 字节级维持。本轮新增执行史剂量响应与平稳性普查（冷首呼 1670–1728 µs；瞬态积分 17.8–27.2 ms 为一次-per-process 且生产流量为零；隔离协议无悬崖；10×3000-rep 窗沉降后漂移 <0.5%）。R18-H 休眠分支普查与 R17-H / R16-H / R15-H / R14-H 轴不补铸。基线 `fd437a9` 空 diff 再确认。

I 切片已合入：空枚举，未铸 S19-I-*（十一连空）。切片 `git diff 8dee7fb..HEAD` 为空（连续第十二轮字节不变）。custom−builtin 复核 children +47.6/+26.4、track +48.4/+23.9 ms（十二轮同构）。S8-I-1 重开条件第七次直接测量仍未满足。本轮新增配置输入基数轴（E×P×K；parse 全网格亚 ms；resolve ~0.065–0.075 ms/enabled，10 ms 越线 E≈130–160；生产个位数）。R18-I children-spec 基数与 R17-I / R16-I / R15-I / R14-I / R13-I 轴不补铸。基线 `8dee7fb` 空 diff 再确认。

J 切片已合入：空枚举，未铸 S19-J-*。切片 `git diff fb41417..HEAD` 为空（J1 以来十八遍零后续代码）。I/O 地板复核 save 137.1–555.5 µs；jsonl 66.2–101.2 / 353.4–479.8 µs；级联 664.2–987.4 / 284.6–375.7 µs；index 40.3–40.7 µs；plan 1.03–2.71 µs（I/O 支配第十九次成立）。J1 仿真 2468 项绿。本轮新增至少一次重投递/重复剂量（deleteEpisodeRecords 再执行 778.3–1164.5 µs；appendFeedback 去重反事实 ~3.4×）与输入次序置换（cascade 无位置悬崖；evaluatePreferenceLoop ~2.3× 但零生产调用方）。S5-J-3 / S6-J-1 / S8-J-2 / J1 原样。R18-J skip-path / 命令组合与 R17-J / R16-J / R15-J / R14-J 轴不补铸。基线 `fb41417` 空 diff 再确认。
