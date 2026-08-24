MODEL_SLUG=claude-fable-5-thinking-xhigh

# R2-E：`src/learning/` 复查报告（Round 1 同区第二遍）

**战役:** 全库持久 SOTA 优化 Round 2 / R2-E
**基线:** `cursor/sota-persistent-opt-83a1` @ `8467d28`
**分支:** `cursor/r2-e-learning-slice-a47a`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 10 个文件（1770 行）自 R1-E
基线（`adb20d7`）以来**逐字节未变**（`git diff adb20d7..8467d28 -- src/learning/`
为空），R1-E 的逐文件收口与 S1-E-1..8 排除全部继承有效；生产调用面交叉检索
复核未变（post-run 自适应环 + live 装配面；`patterns`/`attribution`/
`signatures`/`compareSignatures` 仍无生产调用方）。本轮在完整排除表（含
Round 1 十区 S1-* 与 R2-A/R2-D 的 S2-A-1..6、S2-D-1..5）之上以新角度再枚举，
得到 7 个此前未点名的新候选（S2-E-1 … S2-E-7），全部经理论 + 确定性仿真
（seeded mulberry32，>25000 项等价检查 / 全 UTF-16 码元奇偶校验 / 真实规模
基准，三次独立运行等价结论逐位一致、计时方向稳定）裁决后淘汰：2 个在真实
规模**实测更慢**（S2-E-5 流式截断 0.58×、S2-E-6 n=10 融合更慢——战役
「小集合上重构固定开销高于线性重算」教训的第五、六例），其余 5 个是
ns~亚 ms 级噪声且各带独立的契约/边界理由（保存时机语义 X0-3 域、锁内
读-建-写持久化契约、task-success 空字段边界契约）。未重开任何 X* / S1-* /
S2-* 条目。`adapt auto` 只提案、SPARKLE_AUTO_ADAPT=0 仍收集、taskSuccess
伪造 fail-closed——零 diff，天然不变。本切片在其输出契约与数据面语义下
仍为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/learning/` 全部 10 文件（`attribution` / `auto-loop` /
  `bandit-store` / `diagnostics` / `from-episode` / `learned-routing` /
  `patterns` / `signals` / `signatures` / `task-success`）本轮再次全量实际
  读码，未依赖 R1-E 的记忆。上下游 `adaptation/`（promotion、candidate、
  registry、approval-profile）、`routing/`（bandit、outcomes、catalog-model、
  failure-class）、`run/`（event-store、episode-bind）、`persist/jsonl`
  只读取证，一行未改——遵守「不改 adaptation 实现文件（可 import）」。
- 先读并遵守：README / EXCLUSIONS.md / round-02/PLAN.md / round-01/R1-E.md。
- 排除表遵守：候选枚举刻意绕开全部既有排除——S1-E-1..8（两遍合并、judge
  双 get、parts+join、filter 去重、Promise.all 并行、组内融合、排序换 min、
  keys 预取全部不再提案）、X0-3（auto-loop 与 from-episode 主体合并）、
  X2-6（相似度对键记忆化）、X1-1（模块级缓存，含 stableProjectKey）、
  X0-5/X0-6/X1-2。本轮只探索**未被点名的新角度**：无变更路径省略注册表保存
  （S2-E-1）、跨调用三遍事件扫描融合（S2-E-2）、弃置构造消除（S2-E-3）、
  无变更跳写（S2-E-4）、流式截断早退（S2-E-5）、filter+map 中间数组融合
  （S2-E-6）、跨边界双拷贝消除（S2-E-7）。
- 行为面全部不变：`adapt auto` 只提案（`autoPromote` 被忽略、绝不 CAS 晋升）、
  SPARKLE_AUTO_ADAPT=0 仍收集、`parseObservedSignal` 拒绝 user/human 伪造
  taskSuccess、`ensureRoutingBaseline` 绝不移动既有指针——本轮零 diff，
  天然满足。不声称 Outcome-supported；Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 规模与门槛基底（继承 + 本轮新锚点）

R1-E 已实测本切片现实规模（E≈41、S≈10–15、M≤10、subagent 目录个位数文件、
每信号 appendFeedback 96–192µs），代码与调用面未变，本轮直接继承。R2-A/R2-D
校准的战役落地线继承：**已落地项在百 ms 级或复杂度类下降**（J1 2770×、
S1-F 4.8×、S1-C ~450ms/fit）；µs 级与亚 ms 级候选一律被否决过（S1-I-1
~190µs、S2-A-1 ~12µs、S1-C-7 亚 ms、S2-D-4 ~116µs）。

本轮新测的 I/O 支配锚点（三次运行区间）：

```text
one saveAdaptationRegistry (serialize+fsync+rename) = 409-716us
one full updateProjectBandit (lock+read+build+write) = 446-456us
readJsonlObjects(41 events) = 100-115us  (EventStore.readAll 的下界，
  真实 readAll 还要每事件 validateEvent)
```

切片所有生产入口都在这些 ms 级 I/O 事务内或旁边，任何 µs 级 CPU 候选都被
支配。

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S2-E-1 | auto-loop `proposeAndMaybePromote` 在「identical candidate already proposed / matches baseline」且 baseline 未新注册时跳过 `saveAdaptationRegistry` | 省一次原子 fsync 写 | —（无变更时保存字节恒等，跳过仅改 mtime/刷新语义） | 一次 save 实测 **409–716µs**；路径要求 auto-adapt 开启 + actionable 失败 + 重复策略，极低频 | 淘汰：亚 ms 级低于否决线（S1-C-7/S2-D-4 同级）；且 auto-loop 无条件保存 vs from-episode 条件保存正是 X0-3 点名的「保存时机语义不同」——改齐即侵蚀该受保护边界 |
| S2-E-2 | `proposeRoutingFromRoutedEvents` 三遍事件扫描（project 快照 + `outcomesFromRoutedRun` + `episodeIdFromEvents`）融合单遍 | 3×Θ(E)→1×Θ(E)；三遍结果互不影响（均为扫后使用），与 S1-E-1 的发散结构不同，可证等价 | ✅ 3000 fuzz（含重路由/级联重试/多 RUN_ATTACHED/不完整路由）逐字节一致 | E=41 三遍合计 4226–4283ns，融合省 **114–142ns/call**；同路径 `readAll` I/O ≥100µs（~10³×） | 淘汰：project/episode 两遍本身只占 ~130ns，融合需内联复制 `outcomesFromRoutedRun`/`episodeIdFromEvents` 主体（X1-2 类平行实现），收益深度噪声 |
| S2-E-3 | `updateProjectBandit` 消除 previous 存在时先建后弃的 `createBanditState(armList)` | 省一次 O(M) 构造 | ✅ 4000 fuzz（混合 previous 有/无、novel/空白 modelId、三态 outcomeKind）状态 JSON 逐字节一致 | M=10 S=12 省 **305–331ns/call**，占同函数全调用（446–456µs 锁内读写）**0.28%** | 淘汰：锁内 I/O 支配，深度噪声（S1-E-4 同构） |
| S2-E-4 | `updateProjectBandit` 状态与 previous 序列化恒等时跳过写盘 | 省一次 writeFile | —（序列化比较 12ns，检测本身近零成本） | 写份额 <455µs 一次性；且触发面窄（需无新 arm 且无 taskSuccess reward，而该函数仅在存在 modelId 信号时被调） | 淘汰：亚 ms + R1-E 已裁决「锁内读-建-写为一次性持久化契约」（写通格式归一 + mtime 新鲜度是可观察数据面行为；S1-G-2/X3-3 同族） |
| S2-E-5 | `truncate` 流式收集 401 输出字符早退（免全文 `/\s+/g` 正则归一化） | O(len)→O(前 400 折叠字符)；\s 语义经全 65536 码元奇偶校验逐位保留 | ✅ 6000 Unicode fuzz（NBSP/EM SPACE/LS/PS/IDEOGRAPHIC SPACE/ZWNBSP/代理对）+ 399/400/401/402 边界全一致 | 现实 85B 摘要 **0.58–0.60× 实测更慢**；5KB 3.4–3.5×（省 ~21µs）；100KB 74–80×——但 100KB 超现实两个量级，且每 truncate 伴随 ~10²µs appendFeedback | 淘汰：真实规模负优化（S1-E-6/S1-A-4/S1-B-6 系列第五例）；收益仅存在于输入分布不支持的尾部 |
| S2-E-6 | `optimizedPolicy` filter+map 双遍融合单遍 + `applyLearnedRouting` avoided 构建免两个中间数组 | 2 遍→1 遍 / 免 2 次数组分配 | ✅ 各 4000 fuzz 一致 | optimizedPolicy n=3 delta **±6ns 抖动内**（+6/+3/−3 三次异号）；n=10 三次**一致更慢**（−99/−51/−97ns）；applyLearnedRouting avoid=10 M=10 省 2–11ns/task | 淘汰：真实规模亚噪声 + 中等规模负优化（融合系列第六例）；live 面 Iter4 已裁决 M≤10 |
| S2-E-7 | `signalFromAgentMessage` TASK_RESULT 的 binding 条件 spread 构造与 task-success `copyDefinedBinding` 双拷贝合一 | 免一次 5 字段对象拷贝 | —（上界锚点测量；融合需在调用侧复制 `present()` 空白字段裁剪逻辑） | 上界 **246–260ns/TASK_RESULT**（~10/run → ~2.5µs/run） | 淘汰：亚噪声；`present()` 的 trim 裁剪是 task-success「Missing route fields are omitted, never invented」公开契约的实施点，调用侧复制 = 边界侵蚀（X0-5/X1-2 同类） |

## 3. 关键裁决细节

### 3.1 S2-E-1：本轮最强候选为何仍不落地

no-change 路径上跳过 `saveAdaptationRegistry` 是本轮唯一超过 100µs 的候选
（实测 409–716µs：snapshot 序列化 + `wx` 临时文件 + fsync + rename）。
不落地的三条独立理由：
(1) **量级**：亚 ms 一次性收益低于战役否决线（S1-C-7 亚 ms、S2-D-4 116µs、
    S1-I-1 190µs 均已否决），且同一调用已必然支付 registry 载入（~90µs，
    含全量重哈希校验）+ 此前的 bandit 锁事务（~450µs）+ 每信号 feedback
    追加（10²µs×S）；
(2) **频率**：该路径要求 `isAutoAdaptEnabled()` + actionable 失败诊断
    （≥5 样本且均值 <0.45）+ 策略与既有候选/基线重复——现实中偶发；
(3) **语义边界**：auto-loop 两分支无条件保存 vs from-episode 的
    「existing/matches-baseline 提前返回不保存」正是 X0-3 排除所点名的
    「保存时机语义不同」。把 auto-loop 改成条件保存即把两处主体在保存语义上
    改齐，是对该受保护差异的侵蚀，需先推翻 X0-3 的立项理由。

### 3.2 S2-E-2 与 S1-E-1 的关系（为何这次可证等价、但仍淘汰）

S1-E-1 的发散反例源于 `collectSignalsFromEvents` 第一遍的 project/route
绑定结果被第二遍**逐事件消费**——合并使输出依赖事件顺序。本候选不同：
`proposeRoutingFromRoutedEvents` 的三遍各自独立扫完才使用结果（project
last-wins、episode 反向首个 RUN_ATTACHED ≡ 正向最后一个、outcomes 自含
routes-so-far），融合可证等价，3000 例含对抗构造的 fuzz 全一致。但收益
结构否决它：三遍中两遍是纯类型分支扫描（103–108ns + 25–32ns），支配项
`outcomesFromRoutedRun`（~4.1µs）无论如何都要跑；融合实测只省
114–142ns/call，而同路径的 `EventStore.readAll` 磁盘读 + 逐事件
validateEvent ≥100µs。且工程形态要么内联复制两个跨模块函数体（X1-2 类），
要么改它们的公开签名。为将来任何「routed-events 单遍化」提案立此测量。

### 3.3 S2-E-5 / S2-E-6 的反向教训（融合/重构系列第五、六例）

S2-E-5 纸面上是本切片罕见的复杂度类下降（O(len)→O(400)），且等价性经全
码元奇偶校验 + 6000 Unicode fuzz 严格成立——但现实输入（单句摘要、
TASK_RESULT summary、peer body，几十~几百字节）上流式逐字符循环比 V8
原生正则 replace **一致慢 40%**（0.58/0.60/0.58 三次）；收支平衡点在
~1KB，5KB 才省 21µs（< 同信号 I/O 的 1/5），80× 的收益要 100KB 输入——
超现实两个量级。S2-E-6 在 n=10 上三次一致更慢（对象字面量条件 spread 在
单遍循环里逐个 push 的隐藏类切换开销 > 两遍 map/filter 的连续快路径）。
与 S1-A-4、S1-B-6、S1-E-6、S1-E-8 构成同一教训的第五、六例：**小集合/
短输入上，重构固定开销高于被消除的重复线性工作**。后续轮次禁止以纯理论
重提此类候选。

### 3.4 S2-E-3 / S2-E-4 / S2-E-7 按支配与契约淘汰

S2-E-3 是真实的弃置构造（previous 存在时 `createBanditState` 白建），
消除后 305–331ns/call——但该函数每 run 恰好一次、全程在文件锁内，锁 + 读 +
写实测 446–456µs，占比 0.28%，不可测。S2-E-4 的「无变更跳写」检测成本仅
12ns，但写通行为（格式归一、mtime 新鲜度）是 R1-E 已裁决的锁内读-建-写
持久化契约的一部分，且亚 ms。S2-E-7 的双拷贝里第二次拷贝
（`copyDefinedBinding` + `present()` trim）是 task-success 包「空白字段
按缺失处理、绝不发明路由字段」契约的实施点——调用侧融合要么信任上游
（削弱 fail-closed），要么复制裁剪逻辑（X0-5 同类），收益上界 ~2.5µs/run。

## 4. 逐文件收口（R1-E 收口之上的本轮新检查点）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `auto-loop.ts` | S2-E-1 淘汰（§3.1）；`signals` 三源 spread 合并 S≈12 一次分配噪声；`persistSignals`/`ingestSubagentDirectory` 维持 S1-E-4/5；顺序 appendFeedback 不可并行化（jsonl 追加序是数据面语义） | 无候选落地 |
| `from-episode.ts` | S2-E-2 淘汰（§3.2）；`outcomeKindFromResult` 的未用 `outcome` 参数是死参数（清理项非性能项，零收益不动）；`applyCascadeRetry` spread 拷贝为重试级常数 | 无候选落地 |
| `bandit-store.ts` | S2-E-3/4 淘汰（§3.4）；`arms.includes` Set 化与 reward 增量化维持 Iter4/X1-2 裁决 | 无候选落地 |
| `signals.ts` | S2-E-5/7 淘汰；S1-E-1/2/3 维持；`parseObservedSignal` 全字段校验 + taskSuccess 伪造拒绝为契约 | 无候选落地 |
| `learned-routing.ts` | S2-E-6 的 applyLearnedRouting 变体淘汰；`loadLearnedRouting` 错误路径正则仅错误时求值（每进程 ≤1 次，零收益）；`parseLearnedRoutingPolicy` 单次 JSON.parse + Θ(entries) 校验即下界 | 无候选 |
| `diagnostics.ts` | S1-E-6 维持；恒真守卫保留（R1-E §4.4）；无新角度 | 无候选 |
| `patterns.ts` / `attribution.ts` / `signatures.ts` | 仍无生产调用方（本轮交叉检索复核）；S1-E-7/8、X2-6 维持 | 无候选 |
| `task-success.ts` | S2-E-7 的被调侧：`copyDefinedBinding`+`present()` 是边界契约实施点，不动 | 无候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.14.0）：

```bash
npx tsx --test "test/unit/learning/*.test.ts" "test/acceptance/adaptive-loop.test.ts"
# tests 48 / suites 2 / pass 48 / fail 0
```

仿真（临时脚本 `/tmp/r2e-sim.mts`，未入库；完整源码见附录，seeds
`0xe22e01`–`0xe22e06`）最终一次运行：

```text
S2-E-2 bench E=41: project-pass=107ns episode-pass=25ns outcomes-pass=4151ns | 3-pass total=4283ns fused=4141ns delta=142ns/call
S2-E-2 anchor: readJsonlObjects(41 events)=110.4us (lower bound of EventStore.readAll I/O on the same path)
S2-E-3 bench M=10 S=12: current=1284ns cand=966ns delta=317ns/call
S2-E-3/4 anchor: one full updateProjectBandit (lock+read+build+write)=445.8us; in-memory build is 0.29% of it
S2-E-4 anchor: serialized-compare=12ns vs full call 445.8us (write share is sub-ms once per run)
S2-E-1 anchor: one saveAdaptationRegistry (serialize+fsync+rename)=636us; the load the path always pays=92us
S2-E-5 bench realistic 85B: current=465ns stream=806ns (0.58x)
S2-E-5 bench 5KB: current=29952ns stream=8557ns (3.50x)
S2-E-5 bench 100KB: current=692412ns stream=9061ns (76.42x)
S2-E-6 bench optimizedPolicy n=3: current=326ns fused=329ns delta=-3ns/call
S2-E-6 bench optimizedPolicy n=10: current=1108ns fused=1206ns delta=-97ns/call
S2-E-6 bench applyLearnedRouting avoid=10 M=10: current=135ns fused=133ns delta=2ns/task
S2-E-7 anchor: binding + double copy=269ns fused single construction=9ns -> upper bound 260ns per TASK_RESULT event (~10/run)

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 >25000 项等价检查（S2-E-2 3000 例、S2-E-3 4000 例、S2-E-5
6000 例 ×2 变体 + 65536 码元奇偶 + 4 边界、S2-E-6 4000 例 ×2）全部通过、
结论逐位一致；计时方向稳定（S2-E-5 realistic 三次全部更慢 0.58/0.60/0.58；
S2-E-6 n=10 三次全部更慢；S2-E-6 n=3 三次异号确认纯抖动）。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S2-E-1 | auto-loop 无变更路径跳过 saveAdaptationRegistry | 亚 ms（409–716µs）低频一次性，低于否决线；且条件保存把 auto-loop 与 from-episode 的保存时机语义改齐，侵蚀 X0-3 点名的受保护差异 |
| S2-E-2 | proposeRoutingFromRoutedEvents 三遍事件扫描融合单遍 | 可证等价（三遍结果互不逐事件消费，与 S1-E-1 结构不同），但 E=41 仅省 114–142ns vs 同路径 readAll ≥100µs；需内联复制跨模块函数体（X1-2 类） |
| S2-E-3 | updateProjectBandit 弃置 createBanditState 消除 | 等价但 305–331ns/call，占锁内全调用（446–456µs）0.28%，I/O 支配 |
| S2-E-4 | updateProjectBandit 状态未变跳过写盘 | 亚 ms + 锁内读-建-写持久化契约（R1-E 已裁决；写通格式归一/mtime 为可观察数据面行为，S1-G-2/X3-3 同族） |
| S2-E-5 | truncate 流式收集 401 字符早退（免全文 /\s+/g） | 等价严格成立（全码元奇偶 + Unicode fuzz），但现实短摘要 0.58× 实测更慢；收支平衡 ~1KB、80× 收益要 100KB 超现实输入 |
| S2-E-6 | optimizedPolicy filter+map 融合 + applyLearnedRouting 中间数组消除 | 等价但 n=3 抖动内、n=10 实测一致更慢（融合系列第六例）；live 面 Iter4 已裁决 |
| S2-E-7 | TASK_RESULT binding 与 copyDefinedBinding 双拷贝合一 | 上界 ~260ns/事件（~2.5µs/run）；present() trim 是 task-success 空白字段契约实施点，调用侧复制=边界侵蚀（X0-5 类） |

重开条件：S2-E-1 需先推翻 X0-3 的保存时机语义立项或 no-change 路径变为
高频（≥每 turn）；S2-E-2 可凭本报告等价证据在 `outcomesFromRoutedRun`/
`episodeIdFromEvents` 提供可组合单遍公开入口后重开；S2-E-3/4 若 bandit
事务离开文件锁 I/O 面（内存化）可重开；S2-E-5 需先出现 ≥10KB 的现实
summary/extracted.text 输入分布证据；S2-E-6 属融合系列，需推翻五例系列
证据；S2-E-7 需 task-success 先公开接受预裁剪 binding 的入口。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后在仓库根目录 `npx tsx <file>`（依赖已装；
`.mts` 保证 ESM 顶层 await）。seeds：`0xe22e01`–`0xe22e06`。

```ts
/**
 * R2-E deterministic equivalence + benchmark simulation.
 * Adjudicates fresh candidates S2-E-1 .. S2-E-7 against the current
 * implementations in src/learning/. Seeded PRNG (mulberry32) -> reproducible.
 * Seeds: 0xe22e01 - 0xe22e07.
 *
 * Reference = production imports. Candidates = full replicas whose only
 * difference from the verbatim-copied private helpers is the candidate edit.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { outcomesFromRoutedRun } from "/workspace/src/learning/from-episode.js";
import {
  applyLearnedRouting,
  ensureRoutingBaseline,
  routingPolicyContent,
  routingPolicyIdentity,
  type LearnedAvoid,
  type LearnedPrefer,
  type LearnedRoutingPolicy
} from "/workspace/src/learning/learned-routing.js";
import { updateProjectBandit } from "/workspace/src/learning/bandit-store.js";
import type { ModelProjectIssue } from "/workspace/src/learning/diagnostics.js";
import type { ObservedSignal } from "/workspace/src/learning/signals.js";
import { taskSuccessFromResult, type TaskSuccessRouteBinding } from "/workspace/src/learning/task-success.js";
import { episodeIdFromEvents } from "/workspace/src/run/episode-bind.js";
import type { Event, ModelRoutedPayload } from "/workspace/src/run/events.js";
import { createBanditState, recordReward, type BanditState } from "/workspace/src/routing/bandit.js";
import { oneHotDistribution } from "/workspace/src/routing/catalog-model.js";
import { classifyTaskFailure } from "/workspace/src/routing/failure-class.js";
import { parseOutcomeObservation, type OutcomeObservation } from "/workspace/src/routing/outcomes.js";
import { isAgentRole, AGENT_ROLES } from "/workspace/src/domain/roles.js";
import type { TaskFamily } from "/workspace/src/task/taxonomy.js";
import {
  loadAdaptationRegistryOrNew,
  saveAdaptationRegistry
} from "/workspace/src/adaptation/promotion.js";
import { hashCandidateContent } from "/workspace/src/adaptation/candidate.js";
import { readJsonlObjects } from "/workspace/src/persist/jsonl.js";
import type { ProjectId } from "/workspace/src/domain/ids.js";
import type { IsoTimestamp } from "/workspace/src/domain/timestamp.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${name}${detail === undefined ? "" : `: ${detail}`}`);
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}
function bench(fn: () => void, reps: number): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) fn();
  return (performance.now() - t0) / reps;
}
async function benchAsync(fn: () => Promise<void>, reps: number): Promise<number> {
  await fn();
  const t0 = performance.now();
  for (let i = 0; i < reps; i += 1) await fn();
  return (performance.now() - t0) / reps;
}

const NOW = "2026-08-24T05:00:00.000Z" as IsoTimestamp;
const FAMILIES_LOCAL: readonly TaskFamily[] = [
  "edit", "test", "review", "plan", "research", "refactor", "deploy", "unknown"
];

/* ================================================================
 * Realistic routed-run event generator (R1-A composition: E~41,
 * 10 MODEL_ROUTED, 10 CHILD_MESSAGE, few retries/answers/attach).
 * Field values valid enough for parseOutcomeObservation to keep rows.
 * ================================================================ */
function genRoutedEvents(rng: () => number, length: number): Event[] {
  const out: unknown[] = [];
  const taskIds = Array.from({ length: 10 }, (_, i) => `tsk_${i}0000000`);
  const models = ["cheap", "premium", "mid"];
  out.push({
    type: "PROJECT_DISCOVERED",
    runId: "run_simsim01",
    occurredAt: NOW,
    payload: { project: { id: "prj_simsim01", rootPath: "/tmp/proj-a" } }
  });
  out.push({
    type: "RUN_ATTACHED",
    runId: "run_simsim01",
    occurredAt: NOW,
    payload: { episodeId: "ep_simsim01", runId: "run_simsim01", attachedAt: NOW }
  });
  for (let i = 0; i < length; i += 1) {
    const roll = rng();
    const taskId = pick(rng, taskIds);
    if (roll < 0.04) {
      out.push({
        type: "PROJECT_DISCOVERED",
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: { project: { id: `prj_p${Math.floor(rng() * 3)}simsim`, rootPath: `/tmp/proj-${Math.floor(rng() * 3)}` } }
      });
    } else if (roll < 0.28) {
      const model = pick(rng, models);
      const complete = rng() < 0.85;
      out.push({
        type: "MODEL_ROUTED",
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: {
          taskId,
          model,
          role: pick(rng, ["actor", ...AGENT_ROLES]),
          eligibleModels: models,
          behaviorDistribution: oneHotDistribution(models, model),
          ...(complete ? { family: pick(rng, FAMILIES_LOCAL) } : {}),
          ...(complete ? { featureVersion: "fv1" } : {}),
          ...(complete ? { modelVersion: "v1" } : {}),
          ...(complete ? { agentRole: pick(rng, [...AGENT_ROLES, "actor"]) } : {})
        }
      });
    } else if (roll < 0.36) {
      out.push({
        type: "TASK_RETRY",
        runId: "run_simsim01",
        occurredAt: NOW,
        taskId: rng() < 0.8 ? taskId : undefined,
        payload: {
          nextModel: rng() < 0.85 ? pick(rng, [...models, "fresh"]) : rng() < 0.5 ? "" : undefined,
          nextModelVersion: rng() < 0.6 ? "v2" : rng() < 0.5 ? " " : undefined
        }
      });
    } else if (roll < 0.62) {
      out.push({
        type: "CHILD_MESSAGE",
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: {
          message: {
            type: "TASK_RESULT",
            taskId: rng() < 0.85 ? taskId : "tsk_unrouted0",
            runId: "run_simsim01",
            outcome: pick(rng, ["SUCCESS", "PARTIAL", "FAILURE", "CANCELLED"] as const),
            verification: { kind: pick(rng, ["PASSED", "FAILED", "UNOBSERVED"] as const) },
            summary: pick(rng, ["tests passed", "compile error in adapter", "did the work", ""]),
            evidenceIds: rng() < 0.6 ? ["evd_00000001"] : []
          }
        }
      });
    } else if (roll < 0.7) {
      out.push({
        type: "RUN_ATTACHED",
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: { episodeId: `ep_a${Math.floor(rng() * 4)}simsim`, runId: "run_simsim01", attachedAt: NOW }
      });
    } else {
      out.push({
        type: pick(rng, ["USER_ANSWER", "LEDGER_UPDATED", "RUN_STARTED", "TASK_STATUS_CHANGED"] as const),
        runId: "run_simsim01",
        occurredAt: NOW,
        payload: { answer: "lgtm" }
      });
    }
  }
  return out as Event[];
}

/* ================================================================
 * S2-E-2 candidate: proposeRoutingFromRoutedEvents fuses its three
 * event passes (project scan + outcomesFromRoutedRun + episodeIdFromEvents)
 * into one forward pass. outcomes body replicated verbatim; project uses
 * last-wins; episode = last RUN_ATTACHED (reverse-first == forward-last).
 * ================================================================ */
function familyFromRoutedLocal(value: string): TaskFamily | undefined {
  return (FAMILIES_LOCAL as readonly string[]).includes(value) ? (value as TaskFamily) : undefined;
}
function isCompleteRouteLocal(payload: ModelRoutedPayload): boolean {
  return (
    typeof payload.family === "string" &&
    payload.family.trim() !== "" &&
    typeof payload.featureVersion === "string" &&
    payload.featureVersion.trim() !== "" &&
    typeof payload.modelVersion === "string" &&
    payload.modelVersion.trim() !== "" &&
    typeof payload.agentRole === "string"
  );
}
function outcomeKindFromResultLocal(verification: string): "PASS" | "FAIL" | undefined {
  if (verification === "PASSED") return "PASS";
  if (verification === "FAILED") return "FAIL";
  return undefined;
}
function applyCascadeRetryLocal(
  routes: Map<string, ModelRoutedPayload>,
  taskId: string | undefined,
  nextModel: string | undefined,
  nextModelVersion: string | undefined
): void {
  if (taskId === undefined || nextModel === undefined || nextModel.trim() === "") return;
  const current = routes.get(taskId);
  if (current === undefined) return;
  const eligible = current.eligibleModels.includes(nextModel)
    ? current.eligibleModels
    : [...current.eligibleModels, nextModel];
  routes.set(taskId, {
    ...current,
    model: nextModel,
    modelVersion:
      nextModelVersion !== undefined && nextModelVersion.trim() !== ""
        ? nextModelVersion
        : current.modelVersion,
    behaviorDistribution: oneHotDistribution(eligible, nextModel)
  });
}

interface FusedScan {
  projectId: string | undefined;
  projectRoot: string | undefined;
  episodeId: string | undefined;
  outcomes: OutcomeObservation[];
}

function fusedRoutedScan(events: readonly Event[]): FusedScan {
  let projectId: string | undefined;
  let projectRoot: string | undefined;
  let episodeId: string | undefined;
  const routes = new Map<string, ModelRoutedPayload>();
  const out: OutcomeObservation[] = [];
  for (const event of events) {
    if (event.type === "PROJECT_DISCOVERED") {
      projectId = event.payload.project.id;
      projectRoot = event.payload.project.rootPath;
      continue;
    }
    if (event.type === "RUN_ATTACHED") {
      episodeId = (event.payload as { episodeId: string }).episodeId;
      continue;
    }
    if (event.type === "MODEL_ROUTED") {
      const payload = event.payload;
      if (isCompleteRouteLocal(payload)) routes.set(payload.taskId, payload);
      continue;
    }
    if (event.type === "TASK_RETRY") {
      applyCascadeRetryLocal(routes, event.taskId, event.payload.nextModel, event.payload.nextModelVersion);
      continue;
    }
    if (event.type !== "CHILD_MESSAGE") continue;
    const message = event.payload.message;
    if (message.type !== "TASK_RESULT") continue;
    const route = routes.get(message.taskId);
    if (route === undefined) continue;
    const family = familyFromRoutedLocal(route.family as string);
    if (family === undefined) continue;
    const role = route.agentRole;
    if (role === undefined || !isAgentRole(role)) continue;
    const kind = outcomeKindFromResultLocal(message.verification.kind);
    if (kind === undefined) continue;
    const failureClass =
      kind === "FAIL"
        ? classifyTaskFailure({
            outcome: message.outcome,
            verificationKind: message.verification.kind,
            summary: message.summary,
            ...(message.failure !== undefined ? { failure: message.failure } : {})
          })
        : undefined;
    try {
      out.push(
        parseOutcomeObservation({
          taskFamily: family,
          role,
          modelId: route.model,
          modelVersion: route.modelVersion,
          featureVersion: route.featureVersion,
          criterion: "taskSuccess",
          outcome: kind,
          occurredAtMs: Date.parse(event.occurredAt),
          source: "deterministic-check",
          ...(failureClass !== undefined ? { failureClass } : {}),
          taskId: message.taskId,
          runId: event.runId,
          evidenceIds: message.evidenceIds
        })
      );
    } catch {
      continue;
    }
  }
  return { projectId, projectRoot, episodeId, outcomes: out };
}

function referenceRoutedScan(events: readonly Event[]): FusedScan {
  // Verbatim current structure: three separate passes.
  let projectId: string | undefined;
  let projectRoot: string | undefined;
  for (const event of events) {
    if (event.type === "PROJECT_DISCOVERED") {
      projectId = event.payload.project.id;
      projectRoot = event.payload.project.rootPath;
    }
  }
  const outcomes = outcomesFromRoutedRun(events);
  const episodeId = episodeIdFromEvents(events);
  return { projectId, projectRoot, episodeId: episodeId as string | undefined, outcomes };
}

{
  const rng = mulberry32(0xe22e01);
  for (let trial = 0; trial < 3000; trial += 1) {
    const events = genRoutedEvents(rng, Math.floor(rng() * 60));
    const ref = referenceRoutedScan(events);
    const cand = fusedRoutedScan(events);
    check(
      "S2-E-2 equivalence (fused single pass)",
      JSON.stringify(ref) === JSON.stringify(cand),
      `trial ${trial}`
    );
  }
  const events = genRoutedEvents(mulberry32(0xe22e02), 39); // + project + attach = 41
  const passProject = bench(() => {
    let p: string | undefined;
    let r: string | undefined;
    for (const event of events) {
      if (event.type === "PROJECT_DISCOVERED") {
        p = event.payload.project.id;
        r = event.payload.project.rootPath;
      }
    }
    void p;
    void r;
  }, 40000);
  const passEpisode = bench(() => void episodeIdFromEvents(events), 40000);
  const passOutcomes = bench(() => void outcomesFromRoutedRun(events), 20000);
  const fusedCost = bench(() => void fusedRoutedScan(events), 20000);
  console.log(
    `S2-E-2 bench E=41: project-pass=${(passProject * 1e6).toFixed(0)}ns episode-pass=${(passEpisode * 1e6).toFixed(0)}ns outcomes-pass=${(passOutcomes * 1e6).toFixed(0)}ns | 3-pass total=${((passProject + passEpisode + passOutcomes) * 1e6).toFixed(0)}ns fused=${(fusedCost * 1e6).toFixed(0)}ns delta=${((passProject + passEpisode + passOutcomes - fusedCost) * 1e6).toFixed(0)}ns/call`
  );
  // I/O anchor: readAll's disk read + JSON parse alone (validateEvent excluded,
  // so this UNDERSTATES the real readAll cost that dominates the same path).
  const dir = await mkdtemp(join(tmpdir(), "r2e-ev-"));
  const file = join(dir, "events.jsonl");
  await writeFile(file, events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
  const readCost = await benchAsync(async () => {
    await readJsonlObjects(file, (n) => new Error(`line ${n}`));
  }, 300);
  console.log(
    `S2-E-2 anchor: readJsonlObjects(41 events)=${(readCost * 1e3).toFixed(1)}us (lower bound of EventStore.readAll I/O on the same path)`
  );
}

/* ================================================================
 * S2-E-3 candidate: updateProjectBandit builds the state once instead of
 * constructing createBanditState(armList) and discarding it when a
 * previous state exists. Verbatim replica of the in-lock body.
 * ================================================================ */
function currentBanditBuild(
  previous: BanditState | undefined,
  signals: readonly ObservedSignal[]
): BanditState {
  const arms = new Set(previous?.arms ?? []);
  for (const signal of signals) {
    if (signal.modelId !== undefined && signal.modelId.trim() !== "") {
      arms.add(signal.modelId);
    }
  }
  const armList = [...arms];
  let state = createBanditState(armList);
  if (previous !== undefined) {
    const pulls: Record<string, number> = {};
    const rewardSum: Record<string, number> = {};
    for (const arm of armList) {
      pulls[arm] = previous.pulls[arm] ?? 0;
      rewardSum[arm] = previous.rewardSum[arm] ?? 0;
    }
    state = {
      arms: armList,
      pulls,
      rewardSum,
      explorationsUsed: previous.explorationsUsed,
      highRiskExplorations: previous.highRiskExplorations
    };
  }
  for (const signal of signals) {
    if (signal.criterion !== "taskSuccess") continue;
    if (signal.source === "user" || signal.kind === "human" || signal.kind !== "deterministic") continue;
    if (signal.modelId === undefined || !state.arms.includes(signal.modelId)) continue;
    if (signal.outcomeKind === "PASS") {
      state = recordReward(state, signal.modelId, 1);
    } else if (signal.outcomeKind === "FAIL") {
      state = recordReward(state, signal.modelId, 0);
    }
  }
  return state;
}

function candidateBanditBuild(
  previous: BanditState | undefined,
  signals: readonly ObservedSignal[]
): BanditState {
  const arms = new Set(previous?.arms ?? []);
  for (const signal of signals) {
    if (signal.modelId !== undefined && signal.modelId.trim() !== "") {
      arms.add(signal.modelId);
    }
  }
  const armList = [...arms];
  let state: BanditState;
  if (previous === undefined) {
    state = createBanditState(armList);
  } else {
    const pulls: Record<string, number> = {};
    const rewardSum: Record<string, number> = {};
    for (const arm of armList) {
      pulls[arm] = previous.pulls[arm] ?? 0;
      rewardSum[arm] = previous.rewardSum[arm] ?? 0;
    }
    state = {
      arms: armList,
      pulls,
      rewardSum,
      explorationsUsed: previous.explorationsUsed,
      highRiskExplorations: previous.highRiskExplorations
    };
  }
  for (const signal of signals) {
    if (signal.criterion !== "taskSuccess") continue;
    if (signal.source === "user" || signal.kind === "human" || signal.kind !== "deterministic") continue;
    if (signal.modelId === undefined || !state.arms.includes(signal.modelId)) continue;
    if (signal.outcomeKind === "PASS") {
      state = recordReward(state, signal.modelId, 1);
    } else if (signal.outcomeKind === "FAIL") {
      state = recordReward(state, signal.modelId, 0);
    }
  }
  return state;
}

function genBanditSignal(rng: () => number, models: readonly string[]): ObservedSignal {
  const criterion = pick(rng, ["taskSuccess", "userAcceptance", undefined] as const);
  return {
    source: pick(rng, ["user", "subagent", "deterministic"] as const),
    kind: pick(rng, ["human", "peer", "deterministic"] as const),
    projectId: "prj_simsim01" as ProjectId,
    score: Math.floor(rng() * 101),
    boundary: "execution",
    summary: "s",
    createdAt: NOW,
    evidenceIds: [],
    ...(rng() < 0.9 ? { modelId: pick(rng, [...models, "novel", "  ", ""]) } : {}),
    ...(criterion !== undefined ? { criterion } : {}),
    ...(rng() < 0.8 ? { outcomeKind: pick(rng, ["PASS", "FAIL", "ABSTAIN"] as const) } : {})
  };
}

{
  const rng = mulberry32(0xe22e03);
  const models = ["m1", "m2", "m3", "m4", "m5"];
  for (let trial = 0; trial < 4000; trial += 1) {
    const seedSignals = Array.from({ length: Math.floor(rng() * 15) }, () => genBanditSignal(rng, models));
    const previous = rng() < 0.3 ? undefined : currentBanditBuild(undefined, seedSignals);
    const signals = Array.from({ length: Math.floor(rng() * 15) }, () => genBanditSignal(rng, models));
    check(
      "S2-E-3 equivalence (no discarded construction)",
      JSON.stringify(currentBanditBuild(previous, signals)) === JSON.stringify(candidateBanditBuild(previous, signals)),
      `trial ${trial}`
    );
  }
  // realistic: M=10 arms previous, S=12 signals
  const benchRng = mulberry32(0xe22e04);
  const models10 = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const prevSeed = Array.from({ length: 30 }, () => genBanditSignal(benchRng, models10));
  const previous = currentBanditBuild(undefined, prevSeed);
  const signals = Array.from({ length: 12 }, () => genBanditSignal(benchRng, models10));
  const cur = bench(() => void currentBanditBuild(previous, signals), 40000);
  const cand = bench(() => void candidateBanditBuild(previous, signals), 40000);
  console.log(
    `S2-E-3 bench M=10 S=12: current=${(cur * 1e6).toFixed(0)}ns cand=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call`
  );
  // S2-E-4 + I/O anchor: one real updateProjectBandit call (file lock + read + write).
  const stateRoot = await mkdtemp(join(tmpdir(), "r2e-bandit-"));
  const fullCall = await benchAsync(async () => {
    await updateProjectBandit(stateRoot, "/tmp/proj-a", signals);
  }, 100);
  console.log(
    `S2-E-3/4 anchor: one full updateProjectBandit (lock+read+build+write)=${(fullCall * 1e3).toFixed(1)}us; in-memory build is ${((cur / fullCall) * 100).toFixed(2)}% of it`
  );
  // S2-E-4: cost of detecting "unchanged" via serialized compare vs the write it would skip.
  const stateJson = `${JSON.stringify(currentBanditBuild(previous, []), null, 2)}\n`;
  const compareCost = bench(() => void (stateJson === stateJson.slice(0)), 40000);
  console.log(
    `S2-E-4 anchor: serialized-compare=${(compareCost * 1e6).toFixed(0)}ns vs full call ${(fullCall * 1e3).toFixed(1)}us (write share is sub-ms once per run)`
  );
}

/* ================================================================
 * S2-E-1 anchor: what one skipped saveAdaptationRegistry is worth on the
 * "identical candidate already proposed" path of proposeAndMaybePromote.
 * Realistic registry: routing-policy baseline + one proposed candidate.
 * ================================================================ */
{
  const stateRoot = await mkdtemp(join(tmpdir(), "r2e-reg-"));
  const registry = await loadAdaptationRegistryOrNew(stateRoot);
  const identity = routingPolicyIdentity("/tmp/proj-a");
  const parent = ensureRoutingBaseline(registry, identity, "premium", "pi-sparkle-auto-loop");
  const policy: LearnedRoutingPolicy = {
    primaryModelId: "premium",
    avoid: [{ modelId: "cheap", family: "edit", reason: "meanScore 0.30 over 6 samples" }],
    prefer: [{ family: "edit", modelId: "premium" }]
  };
  const content = routingPolicyContent(policy);
  registry.createCandidate({
    identity,
    content,
    parentVersionId: parent.versionId,
    author: { kind: "detector", identity: "pi-sparkle-auto-loop" },
    evaluationPlan: { stages: ["static", "replay"], metrics: ["task-success", "cost"], planVersion: 1 }
  });
  void hashCandidateContent(content);
  const saveCost = await benchAsync(async () => {
    await saveAdaptationRegistry(stateRoot, registry);
  }, 60);
  const loadCost = await benchAsync(async () => {
    await loadAdaptationRegistryOrNew(stateRoot);
  }, 60);
  console.log(
    `S2-E-1 anchor: one saveAdaptationRegistry (serialize+fsync+rename)=${(saveCost * 1e3).toFixed(0)}us; the load the path always pays=${(loadCost * 1e3).toFixed(0)}us (skip saves the former once per no-change auto-adapt)`
  );
}

/* ================================================================
 * S2-E-5 candidate: streaming truncate — collapse whitespace while
 * collecting at most 401 output chars, early-exit, instead of running
 * /\s+/g replace over the whole text. Two variants: regex-per-char
 * (parity by construction) and charCode-table (parity verified over
 * every UTF-16 code unit).
 * ================================================================ */
function truncateRef(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 400 ? `${trimmed.slice(0, 397)}...` : trimmed;
}

const WS_RE = /\s/;
function truncateStreamRegex(text: string): string {
  let out = "";
  let pendingSpace = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (WS_RE.test(ch)) {
      if (out !== "") pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      out += " ";
      pendingSpace = false;
    }
    out += ch;
    if (out.length > 400) return `${out.slice(0, 397)}...`;
  }
  return out;
}

const WS_TABLE = new Uint8Array(0x10000);
for (let code = 0; code < 0x10000; code += 1) {
  if (WS_RE.test(String.fromCharCode(code))) WS_TABLE[code] = 1;
}
function truncateStreamTable(text: string): string {
  let out = "";
  let pendingSpace = false;
  for (let i = 0; i < text.length; i += 1) {
    if (WS_TABLE[text.charCodeAt(i)] === 1) {
      if (out !== "") pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      out += " ";
      pendingSpace = false;
    }
    out += text[i];
    if (out.length > 400) return `${out.slice(0, 397)}...`;
  }
  return out;
}

{
  // Table parity with /\s/ over every UTF-16 code unit (all JS whitespace is BMP).
  let parity = true;
  for (let code = 0; code < 0x10000; code += 1) {
    if ((WS_TABLE[code] === 1) !== WS_RE.test(String.fromCharCode(code))) {
      parity = false;
      break;
    }
  }
  check("S2-E-5 WS table parity with /\\s/ over all code units", parity);

  const rng = mulberry32(0xe22e05);
  const atoms = [
    "a", "Z", "9", "错", "誤", "🙂", " ", "\t", "\n", "\r", "\u00a0", "\u2003",
    "\u2028", "\u2029", "\u3000", "\ufeff", "\u200b", "word", "  ", "\n\n\t "
  ];
  for (let trial = 0; trial < 6000; trial += 1) {
    let s = "";
    const n = Math.floor(rng() * 40);
    for (let i = 0; i < n; i += 1) {
      const atom = pick(rng, atoms);
      s += rng() < 0.15 ? atom.repeat(1 + Math.floor(rng() * 40)) : atom;
    }
    const ref = truncateRef(s);
    check("S2-E-5 equivalence (stream regex)", ref === truncateStreamRegex(s), JSON.stringify(s.slice(0, 80)));
    check("S2-E-5 equivalence (stream table)", ref === truncateStreamTable(s), JSON.stringify(s.slice(0, 80)));
  }
  // boundary cases: collapsed length exactly 399/400/401, trailing ws
  for (const len of [399, 400, 401, 402]) {
    const s = `${"ab ".repeat(Math.ceil(len / 3)).slice(0, len)}   \n\t`;
    check(`S2-E-5 boundary len=${len}`, truncateRef(s) === truncateStreamTable(s));
  }
  const realistic = "TASK_RESULT SUCCESS: tests passed after refactoring the retry helper\n  with details";
  const kb5 = Array.from({ length: 120 }, (_, i) => `step ${i} finished ok with output   lines`).join("\n");
  const kb100 = kb5.repeat(20);
  for (const [label, text, reps] of [
    ["realistic 85B", realistic, 100000],
    ["5KB", kb5, 20000],
    ["100KB", kb100, 1000]
  ] as const) {
    const cur = bench(() => void truncateRef(text), reps);
    const cand = bench(() => void truncateStreamTable(text), reps);
    console.log(
      `S2-E-5 bench ${label}: current=${(cur * 1e6).toFixed(0)}ns stream=${(cand * 1e6).toFixed(0)}ns (${(cur / cand).toFixed(2)}x)`
    );
  }
}

/* ================================================================
 * S2-E-6 candidate: optimizedPolicy filter+map fusion into one loop,
 * and applyLearnedRouting avoided-Set built without the two intermediate
 * arrays. Fuzz against verbatim replica / production import.
 * ================================================================ */
function optimizedPolicyRef(
  primaryModelId: string,
  failing: readonly ModelProjectIssue[]
): LearnedRoutingPolicy {
  const avoid: LearnedAvoid[] = failing.map((issue) => ({
    modelId: issue.modelId,
    reason: `meanScore ${issue.meanScore.toFixed(2)} over ${issue.samples} samples`,
    ...(issue.family !== undefined ? { family: issue.family } : {})
  }));
  const prefer: LearnedPrefer[] = failing
    .filter((issue) => issue.family !== undefined)
    .map((issue) => ({ family: issue.family!, modelId: primaryModelId }));
  return { primaryModelId, avoid, prefer };
}
function optimizedPolicyFused(
  primaryModelId: string,
  failing: readonly ModelProjectIssue[]
): LearnedRoutingPolicy {
  const avoid: LearnedAvoid[] = [];
  const prefer: LearnedPrefer[] = [];
  for (const issue of failing) {
    avoid.push({
      modelId: issue.modelId,
      reason: `meanScore ${issue.meanScore.toFixed(2)} over ${issue.samples} samples`,
      ...(issue.family !== undefined ? { family: issue.family } : {})
    });
    if (issue.family !== undefined) prefer.push({ family: issue.family, modelId: primaryModelId });
  }
  return { primaryModelId, avoid, prefer };
}
function applyLearnedRoutingFused(
  family: string,
  catalogIds: readonly string[],
  preferredModel: string,
  learned: LearnedRoutingPolicy
): { allowedModels: readonly string[]; preferredModel: string } {
  const avoided = new Set<string>();
  for (const entry of learned.avoid) {
    if (entry.family === undefined || entry.family === family) avoided.add(entry.modelId);
  }
  const kept = catalogIds.filter((id) => !avoided.has(id));
  const allowedModels = kept.length > 0 ? kept : catalogIds;
  const prefer = learned.prefer.find((entry) => entry.family === family)?.modelId;
  if (prefer !== undefined && allowedModels.includes(prefer)) {
    return { allowedModels, preferredModel: prefer };
  }
  if (allowedModels.includes(preferredModel)) {
    return { allowedModels, preferredModel };
  }
  if (allowedModels.includes(learned.primaryModelId)) {
    return { allowedModels, preferredModel: learned.primaryModelId };
  }
  return { allowedModels, preferredModel: allowedModels[0] ?? preferredModel };
}

{
  const rng = mulberry32(0xe22e06);
  const fams = ["edit", "test", "review", "plan", "research"];
  const genIssue = (): ModelProjectIssue => ({
    projectId: "prj_simsim01" as ProjectId,
    modelId: pick(rng, ["m1", "m2", "m3"]),
    samples: 1 + Math.floor(rng() * 12),
    meanScore: rng(),
    failures: Math.floor(rng() * 6),
    actionable: true,
    kinds: ["deterministic"],
    ...(rng() < 0.7 ? { family: pick(rng, fams) } : {})
  });
  for (let trial = 0; trial < 4000; trial += 1) {
    const failing = Array.from({ length: Math.floor(rng() * 11) }, genIssue);
    check(
      "S2-E-6 equivalence (optimizedPolicy fusion)",
      JSON.stringify(optimizedPolicyRef("premium", failing)) === JSON.stringify(optimizedPolicyFused("premium", failing)),
      `trial ${trial}`
    );
    const catalog = Array.from({ length: 1 + Math.floor(rng() * 10) }, (_, i) => `m${i}`);
    const learned: LearnedRoutingPolicy = {
      primaryModelId: pick(rng, catalog),
      avoid: Array.from({ length: Math.floor(rng() * 10) }, () => ({
        modelId: pick(rng, [...catalog, "mx"]),
        reason: "r",
        ...(rng() < 0.6 ? { family: pick(rng, fams) } : {})
      })),
      prefer: Array.from({ length: Math.floor(rng() * 5) }, () => ({
        family: pick(rng, fams),
        modelId: pick(rng, [...catalog, "mx"])
      }))
    };
    const family = pick(rng, fams);
    const preferred = pick(rng, [...catalog, "mz"]);
    check(
      "S2-E-6 equivalence (applyLearnedRouting no intermediates)",
      JSON.stringify(applyLearnedRouting(family, catalog, preferred, learned)) ===
        JSON.stringify(applyLearnedRoutingFused(family, catalog, preferred, learned)),
      `trial ${trial}`
    );
  }
  const failing3 = Array.from({ length: 3 }, genIssue);
  const failing10 = Array.from({ length: 10 }, genIssue);
  for (const [label, failing] of [["n=3", failing3], ["n=10", failing10]] as const) {
    const cur = bench(() => void optimizedPolicyRef("premium", failing), 100000);
    const cand = bench(() => void optimizedPolicyFused("premium", failing), 100000);
    console.log(
      `S2-E-6 bench optimizedPolicy ${label}: current=${(cur * 1e6).toFixed(0)}ns fused=${(cand * 1e6).toFixed(0)}ns delta=${((cur - cand) * 1e6).toFixed(0)}ns/call`
    );
  }
  const catalog10 = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const learned10: LearnedRoutingPolicy = {
    primaryModelId: "m0",
    avoid: Array.from({ length: 10 }, (_, i) => ({ modelId: `m${i % 5}`, reason: "r", family: fams[i % 5]! })),
    prefer: [{ family: "edit", modelId: "m1" }]
  };
  const curA = bench(() => void applyLearnedRouting("edit", catalog10, "m2", learned10), 100000);
  const candA = bench(() => void applyLearnedRoutingFused("edit", catalog10, "m2", learned10), 100000);
  console.log(
    `S2-E-6 bench applyLearnedRouting avoid=10 M=10: current=${(curA * 1e6).toFixed(0)}ns fused=${(candA * 1e6).toFixed(0)}ns delta=${((curA - candA) * 1e6).toFixed(0)}ns/task`
  );
}

/* ================================================================
 * S2-E-7 anchor: TASK_RESULT binding double copy — the caller-side
 * conditional-spread binding plus copyDefinedBinding's re-copy inside
 * task-success. Upper bound of any fused-single-construction gain.
 * ================================================================ */
{
  const bindingFull: TaskSuccessRouteBinding = {
    modelId: "premium",
    modelVersion: "v1",
    family: "edit",
    featureVersion: "fv1",
    role: "implementer"
  };
  const cur = bench(() => {
    // verbatim caller shape: build binding via conditional spreads, then the
    // production double-copy inside taskSuccessFromResult.
    const binding: TaskSuccessRouteBinding = {
      ...(bindingFull.modelId !== undefined ? { modelId: bindingFull.modelId } : {}),
      ...(bindingFull.modelVersion !== undefined ? { modelVersion: bindingFull.modelVersion } : {}),
      ...(bindingFull.family !== undefined ? { family: bindingFull.family } : {}),
      ...(bindingFull.featureVersion !== undefined ? { featureVersion: bindingFull.featureVersion } : {}),
      ...(bindingFull.role !== undefined ? { role: bindingFull.role } : {})
    };
    void taskSuccessFromResult("SUCCESS", "PASSED", binding);
  }, 100000);
  const cand = bench(() => {
    // fused single construction (would require trusting/duplicating the
    // present() blank-field contract of task-success at the call site)
    void {
      criterion: "taskSuccess",
      outcomeKind: "PASS",
      source: "deterministic",
      modelId: bindingFull.modelId,
      modelVersion: bindingFull.modelVersion,
      family: bindingFull.family,
      featureVersion: bindingFull.featureVersion,
      role: bindingFull.role
    };
  }, 100000);
  console.log(
    `S2-E-7 anchor: binding + double copy=${(cur * 1e6).toFixed(0)}ns fused single construction=${(cand * 1e6).toFixed(0)}ns -> upper bound ${((cur - cand) * 1e6).toFixed(0)}ns per TASK_RESULT event (~10/run)`
  );
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```
