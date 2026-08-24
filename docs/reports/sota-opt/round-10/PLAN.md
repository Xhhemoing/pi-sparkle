# Round 10 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–9 已对各区做过九遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S9-* 条目（含 R9-I / R10-E 的空枚举收口与 S9-J-1..4）以及已合入的 S10-A-1 / S10-B-1..3 / S10-C-1..3。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R10-A … R10-J），报告写入 `docs/reports/sota-opt/round-10/`。

状态：A/B/C/E 完成已合入（S10-A-1 / S10-B-1..3 / S10-C-1..3 淘汰；R10-E 无新排除 ID）；D 重派运行中；F 运行中；G 本波派出。G 切片 = `src/run/`（除 A 的 child-tracking/gate-apply）+ `src/supervisor/`（除 B 的 model-router）+ `src/graph/` + `src/domain/`（42 文件）。不要重开 S1-G-1..9 / S2-G-1..8 / S3-G-1..5 / S4-G-1..7 / S5-G-1..6 / S6-G-1..7 / S7-G-1..5 / S8-G-1..2 / S9-G-1..3。CPU ~0.29 ms vs I/O 地板 ~87–98 ms。不要去 fsync，不要把 EventStore/EpisodeStore 改成内存事实源。S9-G-1 fail-open、S9-G-3 去 fsync 永不重开。
