# Round 24 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–23 已对各区做过二十三遍穷尽裁决（Round 23 已关闭），并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S23-* 条目（含已合入的 S13-B-1 与 R12–R23 全部空枚举收口，含刚合入的 R23-A … R23-J）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。禁止再编号 **FITQ** / **NAMESHAPE** / **SCALEX** / **XPROC** / **YMIX** / **SCHEDWIN** / **KFAN** / **NVG** / **SEEDX** / **TERMCLASS** / **SHAPEK** / **ORDX** / **CKMIX** / **CALLB**。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R24-A … R24-J），报告写入 `docs/reports/sota-opt/round-24/`。

状态：第 1 波 A/B 运行中、C 本波派出。Round 23 已关闭。

A 切片 = `src/tracking/` 12 文件 + `src/run/{child-tracking,gate-apply}.ts`（14）。不要重开 R23-A G×E 自耦合 / R22-A 公开导出普查 / R21-A H 输入面 / R20-A openMinors。**CALLB** / **CKMIX** / **ORDX** / R23-E GS / R23-D P-dose / R23-B batch arrangement / **SHAPEK** 不要移植。预算 R23-A：66–78 µs/run。基线 `7acb666` 预期空 diff。

B 切片 = live 路由 10 文件。Live = R0。不要重开 S12-B-2 / S13-B-1（重开条件未触发）。R23-B batch arrangement 与 R22-B 标识符几何（G×T）/ R21-B public-prior 快照形状不补铸。**CALLB** / R23-I `.pi/` 可观测树 / **CKMIX** / **ORDX** / R23-A G×E 不要移植。天花板 R23-B：M=2 9.20–9.48 / M=10 17.64–18.52 ms/eval。基线 `94ed3d9` 预期空 diff。

C 切片 = 离线路由 9 文件。必须站在 S1-C … S7-C。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / TAILG / REJX / **FITQ** / **SCALEX** / **YMIX** / **SEEDX** / **ORDX**。**CALLB** / **CKMIX** / R23-I `.pi/` 可观测树 / R23-A G×E / R23-B batch arrangement 不要移植。生产中位 R23-C：660.7–665.4 ms；APC ceiling 14.6–16.0 < 35；sink=7.309。若落地：重跑 r1c–r7c（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）+ r24c。基线 `183df9b` 预期空 diff。本波派出。

D 切片 = `src/adaptation/` 14 文件。不要重开 S9-D-4 / S12-D-1。R23-D 两相 P-dose 与 R22-D 公开导出流普查 / R21-D 状态增长方向不补铸。eval 地板 R23-D：3.39–3.74 ms。基线 `82bef36` 预期空 diff。

E 切片 = `src/learning/` 10 文件。不要重开 S8-E-1 / S9-E-2 / S13-B-1。R23-E GS 与 R22-E **NVG** / R21-E 标识符几何不补铸。SLICE-CPU R23-E：18.1–18.6 µs/run。基线 `adb20d7` 预期空 diff。

F 切片 = `src/experiments/` 15 文件。**S7-F-1 不是 S6-F-5**。R23-F plan count-field 联合面与 R22-F membership-topology / R21-F 时钟不补铸。锚点 R23-F：120.6–129.7 ms。若落地：重跑 r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）+ r24f。基线 `519101f` 预期空 diff。

G 切片 = 42 文件。禁止去 fsync / 完整性再哈希。**CKMIX** / **TERMCLASS** / **SCHEDWIN** / **XPROC** / **NAMESHAPE** / BYTESHAPE / SYSCENSUS / digest `06cbcf92c098c8f0` 不补铸。计算顶 R23-G：0.285–0.292 vs I/O 85.1–98.0 ms。基线 `4efee23` 预期空 diff。

H 切片 = 21 文件（evaluation **8**）。S5-H-1 必须保留。R23-H rubric-registry membership-mix 与 R22-H 调用上下文 / R21-H 异步调度面不补铸。热层默认 R23-H：9.32–9.65 µs/run。PATH_RE 仅当目标为程序化/对抗或真实载荷 ≥~3.2K 无斜杠 `[\w.-]` 才重开。基线 `fd437a9` 预期空 diff。

I 切片 = 25 文件。S8-I-1 两臂文件级 blocked。R23-I `.pi/` 可观测树与 R22-I run-record 回读 / R21-I flowchart 平面 / R20-I 累积遥测 N 不补铸。custom−builtin R23-I：children +42.9/+22.0、track +53.5/+25.4、flowchart-flat64 +39.2/+21.6 ms。若落地：重跑 r4i/r5i/r7i（68 / 119 / 80）+ r24i。基线 `8dee7fb` 预期空 diff。

J 切片 = 29 文件。J1 / S5-J-3 / S6-J-1 / S8-J-2 钉死。禁止去 fsync。R23-J **CALLB** 与 R22-J **SHAPEK** / R21-J **KFAN** / R20-J 输入类组成不补铸。file-lock retryMs 已由 D/E 定价，勿作为 J ID 补铸。若落地：重跑 J1（2468）+ r24j。基线 `fb41417` 预期空 diff。
