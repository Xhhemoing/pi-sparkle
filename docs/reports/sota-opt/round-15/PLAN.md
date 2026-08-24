# Round 15 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–14 已对各区做过十四遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S14-* 条目（含已合入的 S13-B-1 与 R12-A / R12-E / R12-F / R12-G / R12-H / R12-I / R12-J / R13-A / R13-C / R13-D / R13-E / R13-F / R13-G / R13-H / R13-I / R13-J / R14-A / R14-B / R14-C / R14-D / R14-E / R14-F / R14-G / R14-H / R14-I 的空枚举收口；R14-J 仍在飞，其结论稍后并入）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R15-A … R15-J），报告写入 `docs/reports/sota-opt/round-15/`。

状态：第 1 波 B 本波派出；A 运行中。Round 14 的 J 仍在飞。R14-H 已合入（空枚举）。

A 切片 = 14 文件：`src/tracking/` 12 文件（roller / analysis / gates / config / combined-score / from-child / index / turn / isolation / human-score / prescore / types）+ `src/run/child-tracking.ts` + `src/run/gate-apply.ts`。不要重开 S1-A-1..9 / S2-A-1..6 / S3-A-1..4 / S4-A-1..3 / S5-A-1..3 / S6-A-1..3 / S7-A-1..4 / S8-A-1..3 / S9-A-1 / S10-A-1 / S11-A-1..2。R12-A / R13-A / R14-A 空枚举、未铸 ID。预算复核 69–81 µs/run。合同地板：hashAssessment×3 ~41–42%、validateEvent ~20–21%、turn ~13%、prescore×2 ~10%、O(E) 扫描 ~1.9–2.0%（含第五扫描 currentGateStatus）。R14-A 已归档 E 规模越线标定（10 ms/run 需 E≈1.4–1.7×10⁵）与 max-codes 格（14.6–15.0 µs/gate，无悬崖），不补铸。生产调用方仍为 `supervisor.ts:483` / `coordinator.ts:444` / `flowchart-run.ts:320`。基线 `7acb666` 预期空 diff。

B 切片 = 10 文件：`src/routing/{r0,assign,assign-plan,policy,live-cascade,live-selection,analyze-task,primary-catalog,catalog-model}.ts`、`src/supervisor/model-router.ts`。不要重开 S1-B-* … S10-B-1..3 / S11-B-1 / S12-B-1..2 / S13-B-1。S13-B-1 是 learned 层批内记忆化（与 S12-B-2 prior 层为姊妹；真实流量符号翻转）。S12-B-2 是条件式落地物（重开条件即落地条件：任何 N≥10³ 调用方传 prior）。R14-B 空枚举：天花板复核 M=2 9.3–10.2、M=10 17.6–19.6 ms/eval；GC/分配硬顶 1.1–4.6 ms/eval；JIT 档审计关闭 route 模块级提升。Live = R0；不得另起平行 live R1。基线 `94ed3d9` 预期空 diff。
