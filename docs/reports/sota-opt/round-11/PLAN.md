# Round 11 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–10 已对各区做过十遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S10-* 条目（含 R9-I / R10-E / R10-F / R10-H / R10-I / R10-J / R11-C / R11-E 的空枚举收口与 S9-J-1..4 / S10-A-1 / S10-B-1..3 / S10-C-1..3 / S10-D-1..2 / S10-G-1）以及已合入的 S11-A-1..2 / S11-B-1 / S11-D-1..2。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R11-A … R11-J），报告写入 `docs/reports/sota-opt/round-11/`。

状态：第 3 波 H 本波派出；A/B/C/D/E 已合入（S11-A-1..2 / S11-B-1 / S11-D-1..2 淘汰；R11-C / R11-E 空枚举未铸 ID）；F/G 运行中。C 切片已合入：空枚举，未铸 S11-C-*。必须站在已落地 S7-C 之上，不得另起平行实现。噪声带 ±35 ms；贴带不越带。S10-C-3 对称 Schur 镜像理论否决。r1c–r7c 回归门绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。RID/CNT 归约重排已用反例探针封死，禁止重铸。

D 切片已合入：S11-D-1..2 淘汰。eval 地板复核 3.58–4.41 ms。禁止去 fsync / 完整性再哈希。S9-D-4 便宜形态永不重开。

E 切片已合入：空枚举，未铸 S11-E-*。SLICE-CPU 本轮复核 17.2–17.6 µs/run。S8-E-1 双载入与 S9-E-2 负优化维持。

F 切片 = `src/experiments/` 全部 15 文件。站在 S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2 之上。不要重开 S1-F-1..8 / S2-F-1..6 / S3-F-1..5 / S4-F-1..3 / S5-F-1..3 / S6-F-2..5 / S7-F-3..4 / S8-F-1..3 / S9-F-1..3。R10-F 空枚举、未铸 S10-F-*。S7-F-1 不是 S6-F-5。S9-F-3 scratch-Set 是稳定负优化。全实验锚点 ~120–126 ms，validate 契约本体约占 83%。基线 `519101f` 预期 `src/experiments/` 空 diff。

G 切片 = 42 文件：`src/run/` 除 child-tracking/gate-apply 外 17；`src/supervisor/` 除 model-router 外 4；`src/graph/` 全部 4；`src/domain/` 全部 17。不要重开 S1-G-1..9 / S2-G-1..8 / S3-G-1..5 / S4-G-1..7 / S5-G-1..6 / S6-G-1..7 / S7-G-1..5 / S8-G-1..2 / S9-G-1..3 / S10-G-1。完成延迟方向已被 S10-G-1 全局关闭。禁止去 fsync（S9-G-3）或免除 loadLearnedRouting（S9-G-1）。S7-G-5 resume 读读并行已关。S1-G-1 事件镜像/增量缓存已关。S4-G-6 checkpoint 紧凑序列化已关。计算顶 ~0.29 ms vs I/O 地板 ~98–107 ms。基线 `4efee23` 预期空 diff。

H 切片 = 21 文件：`src/evaluation/` 8、`src/requirement/` 7、`src/review/` 4、`src/rubric/` 2。不要重开 S1-H-1..9 / S2-H-1..7 / S3-H-1..4 / S4-H-1..3 / S5-H-1..3 / S6-H-1..4 / S7-H-1..3 / S8-H-1..3 / S9-H-1..2。R10-H 空枚举、未铸 S10-H-*。S5-H-1 `detectConflicts` 预分配守卫必须保留。S8-H-3 全决议快路径永不重开（default:"" / options:[""] fail-open）。配置态仍低于默认态（~4–9 µs vs ~10 µs）。基线 `fd437a9` 预期空 diff。
