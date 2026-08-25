# Round 21 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–20 已对各区做过二十遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S20-* 条目（含已合入的 S13-B-1 与 R12–R20 全部空枚举收口，含刚合入的 R20-A … R20-J）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。S5-H-1 必须保留。禁止再编号 **FITQ** / **NAMESHAPE** / **SCALEX** / **XPROC**。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退与累积遥测 N 轴是仅有的数十 ms 结构且均被栅栏封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R21-A … R21-J），报告写入 `docs/reports/sota-opt/round-21/`。

状态：第 1 波 A/B/C 本波派出。Round 20 已收口 10/10。

A 切片 = `src/tracking/` + `src/run/child-tracking.ts` + `src/run/gate-apply.ts`（14）。不要重开 S1-A-* … S11-A-2。R12-A…R20-A 空枚举。R20-A `gate.openMinors` 基数 M（34.4–43.2 ns/minor；10 ms 越线 M≈46k–58k；生产流量为零）与多轮驻留链（`window.previous` 3311–3475 ns；100 轮积分 328–346 µs）不补铸。R19-A 重投递 / `wait_user` 与 R18-A skip-path / 拒绝终点不补铸。预算锚点 R20-A：64–80 µs/run。基线 `7acb666` 预期空 diff。本波派出。

B 切片 = live 路由 10 文件：`src/routing/{r0,assign,assign-plan,policy,live-cascade,live-selection,analyze-task,primary-catalog,catalog-model}.ts` + `src/supervisor/model-router.ts`。Live = R0。不要重开 S12-B-2 / S13-B-1（重开条件未触发）。R10-B…R20-B 空枚举。R20-B objective 长度 L 轴与能力约束 K×W 双线性轴不补铸。R19-B 比较器第三腿 + 目录基数 M 与 R18-B 语料字宽/CJK / RoutingLimits 不补铸。天花板 R20-B：M=2 9.03–10.73 / M=10 17.97–24.28 ms/eval。基线 `94ed3d9` 预期空 diff。本波派出。

C 切片 = 离线路由 9 文件：`src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts`。必须站在已落地 S1-C / S2-C / S3-C / S4-C / S5-C / S6-C / S7-C。不要另起平行 S7-C。R8-C…R20-C 空枚举。禁止再编号 ICOL / SFILL / ITERX / COLDX / AAFLR / GCAX / STORD / RIDGE / NSQRT / PMV / OSTZ / TAILG / REJX / **FITQ** / **SCALEX**。生产中位 R20-C：661.4–671.5 ms/报告；APC ceiling 17.4–21.6 < 35；sink=7.309。若落地代码：重跑 r1c–r7c（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）+ 新 r21c 仿真。基线 `183df9b` 预期空 diff。本波派出。

D 切片 = `src/adaptation/` 14 文件。不要重开 S9-D-4 / S12-D-1。R10-D…R20-D 空枚举。R20-D 多进程并发面不补铸。R19-D 冷进程模块图与 R18-D locked-tx / R17-D 拒配轴不补铸。eval 地板 R20-D：3.75–3.97 ms。基线 `82bef36` 预期空 diff。

E 切片 = `src/learning/` 10 文件。不要重开 S8-E-1 / S9-E-2 / S13-B-1。R10-E…R20-E 空枚举。R20-E bandit 多进程并发面不补铸。R19-E 输入表示/来源保真 + 事件排序与 R18-E 冷层 / CJK 不补铸。锚点 R20-E：本夹具 17.7–19.3 / 种子 18.7–18.9 µs/run。基线 `adb20d7` 预期空 diff。

F 切片 = `src/experiments/` 15 文件。必须站在已落地 S1-F / S5-F / S6-F-1 / S7-F-1 / S7-F-2。**S7-F-1 不是 S6-F-5**。R10-F…R20-F 空枚举。R20-F outcome 流组成完备性不补铸。R19-F runner 家族（canary）与 R18-F 剂量 / 暖计划税 / halt 后路径不补铸。锚点 R20-F：117.5–129.1 ms。若落地代码：重跑 r1f/r5f/r6f/r7f（2668 / 224 / 27 / 169）+ 新 r21f 仿真。基线 `519101f` 预期空 diff。

G 切片 = 42 文件：`src/run/` 除 child-tracking.ts / gate-apply.ts（属 A）、`src/supervisor/` 除 model-router.ts（属 B）、`src/graph/`、`src/domain/`。不要重开 S1-G-* … S9-G-3 / S10-G-1 / S11-G-1..3。R12-G…R20-G 空枚举。禁止去 fsync / 完整性再哈希。计算顶 R20-G：0.287–0.294 ms vs I/O 91.3–99.9 ms。digest `06cbcf92c098c8f0` 第十一次逐位相同。**XPROC** / **NAMESHAPE** / BYTESHAPE / 存储后端 / 拒绝路径 / SYSCENSUS / digest 轴不补铸。基线 `4efee23` 预期空 diff。

H 切片 = 21 文件：`src/evaluation/` **8**（不是 9）+ `src/requirement/` 7 + `src/review/` 4 + `src/rubric/` 2。S5-H-1 必须保留。不要重开 S1-H-* … S9-H-2。R10-H…R20-H 空枚举。热层默认 R20-H：9.24–9.36 µs/run。R20-H 环境进程态压力普查不补铸。R19-H 执行史剂量/平稳性与 R18-H 休眠分支不补铸。PATH_RE 回溯重开仅当 objective 出现程序化/对抗来源，或现实载荷出现 ≥~3.2K 字符无斜杠 `[\w.-]` 段。基线 `fd437a9` 预期空 diff。

I 切片 = 25 文件：`src/cli/` 13 + `src/pi-adapter/` 9 + `src/config/` 2 + `src/telemetry/` 1。必须站在已落地 S1-I / S4-I / S5-I-1 / S7-I-1。S4-I 淘汰项是 S4-I-2..5（无 S4-I-1）。S8-I-1 两臂文件级 blocked，不要重开。R9-I…R20-I 十二连空。R20-I 累积遥测态 N 轴（10 ms 越线 N*≈2300–2700）不补铸。R19-I E×P×K 与 R18-I children-spec 不补铸。若落地代码：重跑 r4i/r5i/r7i（68 / 119 / 80）+ 新 r21i 仿真。基线 `8dee7fb` 预期空 diff。

J 切片 = 29 文件：`src/cluster/` 3 + `src/privacy/` 3 + `src/preferences/` 7 + `src/episode/` 5 + `src/persist/` 2 + `src/track/` 4 + `src/context/` 2 + `src/feedback/` 3。必须站在已落地 J1。S5-J-3 / S6-J-1 / S8-J-2 / J1 钉死。禁止去 fsync。R11-J…R20-J 空枚举。R20-J 输入类组成剂量面不补铸。R19-J 重投递/次序与 R18-J skip-path 不补铸。R18-G BYTESHAPE / R19-G **NAMESHAPE** / R20-G **XPROC** 不要移植到 J。若落地代码：重跑 J1 仿真（2468）+ 新 r21j 仿真。基线 `fb41417` 预期空 diff。
