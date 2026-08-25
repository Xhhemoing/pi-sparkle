# Round 27 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–26 已对各区做过二十六遍穷尽裁决（Round 26 已关闭，全部空枚举），并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S26-* 条目（含已合入的 S13-B-1 与 R12–R26 全部空枚举收口，含刚合入的 R25-A … R25-J / R26-A … R26-J）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。禁止再编号 **FITQ** / **NAMESHAPE** / **SCALEX** / **XPROC** / **YMIX** / **SCHEDWIN** / **KFAN** / **NVG** / **SEEDX** / **TERMCLASS** / **SHAPEK** / **ORDX** / **CKMIX** / **CALLB** / **OCCX** / **JB** / **RUNLIM** / **VALCLASS** / **CG** / **AGEX** / **COTARG** / **PRICEX** / **RTL** / **DELINV**。空枚举轴「M=1 catalog collapse」「approval-authority face」「state serialization-boundary provenance face」「operand-residency census」「adaptation-state coordinate」「value-domain / string content-class census」「task-face optional-field presence topology」「identity-coordinate face」「plan-header identity-geometry face」「injection command-kind face」「consumer-stage string-representation census」「process-environment coordinate」「collation-locale face」「privacy / provider-policy constraint-leg face」「injection-seam default-arm face」「input storage-state face」「edge condition-kind face」「argv surface-form face」「consumer-stage operand-realm face」不铸 ID、不写入排除表，但禁止再编号或跨区移植。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R27-A … R27-J），报告写入 `docs/reports/sota-opt/round-27/`。

状态：第 1 波 A/B 运行中、C 本波派出。Round 26 已关闭。

A 切片 = 14 文件（`src/tracking/` 12 + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`）。切片 `git diff 7acb666..HEAD` 预期为空。预算默认 R26-A：~69–84 µs/run（13.7–16.8 µs/gate）。R26-A collation-locale face 与 R25-A value-domain / string content-class census / R24-A list-dimension / R23-A G×E / R22-A 公开导出普查 / R21-A H 输入面 / R20-A openMinors / R25-I process-environment coordinate / R26-I argv surface-form face / R26-J **DELINV** / R26-H consumer-stage operand-realm face 不补铸。基线 `7acb666` 预期空 diff。运行中。若落地：重跑跟踪门控仿真 + r27a。

B 切片 = 10 文件（live routing r0/assign/assign-plan/policy/live-cascade/live-selection/analyze-task/primary-catalog/catalog-model + `src/supervisor/model-router.ts`）。天花板默认 R26-B：M=2 ~9.1–9.3 / M=10 ~17.9–18.8 ms/eval。S12-B-2 / S13-B-1 重开条件未触发则勿重开。R26-B privacy / provider-policy constraint-leg face 与 R25-B task-face optional-field presence topology / R24-B M=1 catalog collapse / R23-B batch arrangement / R22-B 标识符几何（G×T）不补铸。R26-A collation-locale face / R26-I argv surface-form face / R26-J **DELINV** / R26-H consumer-stage operand-realm face 不要移植。基线 `94ed3d9` 预期空 diff。运行中。

C 切片 = 9 文件（offline：r1 / r1-shadow-report / posterior / offline-logit / offline-prob-add / propensity / lin-alg / bandit / shadow）。生产中位默认 R26-C：663.0–669.9 ms。APC ceiling 19.5–22.9 < 35；sink=7.309。**PRICEX** / **AGEX** / **FITQ** / **SCALEX** / **YMIX** / **SEEDX** / **ORDX** / **OCCX** 不补铸。R26-A collation-locale face / R26-I argv surface-form face / R26-J **DELINV** / R26-H consumer-stage operand-realm face 不要移植。基线 `183df9b` 预期空 diff。本波派出。若落地：重跑 r1c–r7c（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）+ r27c。

D 切片 = 14 文件（`src/adaptation/`）。eval 地板默认 R25-D / R26-D：3.55–4.28 ms 带重叠。S9-D-4 / S12-D-1 未重开。R26-D injection-seam default-arm face 与 R25-D identity-coordinate face / R24-D approval-authority face / R23-D 两相 P-dose / R22-D 公开导出流普查不补铸。R26-A collation-locale face / R26-I argv surface-form face / R26-J **DELINV** 不要移植。基线 `82bef36` 预期空 diff。等待派出。

E 切片 = 10 文件（`src/learning/`）。SLICE-CPU 默认 R26-E：14.7–15.2 µs/run（cmp25 回放）。S8-E-1 / S9-E-2 / S13-B-1 未重开。**RTL** / **CG** / **JB** / **NVG** 不补铸。R26-A collation-locale face / R26-I argv surface-form face / R26-J **DELINV** 不要移植。基线 `adb20d7` 预期空 diff。等待派出。

F 切片 = 15 文件（`src/experiments/`）。锚点默认 R26-F：r5f 119.27/120.95、r6f 119.37、r7f 128.85/128.88。S7-F-1 ≠ S6-F-5。R26-F input storage-state face 与 R25-F plan-header identity-geometry face / R24-F state serialization-boundary provenance face / R23-F plan count-field 联合面 / R22-F membership-topology 不补铸。基线 `519101f` 预期空 diff。等待派出。若落地：重跑 r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）+ r27f。

G 切片 = 42 文件（`src/run/` 除 A 两文件；`src/supervisor/` 除 model-router；`src/graph/`；`src/domain/`）。计算顶默认 R26-G：0.286–0.305 vs I/O 90.7–96.9 ms（~311–318×）。digest `06cbcf92c098c8f0` 第十七次逐位相同，勿补铸 digest。R26-G edge condition-kind face 与 R25-G injection command-kind face / **RUNLIM** / **CKMIX** / **TERMCLASS** / **SCHEDWIN** / **XPROC** / **NAMESHAPE** 不补铸。基线 `4efee23` 预期空 diff。等待派出。

H 切片 = 21 文件（evaluation **8** + requirement 7 + review 4 + rubric 2）。S5-H-1 必须保留。R26-H consumer-stage operand-realm face 与 R25-H consumer-stage string-representation census / R24-H operand-residency census / R23-H rubric-registry membership-mix / R22-H 调用上下文 / R26-F input storage-state face 不补铸。热层默认 R26-H：9.22–9.75 µs/run。PATH_RE 仅当目标为程序化/对抗或真实载荷 ≥~3.2K 无斜杠 `[\w.-]` 才重开。基线 `fd437a9` 预期空 diff。等待派出。

I 切片 = 25 文件（cli 13 + pi-adapter 9 + config 2 + telemetry 1）。S8-I-1 两臂文件级 blocked。R26-I argv surface-form face 与 R25-I process-environment coordinate / R24-I adaptation-state coordinate / R23-I `.pi/` 可观测树 / R22-I run-record 回读 / R21-I flowchart 平面 / **NAMESHAPE** 不补铸。custom−builtin 默认 R26-I：children +43.4~+61.7 / +24.0~+27.8、track +48.5~+52.6 / +25.7~+36.9、flowchart-flat64 +47.1~+49.2 / +12.0~+28.2 ms。基线 `8dee7fb` 预期空 diff。等待派出。若落地：重跑 r4i/r5i/r7i（68 / 119 / 80）+ r27i。

J 切片 = 29 文件。J1 / S5-J-3 / S6-J-1 / S8-J-2 钉死。禁止去 fsync。R26-J **DELINV** 与 R25-J **COTARG** / R24-J **VALCLASS** / R23-J **CALLB** / R22-J **SHAPEK** / R21-J **KFAN** 不补铸。R26-I argv surface-form face / R26-G edge condition-kind face / R25-I process-environment coordinate 不要移植。file-lock retryMs 已由 D/E 定价，勿作为 J ID 补铸。基线 `fb41417` 预期空 diff。等待派出。若落地：重跑 J1（2468）+ r27j。I/O 地板 R26-J：preferences 146.7–235.0 / 415.6–541.0 µs；jsonl 61.3–68.8 / 197.3–337.3 µs。
