# Round 12 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–11 已对各区做过十一遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S11-* 条目以及已合入的 S12-B-1..2 / S12-C-1 / S12-D-1..2（含 R9-I / R10-E / R10-F / R10-H / R10-I / R10-J / R11-C / R11-E / R11-F / R11-H / R11-I / R11-J / R12-A / R12-E / R12-F / R12-G / R12-H / R12-I / R12-J 的空枚举收口与已合入的 S11-A-1..2 / S11-B-1 / S11-D-1..2 / S11-G-1..3）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R12-A … R12-J），报告写入 `docs/reports/sota-opt/round-12/`。

状态：10 / 10 完成已合入（S12-B-1..2 / S12-C-1 / S12-D-1..2 淘汰；R12-A / R12-E / R12-F / R12-G / R12-H / R12-I / R12-J 无新排除 ID）。第 13 轮进行中，见 [round-13/PLAN.md](../round-13/PLAN.md)。

C 切片已合入：S12-C-1（solveSymmetric 消元嵌套序交换 FORM，逐位但稳定 ~3.6× 负优化；嵌套序×布局空间由 S4-C-2 + S5-C-1..4 + 本条封闭）。生产中位复核 658–663 ms/报告。不要重开 S12-C-1 / S10-C-1..3 / RID/CNT / CMB restack。必须站在 S7-C 之上。噪声带 ±35 ms；贴带不越带。r1c–r7c 回归门 8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193。最后生产改动仍为 `183df9b`。

B 切片已合入：S12-B-1（allowed 反索引，与 S11-B-1 互为肥目录镜像）/ S12-B-2（prior family 批内记忆化；真实规模 0.08–0.19ms，条件式落地物，重开条件即落地条件：任何 N≥10³ 调用方传 prior）。天花板复核 M=2 11.7–12.0 ms、M=10 19.1–19.7 ms。prior≠undefined 假设 N=2000 为 37.8–80.0 ms/eval，今日零流量。不要重开 S12-B-1..2 / S11-B-1 / S10-B-1..3。Live = R0。

E 切片已合入：空枚举，未铸 S12-E-*。SLICE-CPU 本轮复核 18.5–19.2 µs/run（历史带 11–24）。S9-E-2 负优化与 S8-E-1 双载入维持。基线 `adb20d7` 空 diff 再确认。

A 切片已合入：空枚举，未铸 S12-A-*。预算复核 70–92 µs/run。合同地板分解：hashAssessment 约 42%、validateEvent 约 21%、O(E) 扫描合计约 1.6%。S11-A-1..2 维持。

D 切片已合入：S12-D-1（边界闸 JSON.parse 预探针省略；健全形态 9.1–10.4µs once-per-command；便宜形态 U+ 转义键 fail-open，S9-D-4 同族）/ S12-D-2（eval 回放链四遍融两遍；E=200 双形态稳定负优化）。eval 地板复核 3.72–4.07 ms。不要重开 S12-D-1..2 / S11-D-1..2 / S10-D-1..2 / S9-D-4。禁止去 fsync / 完整性再哈希。

F 切片已合入：空枚举，未铸 S12-F-*。全实验锚点本轮复核 121–133 ms；账目最后一行时钟/预算/返回 spread 残差直测 8–204 µs。S7-F-1 ≠ S6-F-5 维持。`outcomes.some` 仍为 1.63–1.73 ms（S1-F-8）。基线 `519101f` 空 diff 再确认。

G 切片已合入：空枚举，未铸 S12-G-*（十二轮以来本切片首次完全空枚举）。计算顶复核 0.294–0.304 ms vs I/O 95.5–105.6 ms。14 格矩阵摘要与 R10-G/R11-G 逐位相同。S11-G-1..3 维持。基线 `4efee23` 空 diff 再确认。

H 切片已合入：空枚举，未铸 S12-H-*。热层默认复核 8.5–8.9 µs/run；配置态仍无悬崖。热链剖面 decomposition：`validateRequirementContract`×2 仅 4.0–4.8%。S5-H-1 维持。基线 `fd437a9` 空 diff 再确认。

I 切片已合入：空枚举，未铸 S12-I-*。custom−builtin 本轮复核 children +51.3/+29.1、track +58.7/+24.1 ms（22.14/22.22）。S8-I-1 重开审计完备：0.84.1 的 7 exports 全部逐项特征化（root `.` 与 `./compat` 均重于 `providers/all` 且无 MODELS）；`models.generated` 三种 specifier 仍不可达。自制 union / 磁盘快照 / memo 三重围栏维持。基线 `8dee7fb` 空 diff 再确认。

J 切片已合入：空枚举，未铸 S12-J-*。I/O 地板复核：saveToDisk 149.7–271.6µs（50 档）/ 429.5–543.7µs（500 档）；jsonl fsync=false 61.1–71.2µs / true 209.5–321.0µs；级联 match 672.9–797.7µs / no-match 275.8–288.2µs；index 40.8–41.3µs；plan CPU 1.10–2.73µs。J1 sim 2468 项绿（2718.1×）。三处从未点名微观（spawn 双 trim、claimRole byRole 重取重存、packet omissions 双遍）是换名拒绝，不铸 ID。R11-J 两处无名微观未补铸。S5-J-3 / S6-J-1 / S8-J-2 / J1 原样。基线 `fb41417` 空 diff 再确认。
