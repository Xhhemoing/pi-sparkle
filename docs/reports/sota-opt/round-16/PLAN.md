# Round 16 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–15 已对各区做过十五遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S15-* 条目（含已合入的 S13-B-1 与 R12–R15 已合入空枚举收口，含刚合入的 R15-I；R15-J 本波并行、其报告尚未合入）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R16-A … R16-J），报告写入 `docs/reports/sota-opt/round-16/`。

状态：第 1 波 B 本波派出；A 运行中。Round 15 A–I 已合入（空枚举）；J 并行派出。

A 切片 = 14 文件：`src/tracking/` 12 + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`。不要重开 S1-A-1..9 及后续 A 系排除。R10-A…R15-A 空枚举或仅噪声级淘汰、未铸达门槛 ID。预算锚点 R15-A：69–83 µs/run（13.8–16.5 µs/gate）。R15-A 已归档 per-turn 集合规模越线（C≈996–1,015 / R≈1,020–1,037 达 10 ms/run）、GC/分配格（~22 KB/gate，摊销 ~1.2 µs/run）与 JIT 档（14–15/16 turbofan，200k 门 0 deopt）——不补铸。5 项换名拒绝不重提。调用方仍为 `supervisor.ts:483` / `coordinator.ts:444` / `flowchart-run.ts:320`（以本轮 rg 为准）。基线 `7acb666` 预期空 diff。

B 切片 = live 路由：`src/routing/{r0,assign,policy,live-cascade,analyze-task,primary-catalog,catalog-model,assign-plan,live-selection}.ts` + `src/supervisor/model-router.ts`。不要重开 S1-B-* … S12-B-1 / S12-B-2 / S13-B-1。R14-B / R15-B 空枚举、未铸 ID。天花板 R15-B：M=2 9.5–10.9 / M=10 18.5–25.4 / replay 7.3–9.9 / 10× 109.7–140.9 ms/eval。S12-B-2 重开条件：caller 传 `prior` 且 N≥10³（`eval-routing.ts` 仍传 learned，未触发）。S13-B-1 重开：`applyLearnedRouting` 体成本 ≥2 个量级。R15-B A/A 噪声地板与引擎代轴不补铸。Live = R0。基线 `94ed3d9` 预期空 diff。
