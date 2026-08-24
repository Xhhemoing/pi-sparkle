# Round 6 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–5 已对各区做过五遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* / S2-* / S3-* / S4-* / S5-* 条目。

多个切片已建立整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板）。本轮须先复核该预算，再找新角度；不要硬凑。R5-C 指出 `irls` 自身时间（~21%）尚未做过循环控制级裁决——仅当该角度不落在已排除的 S5-C-5/7 时才可提案。

分区与 Round 1 相同（R6-A … R6-J），报告写入 `docs/reports/sota-opt/round-06/`。
