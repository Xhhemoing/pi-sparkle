# Round 12 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–11 已对各区做过十一遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S11-* 条目以及已合入的 S12-B-1..2 / S12-D-1..2（含 R9-I / R10-E / R10-F / R10-H / R10-I / R10-J / R11-C / R11-E / R11-F / R11-H / R11-I / R11-J / R12-A 的空枚举收口与已合入的 S11-A-1..2 / S11-B-1 / S11-D-1..2 / S11-G-1..3）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R12-A … R12-J），报告写入 `docs/reports/sota-opt/round-12/`。

状态：第 2 波 F 本波派出；A/B/D 已合入（A 空枚举；B 铸 S12-B-1..2；D 铸 S12-D-1..2，均淘汰）；C/E 运行中。

C 切片 = 离线路由 `src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`。必须站在已落地 S7-C 之上，不得另起平行实现。不要重开 S1-C-1..10 / S2-C-1..5 / S3-C-1..3 / S4-C-1..6 / S5-C-1..7 / S6-C-1..7 / S7-C-1..4 / S8-C-1..4 / S9-C-1..4 / S10-C-1..3。R11-C 空枚举、未铸 S11-C-*。噪声带 ±35 ms；贴带不越带。S10-C-3 对称 Schur 镜像理论否决。RID/CNT 归约重排已用反例探针封死。r1c–r7c 回归门必须保持绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。最后生产改动仍为 `183df9b`。

B 切片已合入：S12-B-1（allowed 反索引，与 S11-B-1 互为肥目录镜像）/ S12-B-2（prior family 批内记忆化；真实规模 0.08–0.19ms，条件式落地物，重开条件即落地条件：任何 N≥10³ 调用方传 prior）。天花板复核 M=2 11.7–12.0 ms、M=10 19.1–19.7 ms。prior≠undefined 假设 N=2000 为 37.8–80.0 ms/eval，今日零流量。不要重开 S12-B-1..2 / S11-B-1 / S10-B-1..3。Live = R0。

E 切片 = `src/learning/` 全部 10 文件。不要重开 S1-E-1..8 / S2-E-1..7 / S3-E-1..5 / S4-E-1..3 / S5-E-1..5 / S6-E-1..5 / S7-E-1..5 / S8-E-1..3 / S9-E-1..3。R10-E 与 R11-E 空枚举、未铸 ID。SLICE-CPU ~11–24 µs/run（R11-E 17.2–17.6）。S9-E-2 为负优化。S8-E-1 双载入不得去重。基线 `adb20d7` 预期空 diff。

A 切片已合入：空枚举，未铸 S12-A-*。预算复核 70–92 µs/run。合同地板分解：hashAssessment 约 42%、validateEvent 约 21%、O(E) 扫描合计约 1.6%。S11-A-1..2 维持。

D 切片已合入：S12-D-1（边界闸 JSON.parse 预探针省略；健全形态 9.1–10.4µs once-per-command；便宜形态 U+ 转义键 fail-open，S9-D-4 同族）/ S12-D-2（eval 回放链四遍融两遍；E=200 双形态稳定负优化）。eval 地板复核 3.72–4.07 ms。不要重开 S12-D-1..2 / S11-D-1..2 / S10-D-1..2 / S9-D-4。禁止去 fsync / 完整性再哈希。

F 切片 = `src/experiments/` 全部 15 文件。必须站在已落地 S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2 之上。不要重开 S1-F-1..8 / S2-F-* / S3-F-* / S4-F-* / S5-F-* / S6-F-* / S7-F-1..2 / S8-F-1..3 / S9-F-1..3。S7-F-1 不是 S6-F-5（禁止 O(P) two-pointer）。S9-F-3 scratch-Set 稳定负优化。R10-F 与 R11-F 空枚举、未铸 ID。全实验锚点 ~120–126 ms；`outcomes.some` 记账为 1.63–1.73 ms（S1-F-8）。基线 `519101f` 预期空 diff。
