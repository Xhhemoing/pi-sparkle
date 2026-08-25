# Round 22 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–21 已对各区做过二十一遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S21-* 条目（含已合入的 S13-B-1 与 R12–R21 全部空枚举收口，含刚合入的 R21-A … R21-J / R22-A / R22-B；R22-C / R22-D 仍在飞，勿触其分支）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。禁止再编号 **FITQ** / **NAMESHAPE** / **SCALEX** / **XPROC** / **YMIX** / **SCHEDWIN** / **KFAN**。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R22-A … R22-J），报告写入 `docs/reports/sota-opt/round-22/`。

状态：第 1 波 A/B 已合入，C 运行中；第 2 波 D 运行中，E 本波派出。Round 21 已关闭。

A 切片已合入：空枚举，未铸 S22-A-*。切片 `git diff 7acb666..HEAD` 为空（二十二遍零 diff）。预算复核 65–80 µs/run（稳态约 65–73，与 R21-A 66–95 / R20-A 64–80 同带）。本轮新增公开导出普查 + 分析-隔离面（7 个无价导出全为零生产流量契约载体；sanitize 36–65 ns；proposeFromAnomaly 生产形 4.0–4.5 µs，切片内 682–700 ns；10 ms 越线 T≈1.5×10⁵）。R21-A H 输入面与 R20-A openMinors M / 驻留链不补铸。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S22-B-*。切片 `git diff 94ed3d9..HEAD` 为空。天花板复核 M=2 8.79–9.13 / M=10 17.63–18.12 ms/eval（与 R21-B 9.08–9.39 / 17.79–18.36 同带）。S12-B-2 / S13-B-1 重开条件未触发。本轮新增标识符几何轴（模型 id 长 G × taskId 长 T；平坦，与 R20-B L 轴线性不同；10 ms 越线兆字节级不可达）。R21-B public-prior 快照形状与 R20-B L / K×W 不补铸。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片 = 离线路由 9 文件。必须站在 S1-C … S7-C。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / TAILG / REJX / **FITQ** / **SCALEX** / **YMIX**。生产中位 R21-C：661.9–674.2 ms；APC ceiling 12.5–19.8 < 35；sink=7.309。若落地：重跑 r1c–r7c（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）+ r22c。基线 `183df9b` 预期空 diff。本波派出。

D 切片 = `src/adaptation/` 14 文件。不要重开 S9-D-4 / S12-D-1。R20-D 多进程并发与 R21-D 状态增长方向面不补铸。R22-B 标识符几何（G×T）与 R21-E IDG 不要移植到 D。eval 地板 R21-D：3.84–4.19 ms。基线 `82bef36` 预期空 diff。本波派出。

E 切片 = `src/learning/` 10 文件。不要重开 S8-E-1 / S9-E-2 / S13-B-1。R20-E bandit 并发与 R21-E 标识符几何不补铸。R22-B 标识符几何（G×T）与 R21-J **KFAN** 不要移植到 E。锚点 R21-E：15.8–16.9 / cmp20 17.8–18.5 µs/run。基线 `adb20d7` 预期空 diff。本波派出。

F 切片 = `src/experiments/` 15 文件。**S7-F-1 不是 S6-F-5**。R20-F outcome 流组成与 R21-F 时钟输入面不补铸。锚点 R21-F：120.7–129.8 ms。若落地：重跑 r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）+ r22f。基线 `519101f` 预期空 diff。

G 切片 = 42 文件。禁止去 fsync / 完整性再哈希。**SCHEDWIN** / **XPROC** / **NAMESHAPE** / BYTESHAPE / 存储后端 / 拒绝路径 / SYSCENSUS / digest `06cbcf92c098c8f0` 不补铸。计算顶 R21-G：0.282–0.290 vs I/O 89.6–96.2 ms。基线 `4efee23` 预期空 diff。

H 切片 = 21 文件（evaluation **8**）。S5-H-1 必须保留。R21-H 异步调度面普查（Y/QM/QT）不补铸。R20-H 环境进程态压力不补铸。热层默认 R21-H：9.14–9.53 µs/run。基线 `fd437a9` 预期空 diff。

I 切片 = 25 文件。S8-I-1 两臂文件级 blocked。R21-I flowchart 平面输入规模与 R20-I 累积遥测 N 不补铸。custom−builtin R21-I：children +43.4/+25.4、track +52.2/+23.9 ms。若落地：重跑 r4i/r5i/r7i（68 / 119 / 80）+ r22i。基线 `8dee7fb` 预期空 diff。

J 切片 = 29 文件。J1 / S5-J-3 / S6-J-1 / S8-J-2 钉死。禁止去 fsync。R21-J **KFAN** 与 R20-J 输入类组成不补铸。BYTESHAPE / NAMESHAPE / XPROC / SCHEDWIN 不要移植。若落地：重跑 J1（2468）+ r22j。基线 `fb41417` 预期空 diff。
