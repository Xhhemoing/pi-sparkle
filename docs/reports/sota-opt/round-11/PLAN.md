# Round 11 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–10 已对各区做过十遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S10-* 条目（含 R9-I / R10-E / R10-F / R10-H / R10-I / R10-J / R11-E 的空枚举收口与 S9-J-1..4 / S10-A-1 / S10-B-1..3 / S10-C-1..3 / S10-D-1..2 / S10-G-1）以及已合入的 S11-A-1..2 / S11-B-1。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R11-A … R11-J），报告写入 `docs/reports/sota-opt/round-11/`。

状态：第 2 波 F 本波派出；A/B/E 已合入（S11-A-1..2 / S11-B-1 淘汰；R11-E 空枚举未铸 ID）；C/D 运行中。C 切片 = 离线路由 `src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`。必须站在已落地 S7-C 之上，不得另起平行实现。不要重开 S1-C-1..10 / S2-C-1..5 / S3-C-1..3 / S4-C-1..6 / S5-C-1..7 / S6-C-1..7 / S7-C-1..4 / S8-C-1..4 / S9-C-1..4 / S10-C-1..3。噪声带 ±35 ms；贴带不越带。S10-C-3 对称 Schur 镜像理论否决。r1c–r7c 回归门必须保持绿。

D 切片 = `src/adaptation/` 全部 14 文件。不要重开 S1-D-1..9 / S2-D-1..5 / S3-D-1..5 / S4-D-1..5 / S5-D-1..5 / S6-D-1..5 / S7-D-1..5 / S8-D-1..5 / S9-D-1..4 / S10-D-1..2。禁止去 fsync / 完整性再哈希。S9-D-4 便宜 toLowerCase 形态永不重开（U+212A fail-open）。S10-D-1 mkdir 省略与 S10-D-2 跳过第二次 assignTasks 已闭合。基线 `82bef36` 预期空 diff。eval 地板 ~4–5 ms。

E 切片已合入：空枚举，未铸 S11-E-*。SLICE-CPU 本轮复核 17.2–17.6 µs/run。S8-E-1 双载入与 S9-E-2 负优化维持。

F 切片 = `src/experiments/` 全部 15 文件。站在 S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2 之上。不要重开 S1-F-1..8 / S2-F-1..6 / S3-F-1..5 / S4-F-1..3 / S5-F-1..3 / S6-F-2..5 / S7-F-3..4 / S8-F-1..3 / S9-F-1..3。R10-F 空枚举、未铸 S10-F-*。S7-F-1 不是 S6-F-5。S9-F-3 scratch-Set 是稳定负优化。全实验锚点 ~120–126 ms，validate 契约本体约占 83%。基线 `519101f` 预期 `src/experiments/` 空 diff。
