# Round 16 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–15 已对各区做过十五遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S15-* 条目（含已合入的 S13-B-1 与 R12–R15 全部空枚举收口，含刚合入的 R15-J / R16-A）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R16-A … R16-J），报告写入 `docs/reports/sota-opt/round-16/`。

状态：第 2 波 D 本波派出；B/C 运行中。Round 15 已收口 10/10。A 已合入（空枚举）。

A 切片已合入：空枚举，未铸 S16-A-*。预算复核 66–76 µs/run（13.1–15.3 µs/gate，与 R15-A 69–83 同带）。本轮新增 payload 形态轴：id 字节 L 被 schema 结构性封闭（合法顶 +4.8–5.4 µs/run，无越线）；evidenceRefs 基数 V 越 10 ms 于 ≈21,447–25,331（约 4.0–4.1 量级高于生产 V=2）；摘要字节 S 越 10 ms 于 ≈1.32×10⁶ chars（约 4.9 量级）。R14-A E/max-codes 与 R15-A C/R/GC/JIT 不补铸。4 项换名拒绝不铸 ID。基线 `7acb666` 空 diff 再确认。

B 切片 = live 路由：`src/routing/{r0,assign,policy,live-cascade,analyze-task,primary-catalog,catalog-model,assign-plan,live-selection}.ts` + `src/supervisor/model-router.ts`。不要重开 S1-B-* … S12-B-1 / S12-B-2 / S13-B-1。R14-B / R15-B 空枚举、未铸 ID。天花板 R15-B：M=2 9.5–10.9 / M=10 18.5–25.4 / replay 7.3–9.9 / 10× 109.7–140.9 ms/eval。S12-B-2 重开条件：caller 传 `prior` 且 N≥10³（`eval-routing.ts` 仍传 learned，未触发）。S13-B-1 重开：`applyLearnedRouting` 体成本 ≥2 个量级。R15-B A/A 噪声地板与引擎代轴不补铸。Live = R0。基线 `94ed3d9` 预期空 diff。

C 切片 = 9 文件：`src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`。必须站在已落地 S7-C。最后生产改动 `183df9b`；预期 `git diff 183df9b..HEAD --` 对本切片为空。不要重开 S1-C-1..10 / S2-C-1..5 / S3-C-1..3 / S4-C-1..6 / S5-C-1..7 / S6-C-1..7 / S7-C-1..4 / S8-C-1..4 / S9-C-1..4 / S10-C-1..3 / S12-C-1。R11-C / R13-C / R14-C / R15-C 空枚举。RID/CNT 已关。禁止 CMB 重排。S12-C-1 nest×layout 已关（重开条件：无）。R13-C 无名微观（PIVCSE / FINTAIL / REFZ / TSORT / DEG）、R14-C（SWORD / XF64 / IRLSDP / CMPH）、R15-C（STORD / RIDGE）不补铸。R15-C AAFLR/GCAX 轴不补铸。噪声带 ±35 ms；贴带不落地。r1c–r7c 必须保持绿：8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193。生产中位 R15-C：660.6–667.1 ms/报告。若落地代码：重跑 r1c–r7c + 新 r16c 仿真。

D 切片 = `src/adaptation/`（14 文件）。不要重开 S1-D-* … S8-D-1..3 / S9-D-4 / S10-D-* / S11-D-* / S12-D-1..2。S9-D-4 便宜 `toLowerCase` 跳过对 U+212A fail-open，永不重开；S12-D-1 便宜形态同族。R13-D / R14-D / R15-D 空枚举、未铸 ID。eval 地板 R15-D：配置态 3.10–3.25 ms。R15-D 分配/GC（eval ~4.4–4.5 MB；全清分配 GC 侧上界 37–43 µs）与 A/A MDE（窗中位 |263–435| µs）不补铸。R14-D 规模越线（10 ms 于 17–18×；S6-D-5 50 ms 于 101–108×）不补铸。禁止 fail-open / 去完整性再哈希。基线 `82bef36` 预期空 diff。
