# Round 16 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–15 已对各区做过十五遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S15-* 条目（含已合入的 S13-B-1 与 R12–R15 全部空枚举收口，含刚合入的 R15-J / R16-A / R16-B / R16-C / R16-D）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R16-A … R16-J），报告写入 `docs/reports/sota-opt/round-16/`。

状态：第 3 波 G 本波派出；E/F 运行中。Round 15 已收口 10/10。A/B/C/D 已合入（空枚举）。

A 切片已合入：空枚举，未铸 S16-A-*。预算复核 66–76 µs/run（13.1–15.3 µs/gate，与 R15-A 69–83 同带）。本轮新增 payload 形态轴：id 字节 L 被 schema 结构性封闭（合法顶 +4.8–5.4 µs/run，无越线）；evidenceRefs 基数 V 越 10 ms 于 ≈21,447–25,331（约 4.0–4.1 量级高于生产 V=2）；摘要字节 S 越 10 ms 于 ≈1.32×10⁶ chars（约 4.9 量级）。R14-A E/max-codes 与 R15-A C/R/GC/JIT 不补铸。4 项换名拒绝不铸 ID。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S16-B-*。天花板复核 M=2 8.8–9.4 / M=10 17.7–18.5 / replay 6.95–7.01 / 10× 95–103 ms/eval。S12-B-2 / S13-B-1 重开条件未触发。本轮新增 CPU 剖析站点预算（最大内站点 `partitionLiveCandidates` ~32% inclusive，整零仍亚线）与语料字符串基底保真（稳态残差 +10.6–13.2 µs/批）。R15-B A/A 与引擎代轴不补铸。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片已合入：空枚举，未铸 S16-C-*。生产中位复核 672.8–686.3 ms/报告（与 R14-C 657.6–689.3 同带）。两处从未点名微观（ICOL / SFILL）关闭探针不铸 ID。本轮新增 IRLS 迭代普查（ITERX）与 JIT 冷首报轴（COLDX，46.9–80.5 ms）。APC 组合天花板重锚 12.1–23.8 ms 仍亚带。R13–R15 无名微观与 AAFLR/GCAX 不补铸。r1c–r7c 绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。基线 `183df9b` 空 diff 再确认。

D 切片已合入：空枚举，未铸 S16-D-*。eval 地板复核配置态 3.47–3.62 ms（介于 R15-D 3.10–3.25 与 R14-D 4.05–4.21）。本轮新增 payload 字节形态轴：L schema 封闭（65 字符后缀 fail-closed）；H 越 10 ms 于 ~4,486–4,684 chars；O 越 10 ms 于 ~2,646–2,733 chars（斜率 88–89% 属切片外 analyzeTask）；σ 全幅 0.18–0.42 ms 无越线；P eval 侧越 10 ms 于 249–259 KB（27–28×）。R14-D / R15-D 轴不补铸。8 项换名拒绝不铸 ID。基线 `82bef36` 空 diff 再确认。

E 切片 = `src/learning/`（10 文件）。不要重开 S8-E-1（勿去重 `loadLearnedRouting`）/ S9-E-2（负优化）/ S13-B-1。R10-E…R15-E 空枚举、未铸 ID。SLICE-CPU R15-E：20.9–22.4 µs/run（历史带 11–24）。R15-E GC/分配格（~54–58 KiB/run，0.74–0.82 µs）与 A/A 噪声地板（18 格 0/18 伪稳）不补铸。R14-E 规模越线（E\*≈18k–19k）与 JIT 档不补铸。R13-E 三处无名微观不补铸。基线 `adb20d7` 预期空 diff。

F 切片 = `src/experiments/`（15 文件）。必须站在已落地 S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2。**S7-F-1 不是 S6-F-5**。不要重开 S1-F-1..8 / S5-F-* / S6-F-* / S7-F-1..2 / S8-F-* / S9-F-3。R10-F…R15-F 空枚举、未铸 ID。全实验锚点 R15-F：120.7–132.3 ms。R15-F A/A MDE（max-abs 1.04–2.64 ms）、条目长度格与引擎代格不补铸。R14-F GC/出处/deopt 与无名哈希规范化不补铸。若落地代码：重跑 r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）+ 新 r16f 仿真。基线 `519101f` 预期空 diff。

G 切片 = 42 文件：`src/run/` 除 child-tracking.ts / gate-apply.ts（属 A）、`src/supervisor/` 除 model-router.ts（属 B）、`src/graph/`、`src/domain/`。不要重开 S1-G-* … S9-G-3 / S10-G-1 / S11-G-1..3。R12-G…R15-G 空枚举、未铸 ID。禁止去 fsync / 完整性再哈希。计算顶 R15-G：0.290–0.297 ms vs I/O 89.7–103.5 ms。R15-G A/A（16 胞 0/16 伪稳）与引擎代轴不补铸。R14-G 引擎态/规模轴与 digest `06cbcf92c098c8f0` 不补铸。基线 `4efee23` 预期空 diff。
