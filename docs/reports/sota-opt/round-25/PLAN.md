# Round 25 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–24 已对各区做过二十四遍穷尽裁决（Round 24 已关闭），并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S24-* 条目（含已合入的 S13-B-1 与 R12–R24 全部空枚举收口，含刚合入的 R23-A … R23-J / R24-A … R24-J / R25-A / R25-B / R25-D）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。禁止再编号 **FITQ** / **NAMESHAPE** / **SCALEX** / **XPROC** / **YMIX** / **SCHEDWIN** / **KFAN** / **NVG** / **SEEDX** / **TERMCLASS** / **SHAPEK** / **ORDX** / **CKMIX** / **CALLB** / **OCCX** / **JB** / **RUNLIM** / **VALCLASS**。空枚举轴「M=1 catalog collapse」「approval-authority face」「state serialization-boundary provenance face」「operand-residency census」「adaptation-state coordinate」「value-domain / string content-class census」「task-face optional-field presence topology」「identity-coordinate face」不铸 ID、不写入排除表，但禁止再编号或跨区移植。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R25-A … R25-J），报告写入 `docs/reports/sota-opt/round-25/`。

状态：第 1 波 A/B 已合入、C 运行中；第 2 波 D 已合入、E 运行中；第 3 波 F 本波派出。Round 24 已关闭。

A 切片已合入：空枚举，未铸 S25-A-*。切片 `git diff 7acb666..HEAD` 为空（二十五遍零 diff）。预算复核 ~69–89 µs/run（与 R24-A 67–84 重叠同带；89 为基准次序孤点）。本轮新增 value-domain / string content-class census（axis 14：固定计数、固定长度下字节内容类；正则扫描最坏类 ×1.40–1.49；hash mixed ×1.42–1.44；includes 分歧非单调；e2e 生产长度零牵引；穿越点高 4–4.7 个量级；F5a–F5e 三次逐字节一致）。R24-A list-dimension / R23-A G×E / R22-A 公开导出普查 / R21-A H 输入面 / R20-A openMinors 不补铸。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S25-B-*。切片 `git diff 94ed3d9..HEAD` 为空。天花板复核 M=2 9.06–9.29 / M=10 17.92–18.80 ms/eval（与 R24-B 8.75–9.07 / 17.78–17.95 相邻或重合）。S12-B-2 / S13-B-1 重开条件未触发。本轮新增 task-face optional-field presence topology（AssignableTask `{contractRisk, contextTokens, outputTokens}` 的 2³ 存在性角 × 剂量 × 形状；生产三调用方均为裸三元组，存在性剂量结构性 0%；CR@100% −0.24~−0.39 ms/eval；其余臂 +0.02~+0.43，低落地线约两量级）。R24-B M=1 catalog collapse 与 R23-B batch arrangement / R22-B 标识符几何（G×T）不补铸。基线 `94ed3d9` 空 diff 再确认。

C 切片 = 离线路由 9 文件。必须站在 S1-C … S7-C。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / TAILG / REJX / **FITQ** / **SCALEX** / **YMIX** / **SEEDX** / **ORDX** / **OCCX**。R25-D identity-coordinate face / R25-B task-face optional-field presence topology / R25-A value-domain / string content-class census / R24-I adaptation-state coordinate / R24-H operand-residency census / **VALCLASS** / **JB** / **RUNLIM** / **CALLB** / **CKMIX** 不要移植。生产中位 R24-C：658.9–675.3 ms；APC ceiling 15.9–22.7 < 35；sink=7.309。若落地：重跑 r1c–r7c（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）+ r25c。基线 `183df9b` 预期空 diff。运行中。

D 切片已合入：空枚举，未铸 S25-D-*。切片 `git diff 82bef36..HEAD` 为空。eval 地板复核 3.55–4.28 ms（run 2/3 的 3.55–3.57 落在 R24-D 3.55–3.68 带内；run 1 的 4.28 记为次序孤点）。S9-D-4 / S12-D-1 未重开。本轮新增 identity-coordinate face（`ResourceKind` × `ResourceScope` 20 坐标格；生产只构造 `routing-policy×project` 一格，其余 19 格零通量；坐标对决 −360~−950 ns/promote，与噪声同阶）。R24-D approval-authority face 与 R23-D 两相 P-dose / R22-D 公开导出流普查不补铸。基线 `82bef36` 空 diff 再确认。

E 切片 = `src/learning/` 10 文件。不要重开 S8-E-1 / S9-E-2 / S13-B-1。R24-E **JB** 与 R23-E GS / R22-E **NVG** 不补铸。R25-D identity-coordinate face / R25-B task-face optional-field presence topology / R25-A value-domain / string content-class census / **VALCLASS** 不要移植。R24-I adaptation-state coordinate 不要作为 E ID 补铸。SLICE-CPU R24-E 本轮构成 16.1–17.5 µs/run。基线 `adb20d7` 预期空 diff。运行中。

F 切片 = `src/experiments/` 15 文件。**S7-F-1 不是 S6-F-5**。R24-F state serialization-boundary provenance face 与 R23-F plan count-field 联合面 / R22-F membership-topology 不补铸。R25-D identity-coordinate face / R25-B task-face optional-field presence topology / R25-A value-domain / string content-class census / **VALCLASS** 不要移植。锚点 R24-F：r5f 120.1–121.3 / r6f 126.9。若落地：重跑 r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）+ r25f。基线 `519101f` 预期空 diff。本波派出。

G 切片 = 42 文件。禁止去 fsync / 完整性再哈希。**RUNLIM** / **CKMIX** / **TERMCLASS** / **SCHEDWIN** / **XPROC** / **NAMESHAPE** / BYTESHAPE / SYSCENSUS / digest `06cbcf92c098c8f0` 不补铸。R25-D identity-coordinate face / R25-B task-face optional-field presence topology / R25-A value-domain / string content-class census / **VALCLASS** 不要移植。计算顶 R24-G：0.289–0.312 vs I/O 92.3–111.6 ms。基线 `4efee23` 预期空 diff。

H 切片 = 21 文件（evaluation **8**）。S5-H-1 必须保留。R24-H operand-residency census 与 R23-H rubric-registry membership-mix / R22-H 调用上下文不补铸。R25-D identity-coordinate face / R25-B task-face optional-field presence topology / R25-A value-domain / string content-class census / **VALCLASS** 不要移植。热层默认 R24-H：9.37–9.76 µs/run。PATH_RE 仅当目标为程序化/对抗或真实载荷 ≥~3.2K 无斜杠 `[\w.-]` 才重开。基线 `fd437a9` 预期空 diff。

I 切片 = 25 文件。S8-I-1 两臂文件级 blocked。R24-I adaptation-state coordinate 与 R23-I `.pi/` 可观测树 / R22-I run-record 回读 / R21-I flowchart 平面不补铸。R25-D identity-coordinate face / R25-B task-face optional-field presence topology / R25-A value-domain / string content-class census / **VALCLASS** 不要移植。custom−builtin R24-I：children +44.2/+26.5、track +48.0/+25.9、flowchart-flat64 +48.7/+16.3 ms。若落地：重跑 r4i/r5i/r7i（68 / 119 / 80）+ r25i。基线 `8dee7fb` 预期空 diff。

J 切片 = 29 文件。J1 / S5-J-3 / S6-J-1 / S8-J-2 钉死。禁止去 fsync。R24-J **VALCLASS** 与 R23-J **CALLB** / R22-J **SHAPEK** / R21-J **KFAN** 不补铸。R25-D identity-coordinate face / R25-B task-face optional-field presence topology / R25-A value-domain / string content-class census / R24-I adaptation-state coordinate 不要移植。file-lock retryMs 已由 D/E 定价，勿作为 J ID 补铸。若落地：重跑 J1（2468）+ r25j。基线 `fb41417` 预期空 diff。R24-J 已合入，勿补铸 **VALCLASS**。
