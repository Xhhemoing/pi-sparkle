# Round 14 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–13 已对各区做过十三遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S13-* 条目（含已合入的 S13-B-1 与 R12-A / R12-E / R12-F / R12-G / R12-H / R12-I / R12-J / R13-A / R13-C / R13-D / R13-E / R13-F / R13-G / R13-H / R13-I / R13-J / R14-A / R14-B 的空枚举收口）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R14-A … R14-J），报告写入 `docs/reports/sota-opt/round-14/`。

状态：第 2 波 E 本波派出；A/B 已合入（空枚举）；C/D 运行中。Round 13 已收口 10/10。

A 切片已合入：空枚举，未铸 S14-A-*。预算复核 69–81 µs/run（锚点 13.9–16.3 µs/gate，与 R13-A 70–81 同带）。合同地板复现：hashAssessment×3 ~41–42%、validateEvent ~20–21%、turn ~13%、prescore×2 ~10%、O(E) 扫描 ~1.9–2.0%（第五扫描 currentGateStatus 51–65 ns 首次单列）。本轮新增 E 规模越线标定（10 ms/run 需 E≈1.4–1.7×10⁵）与 max-codes 格（14.6–15.0 µs/gate，无悬崖）。3 项换名拒绝不铸 ID。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S14-B-*。天花板复核 M=2 9.3–10.2、M=10 17.6–19.6、replay 6.9–7.1、10× 98.6–105.0 ms/eval（历史带快端）。S12-B-2 重开条件未触发（eval-routing 传 learned 不传 prior）。本轮新增 GC/分配预算格（replay 路径 GC 占 15–24%，分配消除类硬顶 1.1–4.6 ms/eval）与 JIT 档审计（13 热函数 turbofan、0/17 deopt；route 提升至模块级符号翻转）。换名检查全部落在已关 ID。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片 = 9 文件：`src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`。必须站在已落地 S7-C。最后生产改动 `183df9b`；预期 `git diff 183df9b..HEAD --` 对本切片为空。不要重开 S1-C-1..10 / S2-C-1..5 / S3-C-1..3 / S4-C-1..6 / S5-C-1..7 / S6-C-1..7 / S7-C-1..4 / S8-C-1..4 / S9-C-1..4 / S10-C-1..3 / S12-C-1。R11-C / R13-C 空枚举（无 S11-C-* / S13-C-*）。RID/CNT 已关。禁止 CMB 重排。S12-C-1 nest×layout 已关（重开条件：无）。R13-C 无名微观（PIVCSE / FINTAIL / REFZ / TSORT / DEG）不补铸。噪声带 ±35 ms；贴带不落地。r1c–r7c 必须保持绿：8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193。生产中位 R13-C：663.4–674.6 ms/报告。若落地代码：重跑 r1c–r7c + 新 r14c 仿真。

D 切片 = `src/adaptation/`（14 文件）。不要重开 S1-D-* … S8-D-1..3 / S9-D-4 / S10-D-1..2 / S11-D-1..2 / S12-D-1..2。R13-D 空枚举、未铸 ID。禁止去 fsync / 完整性再哈希。S9-D-4 廉价 `toLowerCase` 跳过对 U+212A fail-open，永不重开；S12-D-1 廉价形态同族。eval 地板复核 3.83–4.05 ms；整命令 21 相位剖面，切片内可寻址 CPU 832–853 µs，全部落在已关 ID。基线 `82bef36` 预期空 diff。

E 切片 = `src/learning/`（10 文件）。不要重开 S1-E-* … S8-E-1 / S9-E-2。R10-E / R11-E / R12-E / R13-E 空枚举、未铸 ID。S8-E-1 双 `loadLearnedRouting` 不得去重。S9-E-2 是负优化。R13-E 三处无名微观（bandit includes 旁路、applyLearnedRouting 双中间数组、routingPolicyIdentity 再校验）不补铸。S13-B-1 辖区未重提。SLICE-CPU 复核 13.5–15.9 µs/run（历史带 11–24）。基线 `adb20d7` 预期空 diff。
