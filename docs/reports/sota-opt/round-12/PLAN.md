# Round 12 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–11 已对各区做过十一遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S11-* 条目（含 R9-I / R10-E / R10-F / R10-H / R10-I / R10-J / R11-C / R11-E / R11-F / R11-H / R11-I 的空枚举收口与已合入的 S11-A-1..2 / S11-B-1 / S11-D-1..2 / S11-G-1..3）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R12-A … R12-J），报告写入 `docs/reports/sota-opt/round-12/`。

状态：第 1 波 B 本波派出；A 运行中。R11-G 已合入（S11-G-1..3）；R11-J 仍在跑，勿重派。

B 切片 = 10 文件：`src/routing/{r0,assign,assign-plan,policy,live-cascade,live-selection,analyze-task,primary-catalog,catalog-model}.ts`、`src/supervisor/model-router.ts`。不要重开 S1-B-* … S10-B-1..3 / S11-B-1。S11-B-1 route() 内融合 partition+selection：M=2 低于噪声、M=7 符号翻转、M=10 符号稳定负优化。天花板 M=2 ~9–12 ms、M=10 ~19–20 ms。Live = R0；不得另起平行 live R1。基线 `94ed3d9` 预期空 diff。

A 切片 = `src/tracking/` 12 文件 + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14 文件）。不要重开 S1-A-1..9 / S2-A-1..6 / S3-A-1..4 / S4-A-1..3 / S5-A-1..3 / S6-A-1..3 / S7-A-1..4 / S8-A-1..3 / S9-A-1 / S10-A-1 / S11-A-1..2。S11-A-1 apply 守卫常量折叠（引理 D）已淘汰：~14 ns/子结果，e2e 符号翻转，防御纵深。S11-A-2 gate-apply none 路径死扫描已淘汰：落地需收窄公开 GateApplyResult。S10-A-1 门控结局二元化需平行 turn 路径。预算 ~60–74 µs/run。基线 `7acb666` 预期空 diff。
