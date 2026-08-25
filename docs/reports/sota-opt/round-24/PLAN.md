# Round 24 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–23 已对各区做过二十三遍穷尽裁决（Round 23 已关闭），并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S23-* 条目（含已合入的 S13-B-1 与 R12–R23 全部空枚举收口，含刚合入的 R23-A … R23-J / R24-A … R24-F；R24-G / R24-H 仍在飞，勿触其分支）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。禁止再编号 **FITQ** / **NAMESHAPE** / **SCALEX** / **XPROC** / **YMIX** / **SCHEDWIN** / **KFAN** / **NVG** / **SEEDX** / **TERMCLASS** / **SHAPEK** / **ORDX** / **CKMIX** / **CALLB** / **OCCX** / **JB**。空枚举轴「M=1 catalog collapse」「approval-authority face」「state serialization-boundary provenance face」不铸 ID、不写入排除表，但禁止再编号或跨区移植。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R24-A … R24-J），报告写入 `docs/reports/sota-opt/round-24/`。

状态：第 1 波 A/B/C 已合入；第 2 波 D/E 已合入；第 3 波 F 已合入、G/H 运行中；第 4 波 I 本波派出。Round 23 已关闭。

A 切片已合入：空枚举，未铸 S24-A-*。切片 `git diff 7acb666..HEAD` 为空。预算复核 67–84 µs/run（与 R23-A 66–78 同带）。本轮新增 residual input-face list-dimension 普查（N_op 5.89–6.03 ns/op；N_cl 29.80–31.38 ns/claim×3；W×O / Q×D 二次位点生产流量为零；CF 平坦）。R23-A G×E / R22-A 公开导出普查 / R21-A H 输入面 / R20-A openMinors 不补铸。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S24-B-*。切片 `git diff 94ed3d9..HEAD` 为空。天花板复核 M=2 8.75–9.07 / M=10 17.78–17.95 ms/eval（与 R22-B 8.79–9.13 / 17.63–18.12 同带，邻接 R23-B 9.20–9.48 / 17.64–18.52）。S12-B-2 / S13-B-1 重开条件未触发。本轮新增生产可达 M=1 catalog collapse（配置态 adapt eval 经 `catalogFromPrimary` 无 fastModelId + `inferFastId` 自返塌成单行；6.02–7.00 ms/eval，低于此前全部 eval 面数字；M 轴仿射下延至轴底，边际 1.02–1.35 ms/eval·model）。R23-B batch arrangement 与 R22-B 标识符几何（G×T）/ R21-B public-prior 快照形状不补铸。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片已合入：空枚举，未铸 S24-C-*。切片 `git diff 183df9b..HEAD` 为空。生产中位复核 658.9–675.3 ms（正典 662.4–668.4，与 R23-C 660.7–665.4 同带）。本轮新增 **OCCX**（格胞占据 / 集中度剂量响应：方法线第五输入维；solve 单价随 p、irls-other 随 K+p²；无越线点，结构放大帽 ×1.35 < ×5.1）。APC ceiling 15.9–22.7 < 35；sink=7.309。ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / TAILG / REJX / **FITQ** / **SCALEX** / **YMIX** / **SEEDX** / **ORDX** 不补铸。基线 `183df9b` 空 diff 再确认。

D 切片已合入：空枚举，未铸 S24-D-*。切片 `git diff 82bef36..HEAD` 为空。eval 地板复核 3.55–3.68 ms（落在 R23-D 3.39–3.74 带内）。S9-D-4 / S12-D-1 未重开。本轮新增 approval-authority face（自动提升模式 × 预算态：模式差 <150 ns/promote；预算腿 O(1) 至 2²⁰；生产零自定义 profile 调用方，无 10 ms 越线）。R23-D 两相 P-dose 与 R22-D 公开导出流普查 / R21-D 状态增长方向不补铸。基线 `82bef36` 空 diff 再确认。

E 切片已合入：空枚举，未铸 S24-E-*。切片 `git diff adb20d7..HEAD` 为空。SLICE-CPU 本轮构成 16.1–17.5 µs/run（种子互换逐位复现 R23-E 18.1–18.6 / R22-E 构成）。S8-E-1 / S9-E-2 / S13-B-1 未重开。本轮新增 **JB**（铸造级连接/绑定命运面：collect 第一遍五图 join 与 outcomesFromRoutedRun 路由 join；全绑定相对未绑定 +356–505 ns/event；整构成翻转仅 9.3–13.1 µs/run）。R23-E GS 与 R22-E **NVG** / R21-E 标识符几何不补铸。基线 `adb20d7` 空 diff 再确认。

F 切片已合入：空枚举，未铸 S24-F-*。切片 `git diff 519101f..HEAD` 为空。锚点复核 r5f 120.1–121.3 / r6f 126.9（与 R23-F 120.6–129.7 同带；r7f partE 偏热 133.6–134.3 记为窗抖动）。S7-F-1 ≠ S6-F-5 再核。本轮新增 state serialization-boundary provenance face（restore 状态半边：象限塌成布尔，DD−ID≈0；天花板 6.4–7.3 ms 低于落地线一量级）。R23-F plan count-field 联合面与 R22-F membership-topology / R21-F 时钟不补铸。基线 `519101f` 空 diff 再确认。

G 切片 = 42 文件。禁止去 fsync / 完整性再哈希。**CKMIX** / **TERMCLASS** / **SCHEDWIN** / **XPROC** / **NAMESHAPE** / BYTESHAPE / SYSCENSUS / digest `06cbcf92c098c8f0` 不补铸。R24-A list-dimension 普查 / R24-B M=1 catalog collapse / R24-D approval-authority face / R24-F state serialization-boundary provenance face / **JB** / **OCCX** / **CALLB** 不要移植。计算顶 R23-G：0.285–0.292 vs I/O 85.1–98.0 ms。基线 `4efee23` 预期空 diff。运行中。

H 切片 = 21 文件（evaluation **8**）。S5-H-1 必须保留。R23-H rubric-registry membership-mix 与 R22-H 调用上下文 / R21-H 异步调度面不补铸。R24-A list-dimension 普查 / R24-B M=1 catalog collapse / R24-D approval-authority face / R24-F state serialization-boundary provenance face / **JB** / **OCCX** / **CALLB** / **CKMIX** 不要移植。热层默认 R23-H：9.32–9.65 µs/run。PATH_RE 仅当目标为程序化/对抗或真实载荷 ≥~3.2K 无斜杠 `[\w.-]` 才重开。基线 `fd437a9` 预期空 diff。运行中。

I 切片 = 25 文件。S8-I-1 两臂文件级 blocked。R23-I `.pi/` 可观测树与 R22-I run-record 回读 / R21-I flowchart 平面 / R20-I 累积遥测 N 不补铸。R24-A list-dimension 普查 / R24-B M=1 catalog collapse / R24-D approval-authority face / R24-F state serialization-boundary provenance face / **JB** / **OCCX** / **CALLB** / **CKMIX** 不要移植。custom−builtin R23-I：children +42.9/+22.0、track +53.5/+25.4、flowchart-flat64 +39.2/+21.6 ms。若落地：重跑 r4i/r5i/r7i（68 / 119 / 80）+ r24i。基线 `8dee7fb` 预期空 diff。本波派出。

J 切片 = 29 文件。J1 / S5-J-3 / S6-J-1 / S8-J-2 钉死。禁止去 fsync。R23-J **CALLB** 与 R22-J **SHAPEK** / R21-J **KFAN** / R20-J 输入类组成不补铸。R24-A list-dimension 普查 / R24-B M=1 catalog collapse / R24-D approval-authority face / R24-F state serialization-boundary provenance face / **JB** / **OCCX** / **CKMIX** / R23-G 轴不要移植。file-lock retryMs 已由 D/E 定价，勿作为 J ID 补铸。若落地：重跑 J1（2468）+ r24j。基线 `fb41417` 预期空 diff。
