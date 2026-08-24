# Round 8 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–7 已对各区做过七遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。C 区本轮必须叠在已落地的 S7-C（支撑升序 eta）之上，禁止重开 S5-C-5/7、S6-C-1..7、S7-C-1..4，不要重做 S7-C。

本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-* / S7-* 条目，以及已合入的 S8-A-1..3 / S8-B-1..4 / S8-C-1..4 / S8-D-1..5 / S8-E-1..3 / S8-F-1..3 / S8-H-1..3。S7-C 已落地，不得另起平行实现。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区，不要只跑默认空配置。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R8-A … R8-J），报告写入 `docs/reports/sota-opt/round-08/`。

状态：A–F/H 完成已合入（含 S8-H-1..3 淘汰）；G/I 运行中；J 本波派出（Round 8 十区均已派出）。J 切片 = `src/cluster/` + `src/privacy/` + `src/preferences/` + `src/episode/` + `src/persist/` + `src/track/` + `src/context/` + `src/feedback/`，叠在 J1 之上。不要重开 S1-J-1..7 / S2-J-1..11 / S3-J-1..6 / S4-J-1..6 / S5-J-1..6 / S6-J-1..6 / S7-J-1..6。契约/I/O 地板，不要硬凑；saveToDisk / mailbox / 删除级联 / 脱敏保持 fail-closed。G 完成后插入 S8-G 行到 F 与 H 之间。
