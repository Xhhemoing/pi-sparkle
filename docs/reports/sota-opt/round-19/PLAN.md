# Round 19 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–18 已对各区做过十八遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S18-* 条目（含已合入的 S13-B-1 与 R12–R18 全部空枚举收口，含刚合入的 R18-A … R18-G / R18-I；R18-H / R18-J 在飞，勿等、勿触）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R19-A … R19-J），报告写入 `docs/reports/sota-opt/round-19/`。

状态：第 1 波 A 本波派出。Round 18 H/J 仍在飞。A–G/I 已合入（空枚举）。

A 切片 = 14 文件：`src/tracking/` 12（analysis / combined-score / config / from-child / gates / human-score / index / isolation / prescore / roller / turn / types）+ `src/run/child-tracking.ts` + `src/run/gate-apply.ts`。分析不变更在飞 run；tracking 无指挥权。不要重开 S1-A-* … S11-A-*。R10-A…R18-A 空枚举、未铸 ID。预算复核 R18-A：64–74 µs/run。R18-A skip-path 组成（五类 apply:false 272–1712 ns）与 fail-closed 拒绝终点普查（28 抛点；代表拒绝 8.9–13.3 µs）不补铸。R17-A 事件表组成 / 冷进程预算与 R16-A / R15-A / R14-A 轴不补铸。基线 `7acb666` 预期空 diff。本波派出。

B 切片 = live 路由 10 文件：`src/routing/{r0,assign,assign-plan,policy,live-cascade,live-selection,analyze-task,primary-catalog,catalog-model}.ts` + `src/supervisor/model-router.ts`。Live = R0。不要重开 S12-B-2（条件落地 N≥10³ AND caller 传 `prior`，仍未触发）/ S13-B-1（仅当 applyLearnedRouting 体代价 ≥2 个量级）。R10-B…R18-B 空枚举、未铸 ID。天花板复核 R18-B：M=2 8.9–9.4 / M=10 18.3–18.5 ms/eval。R18-B 语料字宽/CJK 与有限 `RoutingLimits` 不补铸。R17-B 拒绝路径 / 尾部分布与 R16-B / R15-B 轴不补铸。基线 `94ed3d9` 预期空 diff。

C 切片 = 离线路由 9 文件：`src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`。必须站在已落地 S1-C / S2-C / S3-C / S4-C / S5-C / S6-C / S7-C。不要另起平行 S7-C。R11-C…R18-C 空枚举、未铸 ID。生产中位 R18-C：656.7–672.4 ms/报告；落地线 ±35 ms。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / TAILG / REJX。APC floor 再锚定：ceiling 12.1–20.9 ms < 35；sink=7.309。若落地代码：重跑 r1c–r7c（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）+ 新 r19c 仿真。基线 `183df9b` 预期空 diff。

D 切片 = `src/adaptation/` 14 文件。不要重开 S9-D-4 / S12-D-1（cheap `toLowerCase` skip 在 U+212A 上 fail-open，永不重开）。R10-D…R18-D 空枚举、未铸 ID。eval 地板复核 R18-D：3.75–4.14 ms。R18-D 锁定事务组成账目不补铸。R17-D 拒绝路径普查与 R16-D / R15-D / R14-D 轴不补铸。基线 `82bef36` 预期空 diff。

E 切片 = `src/learning/` 10 文件。不要重开 S8-E-1（勿对 `loadLearnedRouting` 去重）/ S9-E-2（负优化）/ S13-B-1。R10-E…R18-E 空枚举、未铸 ID。SLICE-CPU R18-E 本夹具 12.4–14.8 / R17-E 种子复现 18.8–19.4 µs/run。R18-E 冷层（2.23–2.50 ms once-per-process）与 CJK/字宽（CJK 每字符比 ASCII 便宜 2.4–3.1×）不补铸。R17-E 拒绝路径 / 事件类价表与 R16-E / R13–R15 轴不补铸。基线 `adb20d7` 预期空 diff。

F 切片 = `src/experiments/` 15 文件。必须站在已落地 S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2。**S7-F-1 不是 S6-F-5**。R10-F…R18-F 空枚举、未铸 ID。全实验锚点复核 R18-F：120.8–129.1 ms。R18-F 对齐分数剂量 / 热进程税 / halt 后定价不补铸。R17-F 拒绝路径 / 冷进程 / 尾部与 R16-F / R15-F / R14-F 轴不补铸。若落地代码：重跑 r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）+ 新 r19f 仿真。基线 `519101f` 预期空 diff。

G 切片 = 42 文件：`src/run/` 除 child-tracking.ts / gate-apply.ts（属 A）、`src/supervisor/` 除 model-router.ts（属 B）、`src/graph/`、`src/domain/`。不要重开 S1-G-* … S9-G-3 / S10-G-1 / S11-G-1..3。R12-G…R18-G 空枚举、未铸 ID。禁止去 fsync / 完整性再哈希。计算顶 R18-G：0.290–0.299 ms vs I/O 94.4–110.7 ms。digest `06cbcf92c098c8f0` 第九次逐位相同。存储后端分解 / 拒绝路径定价 / SYSCENSUS / digest / R14-G / R15-G / **BYTESHAPE** 轴不补铸。基线 `4efee23` 预期空 diff。

H 切片 = 21 文件：`src/evaluation/` **8**（不是 9）+ `src/requirement/` 7 + `src/review/` 4 + `src/rubric/` 2。S5-H-1 必须保留。不要重开 S1-H-* … S9-H-2。R10-H…R17-H 空枚举、未铸 ID。热层默认 R17-H：9.17–10.18 µs/run。R17-H fail-closed 拒绝路径普查不补铸。PATH_RE 回溯形态已候选化后拒列，不补铸；重开仅当 objective 出现程序化/对抗来源，或现实载荷出现 ≥~3.2K 字符无斜杠 `[\w.-]` 段。R14-H / R15-H / R16-H 基底格不补铸。基线 `fd437a9` 预期空 diff。R18-H 在飞，本轮勿等、勿触其分支与文件。

I 切片 = 25 文件：`src/cli/` 13 + `src/pi-adapter/` 9 + `src/config/` 2 + `src/telemetry/` 1。必须站在已落地 S1-I / S4-I / S5-I-1 / S7-I-1。S4-I 淘汰项是 S4-I-2..5（无 S4-I-1）。S8-I-1 两臂文件级 blocked（含 Node 24），不要重开。R9-I…R18-I 十连空，未铸 ID。R18-I children-spec 基数轴不补铸。R17-I fail-closed 拒绝路径定价不补铸。R16-I flowchart 抽测格与增量采样归因不补铸。R15-I spawn A/A / 引擎代 / 堆足迹不补铸。R13-I 无名微观与 R14-I 肥配置态不补铸。若落地代码：重跑 r4i/r5i/r7i（68 / 119 / 80）+ 新 r19i 仿真。基线 `8dee7fb` 预期空 diff。

J 切片 = 29 文件：`src/cluster/` 3 + `src/privacy/` 3 + `src/preferences/` 7 + `src/episode/` 5 + `src/persist/` 2 + `src/track/` 4 + `src/context/` 2 + `src/feedback/` 3。必须站在已落地 J1。S5-J-3 / S6-J-1 / S8-J-2 / J1 钉死。禁止去 fsync。R11-J…R17-J 空枚举、未铸 ID。R17-J fail-closed 拒绝路径普查与冷进程预算不补铸。R16-J SYSCENSUS-J 与 payload 字节形态轴不补铸。R15-J A/A 与引擎代、R14-J 规模越线不补铸。R18-G BYTESHAPE 不要移植到 J。若落地代码：重跑 J1 仿真（2468）+ 新 r19j 仿真。基线 `fb41417` 预期空 diff。R18-J 在飞，本轮勿等、勿触其分支与文件。
