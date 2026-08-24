# Round 7 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–6 已对各区做过六遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* / S6-* 条目，以及已合入的 S7-A-1..4 / S7-B-1..6 / S7-D-1..5 / S7-G-1..5。

多个切片已建立整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板）。本轮须先复核该预算，再找新角度；不要硬凑。S6-C 已落地 IRLS 累加直线化；S6-F-1 已落地 restore 成员判断方向反转。不要重开 S6-C-1..7 或 S6-F-2..5。H 切片热稳态约 5.6–9.5 µs/run，不要重开 S5-H-1..3 / S6-H-1..4。

分区与 Round 1 相同（R7-A … R7-J），报告写入 `docs/reports/sota-opt/round-07/`。

状态：A/B/D/G 报告已合入（均无赢家）；C 首次派出未推分支，待空位重派；E/F 运行中；H 本波派出。
