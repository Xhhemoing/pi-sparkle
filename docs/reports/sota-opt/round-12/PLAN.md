# Round 12 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–11 已对各区做过十一遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S11-* 条目（含 R9-I / R10-E / R10-F / R10-H / R10-I / R10-J / R11-C / R11-E / R11-F / R11-H / R11-I / R11-J / R12-A 的空枚举收口与已合入的 S11-A-1..2 / S11-B-1 / S11-D-1..2 / S11-G-1..3）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R12-A … R12-J），报告写入 `docs/reports/sota-opt/round-12/`。

状态：第 2 波 D 本波派出；A 已合入（空枚举未铸 S12-A-*）；B/C 运行中。

C 切片 = 离线路由 `src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`。必须站在已落地 S7-C 之上，不得另起平行实现。不要重开 S1-C-1..10 / S2-C-1..5 / S3-C-1..3 / S4-C-1..6 / S5-C-1..7 / S6-C-1..7 / S7-C-1..4 / S8-C-1..4 / S9-C-1..4 / S10-C-1..3。R11-C 空枚举、未铸 S11-C-*。噪声带 ±35 ms；贴带不越带。S10-C-3 对称 Schur 镜像理论否决。RID/CNT 归约重排已用反例探针封死。r1c–r7c 回归门必须保持绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。最后生产改动仍为 `183df9b`。

B 切片 = 10 文件：`src/routing/{r0,assign,assign-plan,policy,live-cascade,live-selection,analyze-task,primary-catalog,catalog-model}.ts`、`src/supervisor/model-router.ts`。不要重开 S1-B-* … S10-B-1..3 / S11-B-1。S11-B-1 route() 内融合 partition+selection：M=2 低于噪声、M=7 符号翻转、M=10 符号稳定负优化。天花板 M=2 ~9–12 ms、M=10 ~19–20 ms。Live = R0；不得另起平行 live R1。基线 `94ed3d9` 预期空 diff。

A 切片已合入：空枚举，未铸 S12-A-*。预算复核 70–92 µs/run。合同地板分解：hashAssessment 约 42%、validateEvent 约 21%、O(E) 扫描合计约 1.6%。S11-A-1..2 维持。

D 切片 = `src/adaptation/` 全部 14 文件。不要重开 S1-D-1..9 / S2-D-1..5 / S3-D-1..5 / S4-D-1..5 / S5-D-1..5 / S6-D-1..5 / S7-D-1..5 / S8-D-1..5 / S9-D-1..4 / S10-D-1..2 / S11-D-1..2。禁止去 fsync / 完整性再哈希。S9-D-4 便宜 toLowerCase 形态永不重开（U+212A fail-open）。S10-D-1 mkdir 省略与 S10-D-2 跳过第二次 assignTasks 已闭合。S11-D-1 identityEquals 守卫消除 fail-open。S11-D-2 parse→restore 融合撞 X1-2/X0-4。基线 `82bef36` 预期空 diff。eval 地板 ~4–5 ms。
