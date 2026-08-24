# Round 12 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–11 已对各区做过十一遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S11-* 条目以及已合入的 S12-B-1..2 / S12-C-1 / S12-D-1..2（含 R9-I / R10-E / R10-F / R10-H / R10-I / R10-J / R11-C / R11-E / R11-F / R11-H / R11-I / R11-J / R12-A / R12-E / R12-F / R12-H 的空枚举收口与已合入的 S11-A-1..2 / S11-B-1 / S11-D-1..2 / S11-G-1..3）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R12-A … R12-J），报告写入 `docs/reports/sota-opt/round-12/`。

状态：第 4 波 J 本波派出；A/B/C/D/E/F/H 已合入（A/E/F/H 空枚举；B 铸 S12-B-1..2；C 铸 S12-C-1；D 铸 S12-D-1..2，均淘汰）；G/I 运行中。

C 切片已合入：S12-C-1（solveSymmetric 消元嵌套序交换 FORM，逐位但稳定 ~3.6× 负优化；嵌套序×布局空间由 S4-C-2 + S5-C-1..4 + 本条封闭）。生产中位复核 658–663 ms/报告。不要重开 S12-C-1 / S10-C-1..3 / RID/CNT / CMB restack。必须站在 S7-C 之上。噪声带 ±35 ms；贴带不越带。r1c–r7c 回归门 8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193。最后生产改动仍为 `183df9b`。

B 切片已合入：S12-B-1（allowed 反索引，与 S11-B-1 互为肥目录镜像）/ S12-B-2（prior family 批内记忆化；真实规模 0.08–0.19ms，条件式落地物，重开条件即落地条件：任何 N≥10³ 调用方传 prior）。天花板复核 M=2 11.7–12.0 ms、M=10 19.1–19.7 ms。prior≠undefined 假设 N=2000 为 37.8–80.0 ms/eval，今日零流量。不要重开 S12-B-1..2 / S11-B-1 / S10-B-1..3。Live = R0。

E 切片已合入：空枚举，未铸 S12-E-*。SLICE-CPU 本轮复核 18.5–19.2 µs/run（历史带 11–24）。S9-E-2 负优化与 S8-E-1 双载入维持。基线 `adb20d7` 空 diff 再确认。

A 切片已合入：空枚举，未铸 S12-A-*。预算复核 70–92 µs/run。合同地板分解：hashAssessment 约 42%、validateEvent 约 21%、O(E) 扫描合计约 1.6%。S11-A-1..2 维持。

D 切片已合入：S12-D-1（边界闸 JSON.parse 预探针省略；健全形态 9.1–10.4µs once-per-command；便宜形态 U+ 转义键 fail-open，S9-D-4 同族）/ S12-D-2（eval 回放链四遍融两遍；E=200 双形态稳定负优化）。eval 地板复核 3.72–4.07 ms。不要重开 S12-D-1..2 / S11-D-1..2 / S10-D-1..2 / S9-D-4。禁止去 fsync / 完整性再哈希。

F 切片已合入：空枚举，未铸 S12-F-*。全实验锚点本轮复核 121–133 ms；账目最后一行时钟/预算/返回 spread 残差直测 8–204 µs。S7-F-1 ≠ S6-F-5 维持。`outcomes.some` 仍为 1.63–1.73 ms（S1-F-8）。基线 `519101f` 空 diff 再确认。

G 切片 = 42 文件：`src/run/` 除 `child-tracking.ts`/`gate-apply.ts` 外 17 文件；`src/supervisor/` 除 `model-router.ts` 外 4 文件；`src/graph/` 全部 4 文件；`src/domain/` 全部 17 文件。不要重开 S1-G-1..9 / S2-G-1..8 / S3-G-1..5 / S4-G-1..7 / S5-G-1..6 / S6-G-1..7 / S7-G-1..5 / S8-G-1..2 / S9-G-1..3 / S10-G-1 / S11-G-1..3。禁止去 fsync / 完整性再哈希 / 增量读镜像。S11-G-1 切片内惰性 import 生产收益恒 0（`main.ts` 静态钉死）。S11-G-2 相同字节写跳过 0/27 命中。S11-G-3 inspectRun 尾扫 fail-closed。计算顶 ~0.30 ms vs I/O 地板 ~92–102 ms。基线 `4efee23` 预期空 diff。

H 切片已合入：空枚举，未铸 S12-H-*。热层默认复核 8.5–8.9 µs/run；配置态仍无悬崖。热链剖面 decompositon：`validateRequirementContract`×2 仅 4.0–4.8%。S5-H-1 维持。基线 `fd437a9` 空 diff 再确认。

I 切片 = **25 文件**（cli 13 / pi-adapter 9 / config 2 / telemetry 1；R8-I「~28 / cli 16」是头部笔误）。必须站在已落地 S1-I / S4-I / S5-I-1 / S7-I-1 之上。不要重开 S1-I-1..8 / S2-I-1..6 / S3-I-1..6 / S4-I-2..5（无 S4-I-1）/ S5-I-2..5 / S6-I-1..3 / S7-I-2..4 / S8-I-1..3。R9-I / R10-I / R11-I 空枚举、未铸 ID。S8-I-1 跳过回退不健全；重开物是 pi-ai 自身 ship 的 `models.generated` / `./providers/all.models` 导出（0.84.1 仍 7 exports，三种 specifier 均不可达）。自制 39 表 union @22.22 净约 10 ms，低于落地线且三重围栏。凭据面只读。基线 `8dee7fb` 预期空 diff。custom−builtin 复核约 +23~+48 ms。

J 切片 = **29 文件**：`src/cluster/` 3 + `src/privacy/` 3 + `src/preferences/` 7 + `src/episode/` 5 + `src/persist/` 2 + `src/track/` 4 + `src/context/` 2 + `src/feedback/` 3。必须站在已落地 J1 之上。不要重开 S1-J-1..7 / S2-J-1..11 / S3-J-1..6 / S4-J-1..6 / S5-J-1..6 / S6-J-1..6 / S7-J-1..6 / S8-J-1..2 / S9-J-1..4。R10-J 与 R11-J 空枚举、未铸 ID。禁止去 fsync / 完整性再哈希 / 增量读镜像。删除级联 fail-closed 两读顺序 + 串行两写（S5-J-3 / S6-J-1）钉死。S8-J-2 jsonl 单句柄合并符号不稳。R11-J 两处未点名微观（commands 双扫、役播 `role === undefined`）是换名拒绝，勿补铸。J1 仿真 2468 项须保持绿。基线 `fb41417` 预期空 diff。
