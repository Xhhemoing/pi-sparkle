# Round 18 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–17 已对各区做过十七遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S17-* 条目（含已合入的 S13-B-1 与 R12–R17 全部空枚举收口，含刚合入的 R17-A … R17-I；R17-J 仍在飞，勿抢其报告）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R18-A … R18-J），报告写入 `docs/reports/sota-opt/round-18/`。

状态：第 1 波 B 本波派出；A 运行中。Round 17 J 仍在飞，本轮不触及其分支与文件。

A 切片 = 14 文件：`src/tracking/` 12 + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`。不要重开 S1-A-* … S11-A-2。R12-A…R17-A 空枚举、未铸 ID。预算复核 R17-A：65–74 µs/run（13.0–14.8 µs/gate）。R17-A 事件表组成轴（GT 饱和 10 ms 越线收紧至 E≈4.7–5.2×10⁴）与生产态冷进程预算（ICU collator 惰性初始化 ~5.0 ms，once-per-run）不补铸。R16-A payload 形态轴（L/V/S）与 R15-A C/R/GC/JIT、R14-A E/max-codes 不补铸。分析不改 in-flight run；tracking 无命令权；H/score 不写路由 PASS/FAIL。基线 `7acb666` 预期空 diff。

B 切片 = live 路由：`src/routing/{r0,assign,assign-plan,policy,live-cascade,live-selection,analyze-task,primary-catalog,catalog-model}.ts` + `src/supervisor/model-router.ts`（10 文件）。不要重开 S12-B-2（条件式落地：N≥10³ 且调用方传 `prior`）/ S13-B-1（本体成本 ≥2 个量级；|avoid|≈965–1,063 生产写入方不可达）。R13-B…R17-B 空枚举或仅淘汰 ID。天花板复核 R17-B：M=2 9.1–11.4 / M=10 19.0–23.8 ms/eval。R17-B 拒绝/异常路径定价与逐任务尾部分布不补铸。R16-B 剖析站点预算与语料基底、R15-B A/A 与引擎代轴不补铸。Live = R0。基线 `94ed3d9` 预期空 diff。本波派出。

C 切片 = 离线路由 9 文件：`src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`。必须站在已落地 S1-C / S2-C / S3-C / S4-C / S5-C / S6-C / S7-C。不要另起平行 S7-C。R11-C…R17-C 空枚举、未铸 ID。生产中位 R17-C：657.6–689.3 ms/报告（本机 659.9–662.8）；落地线 ±35 ms。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ 与 R13–R16 无名微观。若落地代码：重跑 r1c–r7c（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）+ 新 r18c 仿真。基线 `183df9b` 预期空 diff。

D 切片 = `src/adaptation/`（14 文件）。不要重开 S9-D-4（廉价 `toLowerCase` 在 U+212A fail-open）/ S12-D-1（同族）。R10-D…R17-D 空枚举或已关 ID。eval 地板 R17-D：3.57–4.00 ms。R17-D fail-closed 拒绝路径普查（28 终点）不补铸。R16-D payload 形态轴（L/H/O/σ/P）与 R14-D / R15-D 轴不补铸。基线 `82bef36` 预期空 diff。

E 切片 = `src/learning/`（10 文件）。不要重开 S8-E-1（勿去重 `loadLearnedRouting`）/ S9-E-2（负优化）/ S13-B-1。R10-E…R17-E 空枚举、未铸 ID。SLICE-CPU R17-E：18.5–20.2 µs/run。R17-E 拒绝路径定价与逐事件类价表不补铸。R16-E 累积状态轴与 payload 形态轴不补铸。S13-B-1 重开条件已量化为 |avoid|≈965–1,063，生产写入方不可达。R13–R16 轴不补铸。基线 `adb20d7` 预期空 diff。

F 切片 = `src/experiments/`（15 文件）。必须站在已落地 S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2。**S7-F-1 不是 S6-F-5**。不要重开 S1-F-1..8 / S5-F-* / S6-F-* / S7-F-1..2 / S8-F-* / S9-F-3。R10-F…R17-F 空枚举、未铸 ID。全实验锚点 R17-F：120.5–129.6 ms。R17-F 拒绝路径 / 冷进程 / 操作粒度尾部轴不补铸。R16-F 剖析归属 / A 越线点 / 编码格与 R14-F / R15-F 轴不补铸。若落地代码：重跑 r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）+ 新 r18f 仿真。基线 `519101f` 预期空 diff。

G 切片 = 42 文件：`src/run/` 除 child-tracking.ts / gate-apply.ts（属 A）、`src/supervisor/` 除 model-router.ts（属 B）、`src/graph/`、`src/domain/`。不要重开 S1-G-* … S9-G-3 / S10-G-1 / S11-G-1..3。R12-G…R17-G 空枚举、未铸 ID。禁止去 fsync / 完整性再哈希。计算顶 R17-G：0.287–0.295 ms vs I/O 95.8–98.4 ms。存储后端分解（物理上限 6.0–7.4 ms，需易失存储）/ 拒绝路径定价 / SYSCENSUS / digest `06cbcf92c098c8f0` / R14-G / R15-G 轴不补铸。基线 `4efee23` 预期空 diff。

H 切片 = 21 文件：`src/evaluation/` **8**（不是 9）+ `src/requirement/` 7 + `src/review/` 4 + `src/rubric/` 2。S5-H-1 必须保留。不要重开 S1-H-* … S9-H-2。R10-H…R17-H 空枚举、未铸 ID。热层默认 R17-H：9.17–10.18 µs/run。R17-H fail-closed 拒绝路径普查不补铸。PATH_RE 回溯形态已候选化后拒列，不补铸；重开仅当 objective 出现程序化/对抗来源，或现实载荷出现 ≥~3.2K 字符无斜杠 `[\w.-]` 段。R14-H / R15-H / R16-H 基底格不补铸。基线 `fd437a9` 预期空 diff。

I 切片 = 25 文件：`src/cli/` 13 + `src/pi-adapter/` 9 + `src/config/` 2 + `src/telemetry/` 1。必须站在已落地 S1-I / S4-I / S5-I-1 / S7-I-1。S4-I 淘汰项是 S4-I-2..5（无 S4-I-1）。S8-I-1 两臂文件级 blocked（含 Node 24），不要重开。R9-I…R17-I 九连空，未铸 ID。R17-I fail-closed 拒绝路径定价不补铸。R16-I flowchart 抽测格与增量采样归因不补铸。R15-I spawn A/A / 引擎代 / 堆足迹不补铸。R13-I 无名微观与 R14-I 肥配置态不补铸。若落地代码：重跑 r4i/r5i/r7i（68 / 119 / 80）+ 新 r18i 仿真。基线 `8dee7fb` 预期空 diff。

J 切片 = 29 文件：`src/cluster/` 3 + `src/privacy/` 3 + `src/preferences/` 7 + `src/episode/` 5 + `src/persist/` 2 + `src/track/` 4 + `src/context/` 2 + `src/feedback/` 3。必须站在已落地 J1。S5-J-3 / S6-J-1 / S8-J-2 / J1 钉死。禁止去 fsync。R11-J…R16-J 空枚举（R17-J 在飞，勿抢其报告）。R16-J SYSCENSUS-J 与 payload 字节形态轴不补铸。R15-J A/A 与引擎代、R14-J 规模越线不补铸。若落地代码：重跑 J1 仿真（2468）+ 新 r18j 仿真。基线 `fb41417` 预期空 diff。
