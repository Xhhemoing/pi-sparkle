# Round 13 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–12 已对各区做过十二遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S12-* 条目（含已合入的 S12-B-1..2 / S12-C-1 / S12-D-1..2 与 R12-A / R12-E / R12-F / R12-G / R12-H / R12-I / R12-J 的空枚举收口）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R13-A … R13-J），报告写入 `docs/reports/sota-opt/round-13/`。

状态：第 1 波 C 本波派出；A/B 运行中。Round 12 已 10/10 收口。R12-J 已合入（空枚举）。

A 切片 = 14 文件：`src/tracking/` 12 文件（roller / analysis / gates / config / combined-score / from-child / index / turn / isolation / human-score / prescore / types）+ `src/run/child-tracking.ts` + `src/run/gate-apply.ts`。不要重开 S1-A-1..9 / S2-A-1..6 / S3-A-1..4 / S4-A-1..3 / S5-A-1..3 / S6-A-1..3 / S7-A-1..4 / S8-A-1..3 / S9-A-1 / S10-A-1 / S11-A-1..2。R12-A 空枚举、未铸 S12-A-*。预算复核 70–92 µs/run。合同地板分解：hashAssessment 约 42%、validateEvent 约 21%、O(E) 扫描合计约 1.6%。生产调用方仍为 `supervisor.ts:483` / `coordinator.ts:444` / `flowchart-run.ts:320`。基线 `7acb666` 预期空 diff。

B 切片 = 10 文件：`src/routing/{r0,assign,assign-plan,policy,live-cascade,live-selection,analyze-task,primary-catalog,catalog-model}.ts`、`src/supervisor/model-router.ts`。不要重开 S1-B-* … S10-B-1..3 / S11-B-1 / S12-B-1..2。S12-B-1 allowed 反索引与 S11-B-1 互为肥目录镜像。S12-B-2 prior family 批内记忆化是条件式落地物（重开条件即落地条件：任何 N≥10³ 调用方传 prior）。天花板复核 M=2 11.7–12.0 ms、M=10 19.1–19.7 ms。prior≠undefined 假设 N=2000 为 37.8–80.0 ms/eval，今日零流量。Live = R0；不得另起平行 live R1。基线 `94ed3d9` 预期空 diff。

C 切片 = 9 文件：`src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`。必须站在 S7-C 之上。最后生产改动 `183df9b`，预期 `git diff 183df9b..HEAD --` 对这 9 文件为空。不要重开 S1-C-1..10 / S2-C-1..5 / S3-C-1..3 / S4-C-1..6 / S5-C-1..7 / S6-C-1..7 / S7-C-1..4 / S8-C-1..4 / S9-C-1..4 / S10-C-1..3 / S12-C-1。R11-C 空枚举（未铸 S11-C-*）；RID/CNT 已闭；禁止 CMB restack。S12-C-1 嵌套序×布局空间已闭（重开条件：无）。噪声带 ±35 ms；贴带不越带。r1c–r7c 回归门 8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193。若落地代码：重跑 r1c–r7c + 新 r13c 仿真。

J 切片（待派）：R12-J 空枚举、未铸 S12-J-*。I/O 地板第十二次成立。三处跨函数微观（spawn 双 trim / claimRole byRole 重取重存 / packet omissions 双遍）与 R11-J 两处无名微观均不补铸。S5-J-3 / S6-J-1 / S8-J-2 / J1 钉死。
