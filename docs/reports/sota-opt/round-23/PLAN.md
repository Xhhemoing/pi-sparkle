# Round 23 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–22 已对各区做过二十二遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S22-* 条目（含已合入的 S13-B-1 与 R12–R22 全部空枚举收口，含刚合入的 R22-A … R22-J / R23-A / R23-B / R23-D；R23-C / R23-E 仍在飞，勿触其分支）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。禁止再编号 **FITQ** / **NAMESHAPE** / **SCALEX** / **XPROC** / **YMIX** / **SCHEDWIN** / **KFAN** / **NVG** / **SEEDX** / **TERMCLASS** / **SHAPEK**。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R23-A … R23-J），报告写入 `docs/reports/sota-opt/round-23/`。

状态：第 1 波 A/B 已合入，C 运行中；第 2 波 D 已合入、E 运行中；第 3 波 F 本波派出。Round 22 已关闭。

A 切片已合入：空枚举，未铸 S23-A-*。切片 `git diff 7acb666..HEAD` 为空（二十三遍零 diff）。预算复核 66–78 µs/run（与 R22-A 65–80 同带）。本轮新增 G×E 自耦合 run ledger（每闸追加 1–3 事件，N 闸二次项 c≈0.048–0.050 µs；10 ms 越线 N≈341–344；生产 N≈5 时增长项仅 ~0.35 µs）。R22-A 公开导出普查与 R21-A H 输入面 / R20-A openMinors 不补铸。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S23-B-*。切片 `git diff 94ed3d9..HEAD` 为空。天花板复核 M=2 9.20–9.48 / M=10 17.64–18.52 ms/eval（与 R22-B 8.79–9.13 / 17.63–18.12 同带）。S12-B-2 / S13-B-1 重开条件未触发。本轮新增 batch arrangement 几何轴（同多重集六臂平坦；预分组+还原自败）。R22-B 标识符几何（G×T）与 R21-B public-prior 快照形状不补铸。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片 = 离线路由 9 文件。必须站在 S1-C … S7-C。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / TAILG / REJX / **FITQ** / **SCALEX** / **YMIX** / **SEEDX**。R23-A G×E 自耦合不要移植。生产中位 R22-C：665.7–669.6 ms；APC ceiling 17.1–21.8 < 35；sink=7.309。若落地：重跑 r1c–r7c（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）+ r23c。基线 `183df9b` 预期空 diff。本波派出。

D 切片已合入：空枚举，未铸 S23-D-*。切片 `git diff 82bef36..HEAD` 为空。eval 地板复核 3.39–3.74 ms（与 R22-D 3.73–3.76 邻带）。S9-D-4 / S12-D-1 未重开；S12-B-2 仍未触发。本轮新增两相提升时间交错 / 在飞 pending-intent 种群（P-dose：斜率 ≈7.0–7.7 ns/pending，N=2048 残差 15–17 ms；生产零两相调用方，持久 P=0、瞬时 P≤1，二次项不可达）。R22-D 公开导出流普查与 R21-D 状态增长方向 / R20-D 并发不补铸。基线 `82bef36` 空 diff 再确认。

E 切片 = `src/learning/` 10 文件。不要重开 S8-E-1 / S9-E-2 / S13-B-1。R22-E **NVG** 与 R21-E 标识符几何 / R20-E bandit 并发不补铸。**SHAPEK** / R23-A G×E / R23-B batch arrangement 不要移植。锚点 R22-E：18.6–19.7 µs/run（种子互换复现 R21-E / R20-E 带）。基线 `adb20d7` 预期空 diff。本波派出。

F 切片 = `src/experiments/` 15 文件。**S7-F-1 不是 S6-F-5**。R22-F membership-topology 与 R21-F 时钟 / R20-F outcome 流不补铸。R23-D 两相 P-dose / R23-A G×E / R23-B batch arrangement / **SHAPEK** 不要移植。锚点 R22-F：120.5–131.8 ms。若落地：重跑 r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）+ r23f。基线 `519101f` 预期空 diff。本波派出。

G 切片 = 42 文件。禁止去 fsync / 完整性再哈希。**TERMCLASS** / **SCHEDWIN** / **XPROC** / **NAMESHAPE** / BYTESHAPE / SYSCENSUS / digest `06cbcf92c098c8f0` 不补铸。计算顶 R22-G：0.286–0.289 vs I/O 94.0–97.2 ms。基线 `4efee23` 预期空 diff。

H 切片 = 21 文件（evaluation **8**）。S5-H-1 必须保留。R22-H 调用上下文几何普查不补铸。R21-H 异步调度面（Y/QM/QT）不补铸。热层默认 R22-H：9.18–9.27 µs/run。基线 `fd437a9` 预期空 diff。

I 切片 = 25 文件。S8-I-1 两臂文件级 blocked。R22-I run-record 回读平面与 R21-I flowchart 平面 / R20-I 累积遥测 N 不补铸。custom−builtin R22-I：children +47.6/+23.0、track +44.8/+25.7、flowchart-flat64 +45.4/+22.9 ms。若落地：重跑 r4i/r5i/r7i（68 / 119 / 80）+ r23i。基线 `8dee7fb` 预期空 diff。

J 切片 = 29 文件。J1 / S5-J-3 / S6-J-1 / S8-J-2 钉死。禁止去 fsync。R22-J **SHAPEK** 与 R21-J **KFAN** / R20-J 输入类组成不补铸。BYTESHAPE / NAMESHAPE / XPROC / SCHEDWIN / TERMCLASS 不要移植。若落地：重跑 J1（2468）+ r23j。基线 `fb41417` 预期空 diff。
