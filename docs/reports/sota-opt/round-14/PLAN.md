# Round 14 分区（10 子代理，3-VM 分波）

模型一律 `claude-fable-5-thinking-xhigh`。基线：最新 `cursor/sota-persistent-opt-83a1`。

Round 1–13 已对各区做过十三遍穷尽裁决，并落地 S1-F / J1 / S1-C / S1-I / S2-C / S3-C / S4-C / S4-I / S5-C / S5-F / S5-I-1 / S6-C / S6-F-1 / S7-C / S7-F-1 / S7-F-2 / S7-I-1。本轮只接受排除表未覆盖、且理论+仿真达门槛的新更优解。禁止重开任何 X* / S1-* … S13-* 条目（含已合入的 S13-B-1 与 R12-A / R12-E / R12-F / R12-G / R12-H / R12-I / R12-J / R13-A / R13-C / R13-D / R13-E / R13-F / R13-G / R13-H / R13-I / R13-J / R14-A / R14-B / R14-C / R14-D / R14-E / R14-F / R14-I 的空枚举收口）。S7-C 已落地，不得另起平行实现。S7-F-1 不是 S6-F-5。

R7-I 的教训：默认态夹具会遮蔽配置态主路径。本轮须按「配置态 × 命令类」矩阵复核测量盲区。多个切片已有整片预算收口（A/B/D/E/H 的 µs 级上界；G/J 的契约/I/O 地板；C 的 ±35 ms 噪声带；F 的全实验 ~120 ms 锚点；I 的 custom 回退是唯一数十 ms 结构且被健全性反例封死）——先复核再找新角度，不要硬凑。

分区与 Round 1 相同（R14-A … R14-J），报告写入 `docs/reports/sota-opt/round-14/`。

状态：第 4 波 J 本波派出；A–F/I 已合入（空枚举）；G/H 运行中。Round 13 已收口 10/10。

A 切片已合入：空枚举，未铸 S14-A-*。预算复核 69–81 µs/run（锚点 13.9–16.3 µs/gate，与 R13-A 70–81 同带）。合同地板复现：hashAssessment×3 ~41–42%、validateEvent ~20–21%、turn ~13%、prescore×2 ~10%、O(E) 扫描 ~1.9–2.0%（第五扫描 currentGateStatus 51–65 ns 首次单列）。本轮新增 E 规模越线标定（10 ms/run 需 E≈1.4–1.7×10⁵）与 max-codes 格（14.6–15.0 µs/gate，无悬崖）。3 项换名拒绝不铸 ID。基线 `7acb666` 空 diff 再确认。

B 切片已合入：空枚举，未铸 S14-B-*。天花板复核 M=2 9.3–10.2、M=10 17.6–19.6、replay 6.9–7.1、10× 98.6–105.0 ms/eval（历史带快端）。S12-B-2 重开条件未触发（eval-routing 传 learned 不传 prior）。本轮新增 GC/分配预算格（replay 路径 GC 占 15–24%，分配消除类硬顶 1.1–4.6 ms/eval）与 JIT 档审计（13 热函数 turbofan、0/17 deopt；route 提升至模块级符号翻转）。换名检查全部落在已关 ID。Live = R0。基线 `94ed3d9` 空 diff 再确认。

C 切片已合入：空枚举，未铸 S14-C-*。生产中位复核 657.6–689.3 ms/报告（与 663.4–674.6 同带）。四处从未点名微观（SWORD / XF64 / IRLSDP / CMPH）关闭探针不铸 ID。APC 池漂移仍在 ±35 ms 组合天花板内（13.6–21.9）。r1c–r7c 回归门绿（8028 / 14420 / 14730 / 24888 / 28555 / 25483 / 6193）。R13-C 无名微观不补铸。基线 `183df9b` 空 diff 再确认。

D 切片已合入：空枚举，未铸 S14-D-*。eval 地板复核配置态 4.05–4.21 ms / toy 4.24–4.69 ms（Node v22.22.2，与 R13-D 3.83–4.05 同带上沿）。本轮新增规模越线标定：切片内可寻址池生产锚 0.53–0.54 ms，越 10 ms 需 17–18×；最早越线件为 assignTasks 合同屏障（9–11×，不可重开）；S6-D-5 rerunHash 在 E=20000 测得 46.2–49.8 ms，50 ms 越线 101–108×。8 项新角度换名/死面/越界拒绝。基线 `82bef36` 空 diff 再确认。

E 切片已合入：空枚举，未铸 S14-E-*。SLICE-CPU 复核 17.2–19.2 µs/run（双 Node 16 次，历史带 11–24；距 10 ms 落地线 521–583×）。本轮新增规模越线标定（E\*≈18,184–18,833，约 444–459× 生产）与 JIT 档审计（6/6 热导出 turbofan、0 deopt）。R13-E 三处无名微观原样在位不补铸。4 项新角度换名/理论失败拒绝。基线 `adb20d7` 空 diff 再确认。

F 切片已合入：空枚举，未铸 S14-F-*。全实验锚点复核 120.7–129.1 ms（与 119–130 同带）。S7-F-1 ≠ S6-F-5 再确认，四次序符号两次独立运行全正。本轮新增 GC 占比（2.35–2.39 ms / 2.0%）、字符串出处格（+7.1–7.2 ms，无悬崖）与 deopt 审计（稳态 0）。从未点名的 assign 站点哈希规范化量级拒绝（≤7.2 ms）不铸 ID。r1f/r5f/r6f/r7f 绿（2668 / 224 / 27 / 169）。基线 `519101f` 空 diff 再确认。

G 切片 = 42 文件：`src/run/` 除 child-tracking.ts / gate-apply.ts（属 A）、`src/supervisor/` 除 model-router.ts（属 B）、`src/graph/`、`src/domain/`。不要重开 S1-G-* … S9-G-3 / S10-G-1 / S11-G-1..3。R12-G / R13-G 空枚举、未铸 ID。禁止去 fsync / 完整性再哈希。计算顶 ~0.289–0.293 ms vs I/O ~85–109 ms。R13-G Node 22.22 API 面轴（编译缓存 / flush:true / FileHandle 追加 / 错误路径读序）已命中已关 ID，不补铸。14 格矩阵 digest 与 R10-G/R11-G/R12-G 逐位相同。基线 `4efee23` 预期空 diff。

H 切片 = 21 文件：`src/evaluation/` 9 + `src/requirement/` 7 + `src/review/` 4 + `src/rubric/` 2。不要重开 S1-H-* … S5-H-1 / S8-H-1。R10-H / R11-H / R12-H / R13-H 空枚举、未铸 ID。S5-H-1（detectConflicts 预分配守卫）字节级维持。热层默认复核 9.3–10.4 µs/run。R13-H 规模-越线标定（objective 线性 ~613–633k chars；criteria 二次 C≈482–503）与 15 项换名拒列不补铸。基线 `fd437a9` 预期空 diff。

I 切片已合入：空枚举，未铸 S14-I-*（六连空）。custom−builtin 复核 children +52.2/+26.7、track +55.1/+23.7 ms（22.14/22.22）。S8-I-1 两臂复测仍文件级 blocked。本轮新增肥配置态交叉不存在证明：N=5/10/20/39 阶梯下 per-provider 惰性全程低于 `providers/all` 冷载；manyprov10 仅 +3.5~+7.7 ms，无悬崖。R13-I 两处无名微观不补铸。r4i/r5i/r7i 绿（68 / 119 / 80）。基线 `8dee7fb` 空 diff 再确认。

J 切片 = **29 文件**：`src/cluster/` 3 + `src/privacy/` 3 + `src/preferences/` 7 + `src/episode/` 5 + `src/persist/` 2 + `src/track/` 4 + `src/context/` 2 + `src/feedback/` 3。必须站在已落地 J1。不要重开 S1-J-1..7 / S2-J-1..11 / S3-J-1..6 / S4-J-1..6 / S5-J-1..6 / S6-J-1..6 / S7-J-1..6 / S8-J-1..2 / S9-J-1..4。R10-J / R11-J / R12-J / R13-J 空枚举、未铸 ID。禁止去 fsync / 完整性再哈希 / 增量读镜像。删除级联 fail-closed 两读顺序 + 串行两写（S5-J-3 / S6-J-1）钉死。S8-J-2 jsonl 单句柄合并符号不稳。R11-J 两处无名微观、R12-J 三处跨函数微观、R13-J 两处存在性探针理论失败均不补铸。J1 仿真 2468 项须保持绿。I/O 地板 R13-J：saveToDisk 131.7–211.2 / 407.6–514.9 µs；jsonl 60.4–67.1 / 242.0–396.0 µs；级联 613.7–723.8 / 254.7–292.0 µs。基线 `fb41417` 预期空 diff。
