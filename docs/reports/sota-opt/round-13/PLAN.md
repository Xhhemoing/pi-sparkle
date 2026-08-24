# Round 13 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–12 已对各区做过十二遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S12-* 条目以及已合入的 S13-B-1（含已合入的 S12-B-1..2 / S12-C-1 / S12-D-1..2 与 R12-A / R12-E / R12-F / R12-G / R12-H / R12-I / R12-J / R13-A / R13-C / R13-D / R13-E / R13-F / R13-G / R13-H 的空枚举收口）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R13-A … R13-J），报告写入 `docs/reports/sota-opt/round-13/`。

状态：第 4 波收尾；A/C/D/E/F/G/H 已合入（空枚举）；B 已合入（S13-B-1 淘汰）；I/J 运行中。第 14 轮已开，见 [round-14/PLAN.md](../round-14/PLAN.md)。

A 切片已合入：空枚举，未铸 S13-A-*。预算复核 70–81 µs/run（与 R12-A 70–92 同带且更窄）。合同地板复现：hashAssessment×3 ~41–42%、validateEvent ~20–21%、turn ~13%、prescore×2 ~10–11%、O(E) 扫描合计 ~1.6%。本轮新增 turn 内部剖面，子组件全部落在已关 ID。8 项新记录换名检查不铸 ID。基线 `7acb666` 空 diff 再确认。

B 切片已合入：S13-B-1（assignPlanned learned 层按 (family, preferredModel) 批内记忆化；与 S12-B-2 为姊妹而非换名；真实流量 N=2000+learned 三目录规模符号翻转；fat×M=10 仅 0.18–3.1 ms/eval 且零观测流量）。天花板复核 M=2 11.6–11.9 ms、M=10 18.8–19.2 ms。learned-size 格闭合：肥 avoid 因收缩 allowed 反而更快。S12-B-2 重开条件未触发。不要重开 S13-B-1 / S12-B-1..2 / S11-B-1 / S10-B-1..3。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片已合入：空枚举，未铸 S13-C-*。生产中位复核 663.4–674.6 ms/报告（与 R12-C 658–663 同带）。五处从未点名微观（PIVCSE / FINTAIL / REFZ / TSORT / DEG）全部关闭探针不铸 ID。S12-C-1 / RID / CNT / CMB 未重开。r1c–r7c 回归门绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。基线 `183df9b` 空 diff 再确认。

D 切片已合入：空枚举，未铸 S13-D-*。eval 地板复核 3.83–4.05 ms（Node v22.22.2，与 R12-D 3.72–4.07 同带）。本轮新增 eval 整命令 21 相位剖面，切片内可寻址 CPU 832–853 µs，全部落在已关 ID。11 项换名检查不铸 ID。S8-D-1..3 / S9-D-4 / S12-D-1..2 维持。基线 `82bef36` 空 diff 再确认。

E 切片已合入：空枚举，未铸 S13-E-*。SLICE-CPU 复核 13.5–15.9 µs/run（双 Node 交叉锚定，历史带 11–24）。三处从未点名微观（bandit includes 旁路、applyLearnedRouting 双中间数组、routingPolicyIdentity 再校验）是换名拒绝，不铸 ID。S8-E-1 / S9-E-2 / S13-B-1 辖区未重提。基线 `adb20d7` 空 diff 再确认。

F 切片已合入：空枚举，未铸 S13-F-*。全实验锚点复核 119–130 ms（r5f 122、r6f 119、r7f 129，与 121–133 带重叠）。本轮新增 validate Ω(P) 体分解（Set 哈希/表 88.6–90.4 ms ≈ 90%）与 P-scaling 二次曲线确认。三处换名角度不铸 ID。S7-F-1 ≠ S6-F-5 维持。基线 `519101f` 空 diff 再确认。

G 切片已合入：空枚举，未铸 S13-G-*（连续第二次完全空枚举）。计算顶复核 0.289–0.293 ms vs I/O 85.1–109.2 ms（~294–378×）。14 格矩阵 digest 与 R10-G/R11-G/R12-G 逐位相同。本轮新增 Node 22.22 API 面轴（编译缓存 / flush:true / FileHandle 追加 / 错误路径读序）全部命中已关 ID。S11-G-1..3 / S10-G-1 / S9-G-3 维持。基线 `4efee23` 空 diff 再确认。

H 切片已合入：空枚举，未铸 S13-H-*。热层默认复核 9.3–10.4 µs/run（历史跨 VM 带 3.9–10 上沿）；配置态 A/B 均低于默认、无悬崖。本轮新增规模-越线标定：objective 线性越线 ~613–633k chars；criteria 二次越线 C≈482–503；既有 +2 量级重开条件在 C=200 仅 641–683 µs。15 项换名检查在候选化前全拒列。S5-H-1 字节级维持。基线 `fd437a9` 空 diff 再确认。

I 切片 = **25 文件**：`src/cli/` 13 + `src/pi-adapter/` 9 + `src/config/` 2 + `src/telemetry/` 1（R8-I「~28 / cli 16」是抬头误计）。必须站在 S1-I / S4-I / S5-I-1 / S7-I-1 之上。不要重开 S4-I-2..5 / S5-I-2..5 / S8-I-1..3。R9-I / R10-I / R11-I / R12-I 空枚举、未铸 ID。S8-I-1 skip-fallback 不健全；重开仅当 pi-ai 自身 ship `models.generated` / `./providers/all.models`。0.84.1 的 7 exports 已全部特征化。自制 union / 磁盘快照 / memo 三重围栏维持。custom−builtin 是唯一数十 ms 结构。基线 `8dee7fb` 预期空 diff。

J 切片 = **29 文件**：`src/cluster/` 3 + `src/privacy/` 3 + `src/preferences/` 7 + `src/episode/` 5 + `src/persist/` 2 + `src/track/` 4 + `src/context/` 2 + `src/feedback/` 3。必须站在已落地 J1 之上。不要重开 S1-J-1..7 / S2-J-1..11 / S3-J-1..6 / S4-J-1..6 / S5-J-1..6 / S6-J-1..6 / S7-J-1..6 / S8-J-1..2 / S9-J-1..4。R10-J / R11-J / R12-J 空枚举、未铸 ID。禁止去 fsync / 完整性再哈希 / 增量读镜像。删除级联 fail-closed 两读顺序 + 串行两写（S5-J-3 / S6-J-1）钉死。S8-J-2 jsonl 单句柄合并符号不稳。R11-J 两处无名微观与 R12-J 三处跨函数微观（spawn 双 trim / claimRole byRole 重取重存 / packet omissions 双遍）均不补铸。J1 仿真 2468 项须保持绿。基线 `fb41417` 预期空 diff。
