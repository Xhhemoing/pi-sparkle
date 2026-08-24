# Round 13 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–12 已对各区做过十二遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S12-* 条目以及已合入的 S13-B-1（含已合入的 S12-B-1..2 / S12-C-1 / S12-D-1..2 与 R12-A / R12-E / R12-F / R12-G / R12-H / R12-I / R12-J / R13-A / R13-D 的空枚举收口）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R13-A … R13-J），报告写入 `docs/reports/sota-opt/round-13/`。

状态：第 2 波 F 本波派出；A/D 已合入（空枚举）；B 已合入（S13-B-1 淘汰）；C/E 运行中。Round 12 已 10/10 收口。

A 切片已合入：空枚举，未铸 S13-A-*。预算复核 70–81 µs/run（与 R12-A 70–92 同带且更窄）。合同地板复现：hashAssessment×3 ~41–42%、validateEvent ~20–21%、turn ~13%、prescore×2 ~10–11%、O(E) 扫描合计 ~1.6%。本轮新增 turn 内部剖面，子组件全部落在已关 ID。8 项新记录换名检查不铸 ID。基线 `7acb666` 空 diff 再确认。

B 切片已合入：S13-B-1（assignPlanned learned 层按 (family, preferredModel) 批内记忆化；与 S12-B-2 为姊妹而非换名；真实流量 N=2000+learned 三目录规模符号翻转；fat×M=10 仅 0.18–3.1 ms/eval 且零观测流量）。天花板复核 M=2 11.6–11.9 ms、M=10 18.8–19.2 ms。learned-size 格闭合：肥 avoid 因收缩 allowed 反而更快。S12-B-2 重开条件未触发。不要重开 S13-B-1 / S12-B-1..2 / S11-B-1 / S10-B-1..3。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片 = 9 文件：`src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`。必须站在 S7-C 之上。最后生产改动 `183df9b`，预期 `git diff 183df9b..HEAD --` 对这 9 文件为空。不要重开 S1-C-1..10 / S2-C-1..5 / S3-C-1..3 / S4-C-1..6 / S5-C-1..7 / S6-C-1..7 / S7-C-1..4 / S8-C-1..4 / S9-C-1..4 / S10-C-1..3 / S12-C-1。R11-C 空枚举（未铸 S11-C-*）；RID/CNT 已闭；禁止 CMB restack。S12-C-1 嵌套序×布局空间已闭（重开条件：无）。噪声带 ±35 ms；贴带不越带。r1c–r7c 回归门 8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193。若落地代码：重跑 r1c–r7c + 新 r13c 仿真。

D 切片已合入：空枚举，未铸 S13-D-*。eval 地板复核 3.83–4.05 ms（Node v22.22.2，与 R12-D 3.72–4.07 同带）。本轮新增 eval 整命令 21 相位剖面，切片内可寻址 CPU 832–853 µs，全部落在已关 ID。11 项换名检查不铸 ID。S8-D-1..3 / S9-D-4 / S12-D-1..2 维持。基线 `82bef36` 空 diff 再确认。

E 切片 = 10 文件：`src/learning/`（auto-loop / learned-routing / from-episode / signals / signatures / patterns / bandit-store / task-success / attribution / diagnostics）。不要重开 S1-E-* … S8-E-1..3 / S9-E-1..3。R10-E / R11-E / R12-E 空枚举、未铸 ID。S9-E-2 是负优化。S8-E-1 双 `loadLearnedRouting` 不去重。S8-E-2 PIC 形状敏感。SLICE-CPU 历史带 11–24 µs/run（R12-E 18.5–19.2）。基线 `adb20d7` 预期空 diff。

F 切片 = 15 文件：`src/experiments/`（shadow / canary / plan / gated-comparison / replay / attribution-report / dataset / comparison-report / evaluation-card / manifest / threshold-calibration / shadow-compare / simulation-holdout / holdout / isolation）。必须站在 S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2 之上。S7-F-1 不是 S6-F-5（禁止 O(P) two-pointer）。不要重开 S1-F-* … S8-F-1..3 / S9-F-1..3。R10-F / R11-F / R12-F 空枚举、未铸 ID。S9-F-3 scratch-Set 是稳定负优化。`outcomes.some` 仍为 1.63–1.73 ms（S1-F-8）。全实验锚点 121–133 ms。基线 `519101f` 预期空 diff。

J 切片（待派）：R12-J 空枚举、未铸 S12-J-*。I/O 地板第十二次成立。三处跨函数微观（spawn 双 trim / claimRole byRole 重取重存 / packet omissions 双遍）与 R11-J 两处无名微观均不补铸。S5-J-3 / S6-J-1 / S8-J-2 / J1 钉死。
