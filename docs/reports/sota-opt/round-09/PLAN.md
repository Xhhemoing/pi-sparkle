# Round 9 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–8 已对各区做过八遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S8-* 条目，以及已合入的 S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 / S9-F-1..3。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R9-A … R9-J），报告写入 `docs/reports/sota-opt/round-09/`。

状态：A/B/C/D/F 完成已合入（S9-A-1 / S9-B-1..4 / S9-C-1..4 / S9-D-1..4 / S9-F-1..3 淘汰）；E/G 运行中；H 本波派出。H 切片 = `src/evaluation/` + `src/requirement/` + `src/review/` + `src/rubric/`。不要重开 S1-H-1..9 / S2-H-1..7 / S3-H-1..4 / S4-H-1..3 / S5-H-1..3 / S6-H-1..4 / S7-H-1..3 / S8-H-1..3（S5-H-1 已恢复在表，保持）。热层 µs 级；配置态锚点曾低于默认态。不要收窄盲评输入形状，不要做全决议快路径（S8-H-3 fail-open）。H/score 不得写路由 PASS/FAIL。
