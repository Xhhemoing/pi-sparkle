# Round 15 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–14 已对各区做过十四遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S14-* 条目（含已合入的 S13-B-1 与 R12-A / R12-E / R12-F / R12-G / R12-H / R12-I / R12-J / R13-A / R13-C / R13-D / R13-E / R13-F / R13-G / R13-H / R13-I / R13-J / R14-A / R14-B / R14-C / R14-D / R14-E / R14-F / R14-G / R14-H / R14-I / R14-J / R15-A / R15-B 的空枚举收口）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R15-A … R15-J），报告写入 `docs/reports/sota-opt/round-15/`。

状态：第 2 波 C/D/E 本波派出；A/B 已合入（空枚举）。Round 14 已收口 10/10。

A 切片已合入：空枚举，未铸 S15-A-*。预算复核 69–83 µs/run（锚点 13.8–16.5 µs/gate，与 R14-A 69–81 同带）。本轮新增 per-turn 集合规模越线（C≈996–1,015 / R≈1,020–1,037 达 10 ms/run）、GC/分配格（~22 KB/gate，摊销 ~1.2 µs/run）与 JIT 档（14–15/16 turbofan，200k 门 0 deopt）。5 项换名拒绝不铸 ID。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S15-B-*。天花板复核 M=2 9.5–10.9、M=10 18.5–25.4、replay 7.3–9.9、10× 109.7–140.9 ms/eval。S12-B-2 重开条件未触发。本轮新增 A/A 噪声地板（N=2000 窗 max-abs 762–2346 µs，可出 5/5 伪稳）与引擎代敏感（Node 24 vs 22 稳态快 15–30%，无越线）。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片 = 9 文件：`src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`。必须站在已落地 S7-C。最后生产改动 `183df9b`；预期 `git diff 183df9b..HEAD --` 对本切片为空。不要重开 S1-C-1..10 / S2-C-1..5 / S3-C-1..3 / S4-C-1..6 / S5-C-1..7 / S6-C-1..7 / S7-C-1..4 / S8-C-1..4 / S9-C-1..4 / S10-C-1..3 / S12-C-1。R11-C / R13-C / R14-C 空枚举（无 S11-C-* / S13-C-* / S14-C-*）。RID/CNT 已关。禁止 CMB 重排。S12-C-1 nest×layout 已关（重开条件：无）。R13-C 无名微观（PIVCSE / FINTAIL / REFZ / TSORT / DEG）与 R14-C 无名微观（SWORD / XF64 / IRLSDP / CMPH）不补铸。噪声带 ±35 ms；贴带不落地。r1c–r7c 必须保持绿：8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193。生产中位 R14-C：657.6–689.3 ms/报告。若落地代码：重跑 r1c–r7c + 新 r15c 仿真。

D 切片 = `src/adaptation/`（14 文件）。不要重开 S1-D-* … S8-D-1..3 / S9-D-4 / S10-D-1..2 / S11-D-1..2 / S12-D-1..2。R13-D / R14-D 空枚举、未铸 ID。禁止去 fsync / 完整性再哈希。S9-D-4 廉价 `toLowerCase` 跳过对 U+212A fail-open，永不重开；S12-D-1 廉价形态同族。eval 地板 R14-D：配置态 4.05–4.21 ms。R14-D 规模越线标定（可寻址池 0.53–0.54 ms，越 10 ms 需 17–18×；S6-D-5 50 ms 于 101–108×）不补铸。基线 `82bef36` 预期空 diff。

E 切片 = `src/learning/`（10 文件）。不要重开 S1-E-* … S8-E-1 / S9-E-2。R10-E / R11-E / R12-E / R13-E / R14-E 空枚举、未铸 ID。S8-E-1 双 `loadLearnedRouting` 不得去重。S9-E-2 是负优化。R13-E 三处无名微观与 R14-E 规模越线/JIT 档不补铸。S13-B-1 辖区未重提。SLICE-CPU 复核 17.2–19.2 µs/run（历史带 11–24）。基线 `adb20d7` 预期空 diff。
