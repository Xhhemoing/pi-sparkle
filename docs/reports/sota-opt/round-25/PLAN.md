# Round 25 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–24 已对各区做过二十四遍穷尽裁决（Round 24 已关闭），并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S24-* 条目（含已合入的 S13-B-1 与 R12–R24 全部空枚举收口，含刚合入的 R23-A … R23-J / R24-A … R24-J / R25-A … R25-J）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。禁止再编号 **FITQ** / **NAMESHAPE** / **SCALEX** / **XPROC** / **YMIX** / **SCHEDWIN** / **KFAN** / **NVG** / **SEEDX** / **TERMCLASS** / **SHAPEK** / **ORDX** / **CKMIX** / **CALLB** / **OCCX** / **JB** / **RUNLIM** / **VALCLASS** / **CG** / **AGEX** / **COTARG**。空枚举轴「M=1 catalog collapse」「approval-authority face」「state serialization-boundary provenance face」「operand-residency census」「adaptation-state coordinate」「value-domain / string content-class census」「task-face optional-field presence topology」「identity-coordinate face」「plan-header identity-geometry face」「injection command-kind face」「consumer-stage string-representation census」「process-environment coordinate」不铸 ID、不写入排除表，但禁止再编号或跨区移植。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R25-A … R25-J），报告写入 `docs/reports/sota-opt/round-25/`。

状态：第 1–4 波 A–J 已合入，Round 25 关闭。Round 26 已开卷（A/B 运行中、C 本波派出）。

A 切片已合入：空枚举，未铸 S25-A-*。切片 `git diff 7acb666..HEAD` 为空（二十五遍零 diff）。预算复核 ~69–89 µs/run（与 R24-A 67–84 重叠同带；89 为基准次序孤点）。本轮新增 value-domain / string content-class census（axis 14：固定计数、固定长度下字节内容类；正则扫描最坏类 ×1.40–1.49；hash mixed ×1.42–1.44；includes 分歧非单调；e2e 生产长度零牵引；穿越点高 4–4.7 个量级；F5a–F5e 三次逐字节一致）。R24-A list-dimension / R23-A G×E / R22-A 公开导出普查 / R21-A H 输入面 / R20-A openMinors 不补铸。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S25-B-*。切片 `git diff 94ed3d9..HEAD` 为空。天花板复核 M=2 9.06–9.29 / M=10 17.92–18.80 ms/eval（与 R24-B 8.75–9.07 / 17.78–17.95 相邻或重合）。S12-B-2 / S13-B-1 重开条件未触发。本轮新增 task-face optional-field presence topology（AssignableTask `{contractRisk, contextTokens, outputTokens}` 的 2³ 存在性角 × 剂量 × 形状；生产三调用方均为裸三元组，存在性剂量结构性 0%；CR@100% −0.24~−0.39 ms/eval；其余臂 +0.02~+0.43，低落地线约两量级）。R24-B M=1 catalog collapse 与 R23-B batch arrangement / R22-B 标识符几何（G×T）不补铸。基线 `94ed3d9` 空 diff 再确认。

C 切片已合入：空枚举，未铸 S25-C-*。切片 `git diff 183df9b..HEAD` 为空。生产中位复核 663.2–681.5 ms（正典 663.2–672.8，落在 R24-C 658.9–675.3 带内；681.5 记为尾重复核孤点）。本轮新增 **AGEX**（时间坐标 / 年龄结构剂量：attribution 面响应恰为零；posterior/R1 年龄可归因差 1.13–3.89 ms，低 35 ms 带 9–31×）。APC ceiling 20.8–25.6 < 35；sink=7.309。ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / TAILG / REJX / **FITQ** / **SCALEX** / **YMIX** / **SEEDX** / **ORDX** / **OCCX** 不补铸。基线 `183df9b` 空 diff 再确认。

D 切片已合入：空枚举，未铸 S25-D-*。切片 `git diff 82bef36..HEAD` 为空。eval 地板复核 3.55–4.28 ms（run 2/3 的 3.55–3.57 落在 R24-D 3.55–3.68 带内；run 1 的 4.28 记为次序孤点）。S9-D-4 / S12-D-1 未重开。本轮新增 identity-coordinate face（`ResourceKind` × `ResourceScope` 20 坐标格；生产只构造 `routing-policy×project` 一格，其余 19 格零通量；坐标对决 −360~−950 ns/promote，与噪声同阶）。R24-D approval-authority face 与 R23-D 两相 P-dose / R22-D 公开导出流普查不补铸。基线 `82bef36` 空 diff 再确认。

E 切片已合入：空枚举，未铸 S25-E-*。切片 `git diff adb20d7..HEAD` 为空。SLICE-CPU 复核 14.9–15.7 µs/run（与 R24-E 16.1–17.5 同带）。S8-E-1 / S9-E-2 / S13-B-1 未重开。本轮新增 **CG**（per-key 重述链面：链深 D × 增长/钉死类；增长类边际 127.6–153.8 ns/retry；生产 maxAttempts 硬顶 1–2，天花板 258–358 ns/task；穿越点高 3.4–3.5 个量级）。R24-E **JB** 与 R23-E GS / R22-E **NVG** 不补铸。基线 `adb20d7` 空 diff 再确认。

F 切片已合入：空枚举，未铸 S25-F-*。切片 `git diff 519101f..HEAD` 为空（十九遍零 diff）。锚点复核 r5f C2 121.25/130.67、r6f 122.93、r7f 127.56/130.12（落在历史带内；r7f 自 R24-F 热窗回落）。S7-F-1 ≠ S6-F-5 再核。本轮新增 plan-header identity-geometry face（`experimentId`/`baselineVersionId`/`candidateId` 长度几何；整头拆除天花板 0.387–0.437 ms/experiment，低落地线两量级；夹具 vs 生产几何差 0.19–0.24 ms 亚噪声）。R24-F state serialization-boundary provenance face 与 R23-F plan count-field 联合面 / R22-F membership-topology 不补铸。基线 `519101f` 空 diff 再确认。

G 切片已合入：空枚举，未铸 S25-G-*（连续第十四次）。切片 `git diff 4efee23..HEAD` 为空。计算顶复核 0.290/0.304/0.297 vs I/O 103.2/96.5/94.3 ms（~317–356× 支配，落在派单带内）。digest `06cbcf92c098c8f0` 第十六次逐位相同。本轮新增 injection command-kind face（`fact`/`override`/`skip` × 运行态 × 目标节点；kind 交换零形状；delta ±34–302 ns，低落地线 4–5 个量级）。**RUNLIM** / **CKMIX** / **TERMCLASS** / **SCHEDWIN** / **XPROC** / **NAMESHAPE** / BYTESHAPE / SYSCENSUS 不补铸。禁止去 fsync / 完整性再哈希。基线 `4efee23` 空 diff 再确认。

H 切片已合入：空枚举，未铸 S25-H-*。切片 `git diff fd437a9..HEAD` 为空。热层默认复核 9.31–10.25 µs/run（一次落 R24-H 9.37–9.76 带内，两次为跨代抖动上缘，同 R17-H/R19-H 型）。S5-H-1 再核保留。PATH_RE 重开条件未触发。本轮新增 consumer-stage string-representation census（门+precedence 消费串的 V8 表示：interned-literal / fresh-flat / cons / sliced / two-byte；K1 比 1.53–2.08 <3×；最坏臂 6.5 µs，低落地线 3+ 量级）。R24-H operand-residency census 与 R23-H rubric-registry membership-mix / R22-H 调用上下文不补铸。基线 `fd437a9` 空 diff 再确认。

I 切片已合入：空枚举，未铸 S25-I-*（连续第十八次）。切片 `git diff 8dee7fb..HEAD` 为空。S8-I-1 仍文件级 blocked。custom−builtin 复核 children +37.0~+50.7 / +20.9~+25.8、track +45.7~+53.1 / +23.6~+25.6、flowchart-flat64 +42.3~+52.5 / +15.1~+24.9 ms（与 R24-I 同带）。本轮新增 process-environment coordinate（第四配置态坐标系：env 门 vs providers 门平坦、env-pair 剂量 +2.0~+5.9 ms、I 切片门段 0.68 µs/run）。R24-I adaptation-state coordinate 与 R23-I `.pi/` 可观测树 / R22-I run-record 回读 / R21-I flowchart 平面不补铸。基线 `8dee7fb` 空 diff 再确认。

J 切片已合入：空枚举，未铸 S25-J-*。切片 `git diff fb41417..HEAD` 为空。I/O 地板复核与历史带重叠（preferences 写 150.8–217.6 / 403.9–521.4 µs；jsonl 60.2–68.2 / 228.7–391.6 µs；删除级联 623.5–746.8 / 263.2–294.5 µs；context index 40.4–40.9 µs；track plan 1.08–1.11 / 2.59–2.65 µs）。J1 等价仿真 2468 全绿。本轮新增 **COTARG**（显式锚共靶拓扑面：同一主体对内显式/推断键重叠 × 一致极性；写/水合/消费腿亚噪声；loop-eval 不相交格 +0.11 ms/eval 为零生产调用方语义差）。**VALCLASS** / **CALLB** / **SHAPEK** / **KFAN** / R20-J 输入类组成不补铸。基线 `fb41417` 空 diff 再确认。
