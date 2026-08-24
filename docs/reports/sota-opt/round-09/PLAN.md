# Round 9 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–8 已对各区做过八遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S8-* 条目，以及已合入的 S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 / S9-E-1..3 / S9-F-1..3 / S9-H-1..2。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R9-A … R9-J），报告写入 `docs/reports/sota-opt/round-09/`。

状态：A–F/H 完成已合入（S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 / S9-E-1..3 / S9-F-1..3 / S9-H-1..2 淘汰）；G/I 运行中；J 本波派出。J 切片 = `src/cluster/` + `src/privacy/` + `src/preferences/` + `src/episode/` + `src/persist/` + `src/track/` + `src/context/` + `src/feedback/`。不要重开 S1-J-1..7 / S2-J-1..11 / S3-J-1..6 / S4-J-1..6 / S5-J-1..6 / S6-J-1..6 / S7-J-1..6 / S8-J-1..2，也不要重做 J1。不要去 fsync，不要 sourcedFact 跨调用 CSE，不要合并 jsonl 单句柄。删除级联配置态锚点约 666–717µs。I/O 地板支配。
