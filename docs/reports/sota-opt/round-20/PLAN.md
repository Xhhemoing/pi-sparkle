# Round 20 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–19 已对各区做过十九遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S19-* 条目（含已合入的 S13-B-1 与 R12–R19 全部空枚举收口，含刚合入的 R19-A … R19-J / R20-A … R20-G）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。禁止再编号 **FITQ** / **NAMESHAPE** / **SCALEX** / **XPROC**。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R20-A … R20-J），报告写入 `docs/reports/sota-opt/round-20/`。

状态：完成 10/10。A–J 全部合入（空枚举）。无新落地。第 21 轮进行中，见 [round-21/PLAN.md](../round-21/PLAN.md)。

A 切片已合入：空枚举，未铸 S20-A-*。切片 `git diff 7acb666..HEAD` 为空（二十遍零 diff）。预算复核 64–80 µs/run（12.9–16.1 µs/gate，与 R19-A 66–75 同带略宽）。本轮新增 resident-state 基数 M（`gate.openMinors` 斜率 34.4–43.2 ns/minor；10 ms 越线 M≈46k–58k；生产流量为零）与多轮驻留链面（`window.previous` 3311–3475 ns；100 轮积分 328–346 µs）。R19-A 重投递 / `wait_user` 与 R18-A skip-path / 拒绝终点不补铸。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S20-B-*。切片 `git diff 94ed3d9..HEAD` 为空。天花板复核 M=2 9.03–10.73 / M=10 17.97–24.28 / replay 7.10–8.06 / 10× 96.9–125.4 ms/eval（细粒度 live face 47.4–48.7 µs）。S12-B-2 / S13-B-1 重开条件未触发。本轮新增 objective 长度 L 轴（`analyzeTask` 严格线性 11.24–11.53 ns/char·任务；miss L=32000 假设 1.44–1.47 s/eval，生产带 61–120 字符、流量为零；S1-B-1/S1-B-3 休眠池首次拿到 L 依赖定价）与能力约束双线性 K×W 轴（生产 K=1 且 W≤3 税为零；K=W=128 假设 116.4–118.8 ms/eval-equivalent，两轴须同时离带才重开）。R19-B 比较器第三腿 + 目录基数 M 与 R18-B 语料字宽/CJK / RoutingLimits 不补铸。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片已合入：空枚举，未铸 S20-C-*。切片 `git diff 183df9b..HEAD` 为空。生产中位复核 661.4–671.5 ms/报告（对 R19-C 667.5–675.1 / R18-C 656.7–672.4 在 ±35 内）。本轮新增 **SCALEX**（B 轴 α=0.90–1.11 线性；K 轴 solve 池 α=2.75；on-prob 越线 K*≈2.6× 仍 <35）。APC 地板复测 ceiling 17.4–21.6 < 35；sink=7.309 逐位相同。r1c–r7c 绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / TAILG / REJX / **FITQ** / **SCALEX**。基线 `183df9b` 空 diff 再确认。

D 切片已合入：空枚举，未铸 S20-D-*。切片 `git diff 82bef36..HEAD` 为空。eval 地板复核 3.75–3.97 ms/run（落入 R18-D 3.75–4.14，与 R19-D 3.85–4.22 交叠）。S9-D-4 / S12-D-1 未重开。本轮新增多进程并发面（争用阶梯 6.4–12.4 ms/命令；N=8 车队 74.8–75.6 ms；无锁读者 0/240 撕裂；陈旧锁付满超时）。生产争用流量为零；可调旋钮在切片外。R19-D 冷进程模块图与 R18-D locked-tx / R17-D 拒配轴不补铸。基线 `82bef36` 空 diff 再确认。

E 切片已合入：空枚举，未铸 S20-E-*。切片 `git diff adb20d7..HEAD` 为空。SLICE-CPU 本夹具 17.7–19.3 µs/run；R17-E 种子复现 18.7–18.9（落入 18.5–20.2 / R19-E 18.5–19.7）。本轮新增多进程并发面（E 自有 `bandit.json` 就地写 + 默认锁；单飞 0.65–1.07 ms；量化税 1.9–12.5 ms；N=8 车队 64.0–73.8 ms 零稳态流量；锁消除反事实丢失更新 88–99/100；无锁读者可撕但生产读全在锁内）。S8-E-1 / S9-E-2 / S13-B-1 未触。R19-E 输入表示/来源保真 + 事件排序与 R18-E 冷层 / CJK 不补铸。基线 `adb20d7` 空 diff 再确认。

F 切片已合入：空枚举，未铸 S20-F-*。切片 `git diff 519101f..HEAD` 为空（连续第十四轮字节不变）。全实验锚点复核 117.5–129.1 ms（与 R19-F 120.4–130.2 / R18-F 120.8–129.1 重叠）。本轮新增 outcome 流组成完备性（missingOutcomePolicy 三值同价；脏剂量/breach 臂与零不可分；形状污染 −0.29/−0.28 ms；生产交错调度已最优）。**S7-F-1 不是 S6-F-5**。R19-F runner 家族（canary）与 R18-F 剂量 / 暖计划税 / halt 后路径不补铸。基线 `519101f` 空 diff 再确认。

G 切片已合入：空枚举，未铸 S20-G-*（连续第九次）。切片 `git diff 4efee23..HEAD` 为空。计算顶复核 0.287–0.294 ms vs I/O 91.3–99.9 ms。digest `06cbcf92c098c8f0` 第十一次逐位相同。本轮新增 **XPROC**（跨进程干涉；同 inode 锤击税 +21.8~+167.9 µs/append 生产占空比为零；155,746 次 pause 轮询 0 malformed；车队 F=8 吞吐单调）。禁止去 fsync / 完整性再哈希。**NAMESHAPE** / BYTESHAPE / 存储后端 / 拒绝路径 / SYSCENSUS / digest 轴不补铸。基线 `4efee23` 空 diff 再确认。

H 切片已合入：空枚举，未铸 S20-H-*。切片 `git diff fd437a9..HEAD` 为空（二十遍零 diff）。热层默认复核 9.24–9.36 µs/run（与 R19-H 9.53–10.39 邻接下缘）。S5-H-1 字节级维持。本轮新增环境进程态压力普查（堆剂量 p50 平坦 6.69–6.94 µs；常驻模块图 p50 比恰 1.00；属引擎一次-per-process）。R19-H 执行史剂量/平稳性与 R18-H 休眠分支不补铸。基线 `fd437a9` 空 diff 再确认。

I 切片已合入：空枚举，未铸 S20-I-*（十二连空）。切片 `git diff 8dee7fb..HEAD` 为空（连续第十三轮字节不变）。custom−builtin 复核 children +46.5/+24.0、track +48.8/+24.1 ms。S8-I-1 重开条件仍未满足。本轮新增累积遥测态轴（`runtime/invocations.jsonl` 基数 N；N=20k +54.7/+58.2 ms；10 ms 越线 N*≈2300–2700；缓解均落既有栅栏）。R19-I E×P×K 与 R18-I children-spec 不补铸。基线 `8dee7fb` 空 diff 再确认。

J 切片已合入：空枚举，未铸 S20-J-*。切片 `git diff fb41417..HEAD` 为空（J1 以来十九遍零后续代码）。I/O 地板复核 save 125.0–226.7 / 420.2–571.8 µs；jsonl 59.4–73.2 / 228.7–446.8 µs；级联 636.4–763.5 / 267.0–371.5 µs；index 40.4–41.1 µs；plan 1.03–1.10 / 2.51–2.68 µs（I/O 支配第二十次成立）。J1 仿真 2468 项绿。本轮新增输入类组成剂量面（cascade 命中比 / tombstone 密度 / redaction 脏比 / episode 事件类混合；可测悬崖均属既有契约或零生产调用方）。S5-J-3 / S6-J-1 / S8-J-2 / J1 原样。R19-J 重投递/次序与 R18-J skip-path 不补铸。基线 `fb41417` 空 diff 再确认。
