# Round 26 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–25 已对各区做过二十五遍穷尽裁决（Round 25 已关闭），并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S25-* 条目（含已合入的 S13-B-1 与 R12–R25 全部空枚举收口，含刚合入的 R24-A … R24-J / R25-A … R25-J）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。禁止再编号 **FITQ** / **NAMESHAPE** / **SCALEX** / **XPROC** / **YMIX** / **SCHEDWIN** / **KFAN** / **NVG** / **SEEDX** / **TERMCLASS** / **SHAPEK** / **ORDX** / **CKMIX** / **CALLB** / **OCCX** / **JB** / **RUNLIM** / **VALCLASS** / **CG** / **AGEX** / **COTARG**。空枚举轴「M=1 catalog collapse」「approval-authority face」「state serialization-boundary provenance face」「operand-residency census」「adaptation-state coordinate」「value-domain / string content-class census」「task-face optional-field presence topology」「identity-coordinate face」「plan-header identity-geometry face」「injection command-kind face」「consumer-stage string-representation census」「process-environment coordinate」不铸 ID、不写入排除表，但禁止再编号或跨区移植。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R26-A … R26-J），报告写入 `docs/reports/sota-opt/round-26/`。

状态：第 1 波 A/B 运行中、C 本波派出。Round 25 已关闭。

A 切片 = `src/tracking/` 12 文件 + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14）。不要重开 G×E / list-dimension / R22-A 公开导出普查 / R21-A H 输入面 / R20-A openMinors / R25-A value-domain / string content-class census。R25-J **COTARG** / R25-I process-environment coordinate / R25-H consumer-stage string-representation census / R25-G injection command-kind face / R25-F plan-header identity-geometry face / R25-D identity-coordinate face / R25-B task-face optional-field presence topology / R24-B M=1 catalog collapse / R24-D approval-authority face / R24-F state serialization-boundary provenance face / R24-H operand-residency census / **JB** / **OCCX** / **CALLB** / **CKMIX** / **RUNLIM** / **VALCLASS** / **CG** / **AGEX** 不要移植。预算 R25-A：~69–89 µs/run。基线 `7acb666` 预期空 diff。运行中。

B 切片 = live 路由 10 文件。Live = R0。不要重开 S12-B-2 / S13-B-1（重开条件未触发）。R25-B task-face optional-field presence topology 与 R24-B M=1 catalog collapse / R23-B batch arrangement / R22-B 标识符几何（G×T）不补铸。R25-J **COTARG** / R25-I process-environment coordinate / R25-H consumer-stage string-representation census 不要移植。天花板 R25-B：M=2 9.06–9.29 / M=10 17.92–18.80 ms/eval。基线 `94ed3d9` 预期空 diff。运行中。

C 切片 = 离线路由 9 文件。必须站在 S1-C … S7-C。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / TAILG / REJX / **FITQ** / **SCALEX** / **YMIX** / **SEEDX** / **ORDX** / **OCCX** / **AGEX** / **COTARG**。生产中位 R25-C：663.2–681.5 ms（正典 663.2–672.8）；APC ceiling 20.8–25.6 < 35；sink=7.309。若落地：重跑 r1c–r7c（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）+ r26c。基线 `183df9b` 预期空 diff。本波派出。

D 切片 = `src/adaptation/` 14 文件。不要重开 S9-D-4 / S12-D-1。R25-D identity-coordinate face 与 R24-D approval-authority face / R23-D 两相 P-dose / R22-D 公开导出流普查不补铸。eval 地板 R25-D：3.55–4.28 ms。基线 `82bef36` 预期空 diff。

E 切片 = `src/learning/` 10 文件。不要重开 S8-E-1 / S9-E-2 / S13-B-1。R25-E **CG** 与 R24-E **JB** / R23-E GS / R22-E **NVG** 不补铸。SLICE-CPU R25-E：14.9–15.7 µs/run。基线 `adb20d7` 预期空 diff。

F 切片 = `src/experiments/` 15 文件。**S7-F-1 不是 S6-F-5**。R25-F plan-header identity-geometry face 与 R24-F state serialization-boundary provenance face / R23-F plan count-field 联合面 / R22-F membership-topology 不补铸。锚点 R25-F：r5f 121.25/130.67 / r6f 122.93 / r7f 127.56/130.12。若落地：重跑 r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）+ r26f。基线 `519101f` 预期空 diff。

G 切片 = 42 文件。禁止去 fsync / 完整性再哈希。R25-G injection command-kind face / **RUNLIM** / **CKMIX** / **TERMCLASS** / **SCHEDWIN** / **XPROC** / **NAMESHAPE** / BYTESHAPE / SYSCENSUS / digest `06cbcf92c098c8f0` 不补铸。计算顶 R25-G：0.290/0.304/0.297 vs I/O 103.2/96.5/94.3 ms。基线 `4efee23` 预期空 diff。

H 切片 = 21 文件（evaluation **8**）。S5-H-1 必须保留。R25-H consumer-stage string-representation census 与 R24-H operand-residency census / R23-H rubric-registry membership-mix / R22-H 调用上下文不补铸。热层默认 R25-H：9.31–10.25 µs/run。PATH_RE 仅当目标为程序化/对抗或真实载荷 ≥~3.2K 无斜杠 `[\w.-]` 才重开。基线 `fd437a9` 预期空 diff。

I 切片 = 25 文件。S8-I-1 两臂文件级 blocked。R25-I process-environment coordinate 与 R24-I adaptation-state coordinate / R23-I `.pi/` 可观测树 / R22-I run-record 回读 / R21-I flowchart 平面不补铸。custom−builtin R25-I：children +37.0~+50.7 / +20.9~+25.8、track +45.7~+53.1 / +23.6~+25.6、flowchart-flat64 +42.3~+52.5 / +15.1~+24.9 ms。若落地：重跑 r4i/r5i/r7i（68 / 119 / 80）+ r26i。基线 `8dee7fb` 预期空 diff。R25-I 已合入，勿补铸其轴。

J 切片 = 29 文件。J1 / S5-J-3 / S6-J-1 / S8-J-2 钉死。禁止去 fsync。R25-J **COTARG** 与 R24-J **VALCLASS** / R23-J **CALLB** / R22-J **SHAPEK** / R21-J **KFAN** 不补铸。file-lock retryMs 已由 D/E 定价，勿作为 J ID 补铸。若落地：重跑 J1（2468）+ r26j。基线 `fb41417` 预期空 diff。R25-J 已合入，勿补铸其轴。I/O 地板 R25-J：preferences 150.8–217.6 / 403.9–521.4 µs；jsonl 60.2–68.2 / 228.7–391.6 µs。
