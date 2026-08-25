# Round 22 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–21 已对各区做过二十一遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S21-* 条目（含已合入的 S13-B-1 与 R12–R21 全部空枚举收口，含刚合入的 R21-A … R21-J / R22-A … R22-I；R22-J 仍在飞，勿触其分支）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。禁止再编号 **FITQ** / **NAMESHAPE** / **SCALEX** / **XPROC** / **YMIX** / **SCHEDWIN** / **KFAN** / **NVG** / **SEEDX** / **TERMCLASS**。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R22-A … R22-J），报告写入 `docs/reports/sota-opt/round-22/`。

状态：第 1–4 波 A–I 已合入；J 运行中。第 23 轮已开，见 [round-23/PLAN.md](../round-23/PLAN.md)。

A 切片已合入：空枚举，未铸 S22-A-*。切片 `git diff 7acb666..HEAD` 为空（二十二遍零 diff）。预算复核 65–80 µs/run（稳态约 65–73，与 R21-A 66–95 / R20-A 64–80 同带）。本轮新增公开导出普查 + 分析-隔离面（7 个无价导出全为零生产流量契约载体；sanitize 36–65 ns；proposeFromAnomaly 生产形 4.0–4.5 µs，切片内 682–700 ns；10 ms 越线 T≈1.5×10⁵）。R21-A H 输入面与 R20-A openMinors M / 驻留链不补铸。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S22-B-*。切片 `git diff 94ed3d9..HEAD` 为空。天花板复核 M=2 8.79–9.13 / M=10 17.63–18.12 ms/eval（与 R21-B 9.08–9.39 / 17.79–18.36 同带）。S12-B-2 / S13-B-1 重开条件未触发。本轮新增标识符几何轴（模型 id 长 G × taskId 长 T；平坦，与 R20-B L 轴线性不同；10 ms 越线兆字节级不可达）。R21-B public-prior 快照形状与 R20-B L / K×W 不补铸。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片已合入：空枚举，未铸 S22-C-*。切片 `git diff 183df9b..HEAD` 为空。生产中位复核 665.7–669.6 ms。本轮新增 **SEEDX**（bootstrap-seed / resample-identity；池经 maxIter cap，放大 ≤×1.121；无种子能推出 ±35 ms）。APC ceiling 17.1–21.8 < 35；sink=7.309 逐位相同。r1c–r7c 绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / TAILG / REJX / **FITQ** / **SCALEX** / **YMIX** / **SEEDX**。基线 `183df9b` 空 diff 再确认。

D 切片已合入：空枚举，未铸 S22-D-*。切片 `git diff 82bef36..HEAD` 为空（二十二遍零 diff）。eval 地板复核 3.73–3.76 ms（与 R20-D 3.75–3.97 / R21-D 3.84–4.19 交叠）。S9-D-4 / S12-D-1 未重开。本轮新增公开导出流普查（66 个值导出中 12 个生产绑定、54 个休眠；最贵休眠格 n=512 时 441–450 µs）。R21-D 状态增长方向与 R20-D 多进程并发不补铸。基线 `82bef36` 空 diff 再确认。

E 切片已合入：空枚举，未铸 S22-E-*。切片 `git diff adb20d7..HEAD` 为空（二十二遍零 diff）。SLICE-CPU 本夹具 18.6–19.7 µs/run；种子互换复现 R21-E 15.8–16.3 / R20-E 18.0–18.6。S8-E-1 / S9-E-2 / S13-B-1 未触。本轮新增 **NVG**（数值值类面；域内平坦，仅域缘 +15–25 ns）。R21-E 标识符几何与 R20-E bandit 并发不补铸。基线 `adb20d7` 空 diff 再确认。

F 切片已合入：空枚举，未铸 S22-F-*。切片 `git diff 519101f..HEAD` 为空（连续第十六轮字节不变）。全实验锚点复核 120.5–131.8 ms。**S7-F-1 不是 S6-F-5**。本轮新增 membership-topology 组成轴（尾块 +17.6~+20.5 / 尾反 +34.4~+37.0 / 全散 +35.2~+37.2 ms vs 头散；扫描即落地 S6-F-1，无可落地更快形）。R21-F 时钟输入面与 R20-F outcome 流组成不补铸。基线 `519101f` 空 diff 再确认。

G 切片已合入：空枚举，未铸 S22-G-*（连续第十一次）。切片 `git diff 4efee23..HEAD` 为空。计算顶复核 0.286–0.289 ms vs I/O 94.0–97.2 ms。digest `06cbcf92c098c8f0` 第十三次逐位相同。本轮新增 **TERMCLASS**（FAILED/BLOCKED 终端态；两新态均严低于 COMPLETED 对照；增量全落已裁决契约动词）。禁止去 fsync / 完整性再哈希。**SCHEDWIN** / **XPROC** / **NAMESHAPE** / BYTESHAPE / SYSCENSUS 不补铸。基线 `4efee23` 空 diff 再确认。

H 切片已合入：空枚举，未铸 S22-H-*。切片 `git diff fd437a9..HEAD` 为空（二十二遍零 diff）。热层默认复核 9.18–9.27 µs/run（落入 R21-H 9.14–9.53）。S5-H-1 保留。本轮新增调用上下文几何普查（同步栈深 / try-finally / 异步调用链 hop；生产带平坦；512 帧不可达剂量才见 +0.76–0.97 µs）。R21-H 异步调度面与 R20-H 环境进程态不补铸。PATH_RE 回溯重开条件不变。基线 `fd437a9` 空 diff 再确认。

I 切片已合入：空枚举，未铸 S22-I-*（十五连空）。切片 `git diff 8dee7fb..HEAD` 为空（连续第十五轮字节不变）。custom−builtin 复核 children +47.6/+23.0、track +44.8/+25.7、flowchart-flat64 +45.4/+22.9 ms。S8-I-1 重开条件仍未满足。本轮新增 run-record 回读平面（inspect/commits/episode 消费已落盘 run；合同顶 128 节点内 inspect +11.0/+11.8、commits +17.2/+19.8 ms，I 自有份额 17–201 µs）。R21-I flowchart 平面与 R20-I 累积遥测 N 不补铸。基线 `8dee7fb` 空 diff 再确认。

J 切片 = 29 文件。J1 / S5-J-3 / S6-J-1 / S8-J-2 钉死。禁止去 fsync。R21-J **KFAN** 与 R20-J 输入类组成不补铸。BYTESHAPE / NAMESHAPE / XPROC / SCHEDWIN / **TERMCLASS** 不要移植。file-lock retryMs 阶梯已从 D/E 调用方定价，不补铸为 J ID。若落地：重跑 J1（2468）+ r22j。基线 `fb41417` 预期空 diff。本波派出。
