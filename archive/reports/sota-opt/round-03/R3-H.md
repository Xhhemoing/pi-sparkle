MODEL_SLUG=claude-fable-5-thinking-xhigh

# R3-H：`src/evaluation/` + `src/requirement/` + `src/review/` + `src/rubric/` 第三遍扫描报告

**战役:** 全库持久 SOTA 优化 Round 3 / R3-H
**基线:** `cursor/sota-persistent-opt-83a1` @ `ede7021`
**分支:** `cursor/r3-h-eval-third-pass-83a1`
**模型:** `claude-fable-5-thinking-xhigh`

## 结论

**无达门槛的新更优解，切片零代码改动。** 切片 21 个文件（1750 行）自 R1-H
基线（`fd437a9`）以来**逐字节未变**（`git diff fd437a9..ede7021 -- src/{evaluation,
requirement,review,rubric}/` 为空），生产调用方地图经全库交叉检索复核后
**完全不变**（R2-H 基线 `7bf1c15` 以来 `src/` 仅 `routing/offline-logit.ts`
落地 S3-C，一行不触本切片及其调用方）。R2-H §3.4 的收益上界论证继续成立：
切片全部生产入口每 run 合计 <10µs，任何候选的绝对收益上界 ≈10µs/run，比
战役否决线（S1-I-1 ~190µs、S2-H-1 44ns 均已否决）低两个量级。本轮在完整
排除表（S1-H-1..9、S2-H-1..7 及两轮不立 ID 的 13 处收口）之上以第三遍
新角度枚举，得到 4 个此前未点名的新候选（S3-H-1 … S3-H-4），全部经理论 +
确定性仿真（seeded mulberry32，~21,800 项等价检查 + 真实/压力双端基准，
三次独立运行结论逐位一致、计时方向稳定）裁决后淘汰：4 个全部等价，
但收益钉死在 once-per-run 的 34ns–1.1µs 区间。其中最实质的新发现
S3-H-1（生产链双 `validateRequirementContract`）重复份额仅占 once-per-run
调用的 ~3%；S3-H-2 作为 S2-H-3 的保早退变体在压力侧不再负优化，但真实
规模仍是 ~100ns 噪声。未重开任何 X* / S1-* / S2-* / S3-A/B/C/D/E-* 条目。
现状即为 SOTA。

## 0. 范围与约束遵守

- 切片：`src/evaluation/`（8 文件）、`src/requirement/`（7 文件）、
  `src/review/`（4 文件）、`src/rubric/`（2 文件）全量第三遍实际读码。
  上下游 `domain/contract.ts`、`track/{clarify,loop,plan}.ts`、
  `run/{supervisor,coordinator,flowchart-run}.ts` 只读取证，一行未改。
- 先读并遵守（顺序按指令）：README / EXCLUSIONS.md（含 S3-C 已落地与
  S3-A/B/C/D/E 全部条目）/ round-03/PLAN.md / round-01/R1-H.md /
  round-02/R2-H.md。候选枚举刻意绕开全部既有排除，特别核对未触碰：
  S1-H-4 / S1-H-9 / S2-H-4（集合相等与 authorityIndex 发散族）、
  S1-H-8（registerRubric 就地写污染 DEFAULT_REGISTRY）、X4-9
  （classifyDiffScope changeSet Set 化）、S2-H-7（默认 origin 守卫）。
- 硬不变量全部满足：本轮零 diff ⇒ 分析不改 in-flight、Tracking 无命令权、
  H/score 不写路由、live = R0 等价、双 LCB 双归因保留、阈值/权限/数据面
  契约/公开签名不变、测试未改，天然成立。不声称 Outcome-supported，
  Checkpoint F-PROD 仍开放（ADR-005）。

## 1. 基线不变性与调用图复核

1. **切片逐字节未变**：`git diff fd437a9..ede7021 -- src/{evaluation,requirement,review,rubric}/`
   输出为空；`git log` 同范围零提交。R1-H 逐函数下界表、R2-H 上界论证
   与 S1-H-1..9 / S2-H-1..7 排除全部继承有效。
2. **调用方地图不变**（本轮全库 import 检索重做）：
   `assertCoverageAllowsStart` ← `run/{supervisor,coordinator,flowchart-run}.ts`
   （每 run 启动一次，且仅当 `input.contract !== undefined`）；
   `extractHeuristicContract` ← `track/clarify.ts`（每 run 一次，单句
   objective）；`applyPrecedence` ← `track/loop.ts`（每 run 一次）；
   `shouldScout` ← `track/plan.ts`（每 run 一次）；
   `assertCanPromoteFromReview` ← `adaptation/promotion-rules.ts`（每晋升
   一次）；`src/evaluation/` 全部 8 文件、`review/{pairwise,reconcile,critic}.ts`、
   `src/rubric/` 仍**无任何生产调用方**（仅类型导入与测试引用）。
3. R2-H 基线以来 `src/` 唯一变更是 `routing/offline-logit.ts`（S3-C 落地），
   与本切片无 import 关系。

本轮锚点（三次运行区间）：

```text
anchor: one extractHeuristicContract = 4471-6588ns (once per run; slice production peak)
```

## 2. 候选总表（全部淘汰，无赢家落地）

| ID | 候选 | 理论 | 仿真等价 | 真实规模基准 | 裁决 |
| --- | --- | --- | --- | --- | --- |
| S3-H-1 | 生产链双 `validateRequirementContract` 去重：`heuristicExtractor.extract` 对自己刚构造的合同先验证一次（heuristic.ts L87），`buildContractCandidate` 对提取结果**再验证一次**（extractor.ts L80）。候选：删提取器内部验证，让 builder 侧的强制验证成为唯一一道 | 免 1 次 Θ(项数) 校验 + 1 次顶层重建（builder 侧是扩展点 fail-closed 契约不可动，去重只能删 heuristic 侧） | ✅ 800 组无编辑复刻 sanity（逐字节）+ 3000 组 objective×habits 全格 fuzz 逐字节一致；损坏合同定向探针确认 builder 侧验证兜底仍抛同类错 | 重复份额 **134–185ns** = once-per-run 调用的 **2.8–3.0%**；端到端 delta 444/1058/882ns/run（三次方向一致） | 淘汰：亚 µs/run 噪声（低于 S1-I-1 否决线两个量级）；且删的是提取器对**自身未来构造 bug** 的 fail-fast（S2-D-5/S2-H-7 防御纵深类）——收益不抵回归面 |
| S3-H-2 | `critiqueContract` 消除中间小写 `checks` 数组但**保留**双 `some` 早退（S2-H-3 全融合因丢早退在压力侧负优化 1.9–2.6×；本变体专为保早退设计）。代价：第二遍 `some` 对已扫前缀重做 toLowerCase（最坏 2C 次 vs 现行恰 C 次 + 一个数组） | 免 C 次字符串分配 + 1 个中间数组，双早退保留 | ✅ 6000 fuzz + heuristic 形状定向 + 355 准则无命中（最坏 2× toLowerCase 路径）定向逐字节一致 | 真实 C=2 省 **74–131ns**/run（once per run）；355 准则压力：有命中省 4.8–5.6µs、无命中省 2.7–3.4µs（三次方向一致，**未复现 S2-H-3 的负优化**——早退保住后分配削减胜出） | 淘汰：真实规模噪声。压力侧的 µs 级收益发生在超真实两个量级处且仍低于否决线；但本条为 S2-H-3 的重开条件提供了正确变体（见 §3.2） |
| S3-H-3 | `heuristicExtractor` q-tests 补问处子集正则短路：该分支恒有 `habits.requireTests === undefined` ⇒ `wantsTests` 恰等于宽正则 `(tests?\|coverage\|qa)` 结果；窄正则 `(tests?\|coverage)` ⊆ 宽正则 ⇒ `wantsTests === false` 时窄正则可证恒假可跳过 | 免 1 次单句正则扫描（仅非 tests objective 路径） | ✅ 3000 组全格 fuzz + "qa"-only 定向（宽真窄假的唯一分离点）逐字节一致 | 省 **34–45ns**，once per run | 淘汰：深度亚噪声（S1-H-3/S1-A-3 单句正则系列第三例） |
| S3-H-4 | `changeSetsEqual` 引用相等快路径（`a === b` 时集合自反相等，直接 return true） | 别名输入免 2 次 Set 构建 | ✅ 8000 fuzz（25% 别名对 + 含重复元素）+ 公开 CheckAdapter 别名数组探针 PASS parity | 别名调用全成本仅 **73–85ns**，且该面**无生产调用方**、仓内 `result.changeSet` 与 `context.changeSet` 永不别名 | 淘汰：健全但零流量 + ns 级（与 S1-H-9/S2-H-4 不同：本条等价，败在量级；三条合起来钉死该函数全部微优化方向） |

另有四处以既有排除/前轮收口直接覆盖、不立新 ID：`assertCoverageAllowsStart`
无 options 时的空 `resolvedQuestionIds` Set 分配（S1-H-2 同族死分配，
~20ns）；`coverageMatrixFromTasks` 空 tasks 时的 `contractIds` Set（同族，
生产 tasks 恒非空）；`heuristicCritic` 的 `[...critique.omissions]` 拷贝
（`critiqueContract` 恒返回空 omissions，但拷贝是对共享可变数组的防御，
S1-B-5 分配噪声类）；`isVague` 的 `split+filter` 词计数换免分配早退计数
（S1-B-2 同类，单句亚噪声）。第三遍对 21 文件逐一重扫**再未发现任何
未被两轮排除表或上述四处覆盖的结构**。

## 3. 关键裁决细节

### 3.1 S3-H-1：本切片最后一处「纯重复工作」，量级与防御双重钉死

前两轮把死分配（S2-H-1/2）、重复正则（S1-H-3）都点名后，本轮发现的
唯一漏网重复是**整函数级**的：生产链 `extractHeuristicContract` →
`buildContractCandidate` 中同一合同被 `validateRequirementContract`
验证两次——heuristic 构造时一次（自证）、builder 收货时一次（扩展点
契约）。两次调用输入值相同、函数纯 ⇒ 去重逐字节等价（3000 fuzz 证实，
含 vague/named-file/qa/typo/tiny 全分支 × habits 全格）。但裁决双证：
(a) 重复份额 134–185ns，占 once-per-run 调用 ~3%，端到端 delta 亚 µs，
低于战役已否决的最小量级两个数量级；(b) 可删的只有 heuristic 侧——
builder 侧验证是对**任意**提取器实现的 fail-closed 契约——而 heuristic
侧验证恰是提取器对自身构造正确性的 fail-fast（未来有人改坏合同字面量
时错误在源头抛出而非隔一层）。与 S2-H-7「可证恒真守卫不删」同向。

### 3.2 S3-H-2：S2-H-3 教训的正确变体——早退保住后分配削减确实胜出

R2-H 裁决 S2-H-3（四遍全融合）时发现融合丢失双 `some` 早退导致压力侧
慢 1.9–2.6×。本轮构造保早退变体：只消中间 `checks` 数组，双 `some`
直接扫 criteria 并就地 toLowerCase。三次运行压力侧**全部更快**
（有命中 +4.8~5.6µs、无命中最坏路径 +2.7~3.4µs）——证明 S2-H-3 的
负优化根因确是早退丢失而非融合本身，V8 下「省 C 次字符串分配 >
最坏 C 次重复 toLowerCase」在该形状成立。该结论写入 S2-H-3 的重开
条件：若合同规模增长 ≥2 个量级使 `critiqueContract` 变热，应落地
**本变体**而非 S2-H-3 原案。真实规模（C=2，once per run）两者皆为
~100ns 噪声，本轮不落地。

### 3.3 S3-H-4：changeSetsEqual 微优化方向的收口

S1-H-9（长度早退）败于 `a` 侧重复反例，S2-H-4（单 Set delete）败于
`b` 侧重复反例，本条（引用相等快路径）**健全**（自反性不依赖无重复
不变量，8000 fuzz 含别名对与重复元素全等，公开 adapter 别名探针
PASS parity）——但败于量级：全函数 2 文件规模仅 78–93ns，快路径
上界即别名调用全成本 73–85ns，且该面无生产调用方、仓内两个 changeSet
来源不同永不别名。至此该函数「不等价（两例）+ 等价但零收益（一例）」
三面钉死，后续轮次无需再碰。

### 3.4 上界论证维持（第三遍收口）

R1-H 证了逐函数渐近下界，R2-H 证了调用图收益上界 ~10µs/run，本轮证了
两者之间的最后缝隙——重复工作与分配削减——也已枚举穷尽（4 个新候选
全部 <1.1µs/run）。三遍合起来：本切片在当前调用图下**结构上不存在**
可达门槛（数十 ms 或复杂度类下降）的候选。重开该切片的唯一前提仍是
调用图变更：evaluation/review/rubric 面接入每 turn 生产热路径，或合同
规模增长 ≥2 个量级。

## 4. 逐文件收口（第三遍新视角，其余与 R1-H/R2-H 一致）

| 文件 | 本轮新视角检查 | 结论 |
| --- | --- | --- |
| `requirement/heuristic.ts` | 双验证上半段（S3-H-1）；子集正则短路（S3-H-3）；isVague 词计数（不立 ID，S1-B-2 类） | S3-H-1/3 淘汰 |
| `requirement/extractor.ts` | 双验证下半段（builder 侧为契约不可动） | S3-H-1 淘汰 |
| `requirement/critic.ts` | 保早退去数组变体（S2-H-3 正确形） | S3-H-2 淘汰 |
| `evaluation/check-adapter.ts` | 引用相等快路径（该函数微优化方向三面钉死） | S3-H-4 淘汰 |
| `requirement/coverage.ts` | 空 options Set / 空 tasks Set 死分配（S1-H-2/S2-H-1 同族，不立 ID） | 无新候选 |
| `requirement/normalizer.ts` / `provenance.ts` / `precedence.ts` | S2-H-7 守卫维持；单遍即输出；S1-H-5 维持 | 无新候选 |
| `evaluation/evaluator.ts` / `types.ts` / `adapters.ts` / `precedence.ts` | S1-H-7/S2-H-5 维持；纯类型/常量/3 元表 | 无新候选 |
| `evaluation/delivery-adapter.ts` / `diff-adapter.ts` / `ownership.ts` | 分支序为归因契约；X4-9 维持 | 无新候选 |
| `review/pairwise.ts` / `reconcile.ts` / `critic.ts` / `self-review.ts` | 双物质比较为协议本体；S1-H-6 维持；hasPass 融合（test-only）维持；O(1) 谓词 + 死中间对象（V8 逃逸消除） | 无新候选 |
| `rubric/registry.ts` / `types.ts` | S1-H-8 反例 + S2-H-6 维持；Θ(字段) 构造 | 无新候选 |

## 5. 前后对比

无代码 diff。仓库变更仅本报告一个文件。

## 6. 测试

零代码改动下切片相关套件基线复核，全绿（Node 22.22.2 via nvm，满足
engines >=22.19.0；系统 Node 22.14.0 过低的既知环境注记同 R1-J §3）：

```bash
npx tsx --test "test/unit/requirement/*.test.ts" "test/unit/evaluation/*.test.ts" \
  "test/unit/review/*.test.ts" "test/integration/m3/checkpoint-d.test.ts" \
  "test/integration/m3/coverage-gate.test.ts" \
  "test/integration/m3/requirement-extraction.test.ts" \
  "test/integration/m4/delivery-evidence.test.ts"
# tests 93 / suites 13 / pass 93 / fail 0（与 R1-H/R2-H 同套件同计数）
```

仿真（临时脚本 `/tmp/r3h-sim.mts`，无赢家故未入库；完整源码见附录，
seed 固定可复现）代表性一次运行：

```text
S3-H-1 duplicate share: one validateRequirementContract(heuristic contract)=134ns vs one extractHeuristicContract=4471ns (3.0% of a once-per-run call)
S3-H-1 bench full production path: current=4471ns dedup=4027ns delta=444ns/run (once per run)
S3-H-3 saved work when wantsTests=false: one narrow regex scan=34ns (once per run, only on non-tests objectives)
S3-H-2 bench real heuristic contract (C=2): current=598ns cand=524ns delta=74ns/call (once per run via heuristicCritic)
S3-H-2 bench stress with-hits (355 criteria): current=32734ns cand=27983ns delta=4750ns/call
S3-H-2 bench stress no-hits (355 criteria, both scans full = worst case 2x toLowerCase): current=40283ns cand=37550ns delta=2733ns/call
S3-H-4 anchor: one changeSetsEqual (2 files)=78ns; the fast path can at most save the aliased-call cost=73ns, and the face has no production caller

ALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)
```

三次独立运行 ~21,800 项等价检查全部通过、裁决结论逐位一致；计时抖动
内方向稳定（S3-H-1 端到端三次 444/1058/882ns；S3-H-2 压力两路三次
全部候选更快；S3-H-3 三次 34/45/35ns；S3-H-4 三次 73/85/74ns）。

## 7. 新增排除 ID（请并入全局 EXCLUSIONS.md「本战役新增」）

| ID | 方案 | 原因 |
| --- | --- | --- |
| S3-H-1 | heuristic 生产链双 validateRequirementContract 去重（删提取器内部验证） | 等价但重复份额 134–185ns（once-per-run 的 ~3%）；删的是提取器自证 fail-fast（防御纵深） |
| S3-H-2 | critiqueContract 去中间 checks 数组保双 some 早退 | 等价且压力侧稳定更快（S2-H-3 负优化根因确证为丢早退），但真实 C=2 仅省 ~100ns/run，噪声 |
| S3-H-3 | heuristicExtractor q-tests 补问子集正则短路 | 等价但 34–45ns 深度亚噪声（单句正则系列第三例） |
| S3-H-4 | changeSetsEqual 引用相等快路径 | 健全但别名调用全成本仅 ~80ns 且零生产流量；与 S1-H-9/S2-H-4 合并三面钉死该函数 |

重开条件：S3-H-1 需先出现每 turn 生产调用方或撤销 heuristic 侧
fail-fast 的防御职责；S3-H-2 与 S2-H-3 共享重开条件（合同准则规模
≥2 个量级增长），届时应落地本轮保早退变体并两端重测；S3-H-3 若
objective 变多段长文本可与 S1-H-3 一并重开；S3-H-4 需先出现别名
changeSet 的生产调用方。总门槛不变：任何候选须先推翻 R2-H §3.4 /
本报告 §3.4 的 ~10µs/run 收益上界（即调用图出现新热路径）。

## 附录：确定性仿真脚本（完整，可复现）

运行方式：保存为任意 `.mts` 后 `npx tsx <file>`（仓库根目录，依赖已装；
`.mts` 保证 ESM 顶层 await 可用）。seeds：`0x334801`–`0x334806`。

```ts
/**
 * R3-H deterministic equivalence + benchmark simulation (third pass).
 * Adjudicates fresh candidates S3-H-1 .. S3-H-4 against the current
 * implementations in src/{evaluation,requirement,review,rubric}.
 * All candidates are NEW angles not named by EXCLUSIONS.md, R1-H
 * (S1-H-1..9) or R2-H (S2-H-1..7). Seeded PRNG (mulberry32) -> fully
 * reproducible. Seeds: 0x334801 .. 0x334806.
 *
 * Reference = production imports wherever the function is exported;
 * private helpers are replicated verbatim and each candidate differs
 * from the replica ONLY by the candidate edit.
 */
import { performance } from "node:perf_hooks";
import {
  extractHeuristicContract,
  heuristicExtractor,
  heuristicCritic,
  isVague,
  namedTargets,
  shouldScout,
  HEURISTIC_EXTRACTOR_ROLE,
  type HeuristicHabits
} from "/workspace/src/requirement/heuristic.js";
import {
  buildContractCandidate,
  type RequirementExtractor
} from "/workspace/src/requirement/extractor.js";
import { critiqueContract, type ContractCritique } from "/workspace/src/requirement/critic.js";
import { findUnsourcedItems } from "/workspace/src/requirement/provenance.js";
import { createTrustedSource } from "/workspace/src/requirement/normalizer.js";
import { createCheckAdapter } from "/workspace/src/evaluation/check-adapter.js";
import type { AdapterContext, CommandResult } from "/workspace/src/evaluation/adapters.js";
import {
  validateRequirementContract,
  type RequirementContract,
  type SourceRef
} from "/workspace/src/domain/contract.js";
import type { EpisodeId } from "/workspace/src/domain/ids.js";

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

/* ----------------------------------------------------------------
 * Shared fuzz material: objectives spanning every heuristic branch
 * (vague, named files, tests/coverage/qa keywords, typo/tiny/one-line
 * scout-skips, scope-question triggers) and the full habits lattice.
 * ---------------------------------------------------------------- */
const VERBS = ["implement", "fix", "add", "refactor", "investigate", "polish", "update", "rename"];
const TAILS = [
  "the login retry bug in src/auth/session.ts",
  "the parser and keep tests green",
  "coverage reporting for the qa dashboard",
  "a typo in README.md",
  "one-line change in config.json",
  "stuff",
  "the flaky timeout logic across the scheduler and make coverage stay stable",
  "session handling",
  "qa checks",
  "docs/reports/index.md and src/a.ts"
];
function genObjective(rng: () => number): string {
  if (rng() < 0.08) return pick(rng, ["hm", "do it", "fix", "please make it better somehow"]);
  return `${pick(rng, VERBS)} ${pick(rng, TAILS)}`;
}
function genHabits(rng: () => number): HeuristicHabits {
  const tri = (r: number): boolean | undefined => (r < 0.34 ? undefined : r < 0.67 ? true : false);
  const habits: Record<string, boolean> = {};
  const rt = tri(rng());
  const pr = tri(rng());
  const abw = tri(rng());
  if (rt !== undefined) habits.requireTests = rt;
  if (pr !== undefined) habits.preferReview = pr;
  if (abw !== undefined) habits.askBeforeWrite = abw;
  return habits as HeuristicHabits;
}

/* ----------------------------------------------------------------
 * Verbatim replica of heuristicExtractor's extract() body, factored so
 * the two candidate edits (S3-H-1: skip the internal
 * validateRequirementContract; S3-H-3: subset-regex short-circuit on
 * the q-tests follow-up) can each be applied in isolation.
 * ---------------------------------------------------------------- */
const SMALLEST_CHANGE = {
  id: "c-smallest",
  description: "Change only files required by the objective; no drive-by refactors",
  enforceable: false
};
const DEFAULT_NON_GOALS = [
  "Unrelated refactors",
  "Drive-by dependency upgrades",
  "Rewriting files not required by the objective"
];
function shouldAskScopeReplica(objective: string): boolean {
  if (shouldScout(objective)) return false;
  if (namedTargets(objective).length > 0) return false;
  return /\b(implement|fix|add|rename|change|update|refactor)\b/i.test(objective);
}
function replicaExtractor(
  habits: HeuristicHabits,
  edits: { readonly skipInternalValidation?: boolean; readonly subsetRegexShortCircuit?: boolean }
): RequirementExtractor {
  return {
    roleId: HEURISTIC_EXTRACTOR_ROLE,
    async extract(input) {
      const objective = input.objective.trim();
      const vague = isVague(objective);
      const wantsTests = habits.requireTests === true || /\b(tests?|coverage|qa)\b/i.test(objective);
      const wantsReview = habits.preferReview !== false;
      const questions = vague
        ? [
            {
              id: "q-done",
              question: "What does done look like for this work?",
              options: ["ship a code change", "investigation only", "tests and a code change"]
            },
            {
              id: "q-tests",
              question: "Should the plan include running or adding tests?",
              options: ["yes", "no", "only if existing tests fail"]
            }
          ]
        : [];
      const qTestsFollowup = edits.subsetRegexShortCircuit
        ? // S3-H-3 edit: at this site habits.requireTests === undefined, so
          // wantsTests === /\b(tests?|coverage|qa)\b/i.test(objective); the
          // narrower regex (tests?|coverage) is provably false when
          // wantsTests is false, so only test it when wantsTests is true.
          !vague &&
          habits.requireTests === undefined &&
          (!wantsTests || !/\b(tests?|coverage)\b/i.test(objective))
        : !vague && habits.requireTests === undefined && !/\b(tests?|coverage)\b/i.test(objective);
      if (qTestsFollowup) {
        questions.push({
          id: "q-tests",
          question: "Should the plan include running or adding tests?",
          options: ["yes", "no", "only if existing tests fail"]
        });
      }
      if (shouldAskScopeReplica(objective) && !questions.some((question) => question.id === "q-scope")) {
        questions.push({
          id: "q-scope",
          question: "Which files or modules should this change touch?",
          options: ["the files named in the objective", "let scout discover them", "I will paste paths"]
        });
      }
      if (habits.askBeforeWrite === true && !questions.some((question) => question.id === "q-write")) {
        questions.push({
          id: "q-write",
          question: "May the agent write files, or is this investigation only?",
          options: ["write files", "investigation only"]
        });
      }
      const targets = namedTargets(objective);
      const objectiveRefs = input.sources.map((source) => source.ref);
      const rawContract = {
        schemaVersion: 1,
        objective,
        deliverables: [
          {
            id: "d-change",
            description: vague ? "Change set matching the clarified objective" : `Deliver ${objective}`,
            artifactKind: "diff",
            sourceRefs: objectiveRefs
          },
          ...targets.map((path, index) => ({
            id: `d-file-${index + 1}`,
            description: path,
            artifactKind: "file",
            sourceRefs: objectiveRefs
          }))
        ],
        constraints: [
          { ...SMALLEST_CHANGE, assumptionIds: ["a-defaults"] },
          ...(wantsTests
            ? [{ id: "c-tests", description: "Tests must stay green", enforceable: true, sourceRefs: objectiveRefs }]
            : [])
        ],
        nonGoals: DEFAULT_NON_GOALS,
        acceptanceCriteria: [
          {
            id: "ac-objective",
            description: "The stated objective is addressed",
            observableCheck: "run.status is COMPLETED and child TASK_RESULT summaries cover the objective",
            sourceRefs: objectiveRefs
          },
          ...(wantsTests
            ? [
                {
                  id: "ac-tests",
                  description: "Tests ran",
                  observableCheck: "tester child TASK_RESULT verification is PASSED",
                  sourceRefs: objectiveRefs
                }
              ]
            : [])
        ],
        assumptions: [
          {
            id: "a-defaults",
            statement: "The smallest-change constraint is a heuristic default pending user confirmation",
            source: "heuristic-default"
          },
          ...(vague
            ? [{ id: "a-vague", statement: "Objective is underspecified until the user answers", source: "heuristic" }]
            : [])
        ],
        questions,
        authority: [],
        sourceRefs: objectiveRefs
      };
      // S3-H-1 edit: skip the extractor-internal validation and let
      // buildContractCandidate's mandatory validation be the only one.
      const contract = edits.skipInternalValidation
        ? (rawContract as unknown as RequirementContract)
        : validateRequirementContract(rawContract);
      const confidence = vague ? 0.55 : wantsReview ? 0.86 : 0.8;
      return {
        contract,
        confidence,
        inferences: [],
        authorityGrounding: []
      };
    }
  };
}

async function buildVia(extractor: RequirementExtractor, objective: string): Promise<string> {
  const candidate = await buildContractCandidate({
    objective,
    sources: [
      createTrustedSource({ kind: "message", ref: "cli-objective", origin: "user-turn", content: objective })
    ],
    extractor,
    critic: heuristicCritic(),
    minimumConfidence: 0.8
  });
  return JSON.stringify(candidate);
}

/* ================================================================
 * Replica-vs-production sanity gate: with NO edits the replica must be
 * bit-identical to extractHeuristicContract on every fuzz case, so any
 * later divergence is attributable to the candidate edit alone.
 * ================================================================ */
{
  const rng = mulberry32(0x334801);
  for (let trial = 0; trial < 800; trial += 1) {
    const objective = genObjective(rng);
    const habits = genHabits(rng);
    const ref = JSON.stringify(await extractHeuristicContract({ objective, habits }));
    const rep = await buildVia(replicaExtractor(habits, {}), objective);
    check("replica sanity (no edits, bit-identical)", ref === rep, `objective="${objective}"`);
  }
}

/* ================================================================
 * S3-H-1: production-path double validateRequirementContract — the
 * heuristic extractor validates the contract it just built, then
 * buildContractCandidate validates the extractor output again. Dedup =
 * drop the extractor-internal call (the builder-side one is the
 * fail-closed extension-point contract and cannot move).
 * ================================================================ */
{
  const rng = mulberry32(0x334802);
  for (let trial = 0; trial < 3000; trial += 1) {
    const objective = genObjective(rng);
    const habits = genHabits(rng);
    const ref = JSON.stringify(await extractHeuristicContract({ objective, habits }));
    const cand = await buildVia(replicaExtractor(habits, { skipInternalValidation: true }), objective);
    check("S3-H-1 equivalence (single validation)", ref === cand, `objective="${objective}"`);
  }
  // Defence-in-depth probe: an (hypothetically) broken heuristic construction
  // is still caught — by the builder-side validation instead of the internal
  // one — with the identical error, so the dedup only removes redundancy for
  // the CURRENT construction; it removes the extractor's own fail-fast for
  // future construction bugs (S2-D-5/S2-H-7 defence class).
  const brokenExtractor: RequirementExtractor = {
    roleId: HEURISTIC_EXTRACTOR_ROLE,
    async extract() {
      return {
        contract: { schemaVersion: 1, objective: "" } as unknown as RequirementContract,
        confidence: 0.8,
        inferences: [],
        authorityGrounding: []
      };
    }
  };
  let builderCaught = "";
  try {
    await buildVia(brokenExtractor, "broken");
  } catch (error) {
    builderCaught = (error as Error).message;
  }
  check("S3-H-1 builder-side validation still catches broken contracts", builderCaught.includes("objective"));
  // Cost isolation: one validateRequirementContract on the real heuristic
  // contract shape (the duplicate share), vs one full extraction.
  const prod = await extractHeuristicContract({
    objective: "fix the login retry bug in src/auth/session.ts and keep tests green"
  });
  const validated = prod.contract;
  const dupCost = bench(() => void validateRequirementContract(validated), 100000);
  const full = await benchAsync(async () => {
    await extractHeuristicContract({
      objective: "fix the login retry bug in src/auth/session.ts and keep tests green"
    });
  }, 3000);
  // End-to-end: production path vs dedup path.
  const objective = "fix the login retry bug in src/auth/session.ts and keep tests green";
  const candExtractorFactory = () => replicaExtractor({}, { skipInternalValidation: true });
  const candFull = await benchAsync(async () => {
    await buildContractCandidate({
      objective,
      sources: [
        createTrustedSource({ kind: "message", ref: "cli-objective", origin: "user-turn", content: objective })
      ],
      extractor: candExtractorFactory(),
      critic: heuristicCritic(),
      minimumConfidence: 0.8
    });
  }, 3000);
  console.log(
    `S3-H-1 duplicate share: one validateRequirementContract(heuristic contract)=${(dupCost * 1e6).toFixed(0)}ns vs one extractHeuristicContract=${(full * 1e6).toFixed(0)}ns (${((dupCost / full) * 100).toFixed(1)}% of a once-per-run call)`
  );
  console.log(
    `S3-H-1 bench full production path: current=${(full * 1e6).toFixed(0)}ns dedup=${(candFull * 1e6).toFixed(0)}ns delta=${((full - candFull) * 1e6).toFixed(0)}ns/run (once per run)`
  );
}

/* ================================================================
 * S3-H-3: q-tests follow-up subset-regex short-circuit. At that site
 * habits.requireTests === undefined, so wantsTests is exactly the wide
 * regex result; the narrow regex (tests?|coverage) ⊆ wide regex
 * (tests?|coverage|qa) is provably false whenever wantsTests is false.
 * ================================================================ */
{
  const rng = mulberry32(0x334803);
  for (let trial = 0; trial < 3000; trial += 1) {
    const objective = genObjective(rng);
    const habits = genHabits(rng);
    const ref = JSON.stringify(await extractHeuristicContract({ objective, habits }));
    const cand = await buildVia(replicaExtractor(habits, { subsetRegexShortCircuit: true }), objective);
    check("S3-H-3 equivalence (subset-regex short-circuit)", ref === cand, `objective="${objective}"`);
  }
  // Directed: the "qa"-only objective exercises the one case where the wide
  // regex matched but the narrow one must still be evaluated (and fails).
  for (const objective of [
    "polish qa checks",
    "investigate the qa dashboard flow now",
    "fix session handling",
    "add coverage reporting for the qa dashboard"
  ]) {
    const ref = JSON.stringify(await extractHeuristicContract({ objective }));
    const cand = await buildVia(replicaExtractor({}, { subsetRegexShortCircuit: true }), objective);
    check("S3-H-3 directed qa/no-tests parity", ref === cand, `objective="${objective}"`);
  }
  // Cost isolation: one narrow-regex scan on a short objective.
  const objective = "fix session handling in the scheduler module";
  const narrowCost = bench(() => void /\b(tests?|coverage)\b/i.test(objective), 200000);
  console.log(
    `S3-H-3 saved work when wantsTests=false: one narrow regex scan=${(narrowCost * 1e6).toFixed(0)}ns (once per run, only on non-tests objectives)`
  );
}

/* ================================================================
 * S3-H-2: critiqueContract — drop the intermediate lowercase `checks`
 * array while KEEPING the two early-exiting `some` scans (the S2-H-3
 * full fusion lost its early exit and regressed at scale; this variant
 * preserves it). Trade: worst case re-lowercases scanned prefixes in
 * the second scan (up to 2C toLowerCase vs exactly C + one array).
 * ================================================================ */
function candidateCritiqueNoArray(contract: RequirementContract): ContractCritique {
  const contradictions: string[] = [];
  const untestable: string[] = [];
  const scopeCreep: string[] = [];
  const missingSources: string[] = [];
  const omissions: string[] = [];

  for (const c of contract.acceptanceCriteria) {
    if (!c.observableCheck || c.observableCheck === "manual-or-test") {
      untestable.push(c.id);
    }
  }

  // S3-H-2 edit: no intermediate array; both scans keep their early exit.
  if (
    contract.acceptanceCriteria.some((c) => {
      const lower = c.observableCheck.toLowerCase();
      return lower.includes("fast") || lower.includes("< 10ms");
    }) &&
    contract.acceptanceCriteria.some((c) => {
      const lower = c.observableCheck.toLowerCase();
      return lower.includes("slow") || lower.includes("> 1000ms");
    })
  ) {
    contradictions.push("contradictory-latency");
  }

  if (contract.deliverables.length > 20) scopeCreep.push("too-many-deliverables");
  if (contract.sourceRefs.length === 0) missingSources.push("no-sources");

  const unsourced = findUnsourcedItems(contract);
  for (const id of unsourced.deliverables) missingSources.push(`deliverable:${id}`);
  for (const id of unsourced.constraints) missingSources.push(`constraint:${id}`);
  for (const id of unsourced.acceptanceCriteria) missingSources.push(`criterion:${id}`);

  const score =
    100 -
    (contradictions.length * 15 + untestable.length * 10 + scopeCreep.length * 15 + missingSources.length * 20);
  return { contradictions, untestable, scopeCreep, missingSources, omissions, score: Math.max(0, score) };
}

function genCritiqueContract(rng: () => number, scale: number): RequirementContract {
  const checkPool = [
    "runs fast",
    "must be slow to warm up",
    "latency < 10ms",
    "latency > 1000ms",
    "manual-or-test",
    "",
    "run the suite"
  ];
  const count = Math.floor(rng() * 6 * scale);
  const sourced = () =>
    rng() < 0.7 ? { sourceRefs: [{ kind: "message", ref: "src-0" } as SourceRef] } : {};
  return {
    schemaVersion: 1,
    objective: "o",
    deliverables: Array.from({ length: Math.floor(rng() * (rng() < 0.06 ? 25 : 4)) }, (_, i) => ({
      id: `d-${i}`,
      description: "d",
      artifactKind: "diff",
      ...sourced()
    })),
    constraints: Array.from({ length: Math.floor(rng() * 3) }, (_, i) => ({
      id: `c-${i}`,
      description: "c",
      enforceable: true,
      ...sourced()
    })),
    nonGoals: [],
    acceptanceCriteria: Array.from({ length: count }, (_, i) => ({
      id: `ac-${i}`,
      description: "d",
      observableCheck: pick(rng, checkPool),
      ...sourced()
    })),
    assumptions: rng() < 0.4 ? [{ id: "a-1", statement: "s", source: "src" }] : [],
    questions: [],
    authority: [],
    sourceRefs: rng() < 0.85 ? [{ kind: "message", ref: "src-0" }] : []
  } as unknown as RequirementContract;
}

{
  const rng = mulberry32(0x334804);
  for (let trial = 0; trial < 6000; trial += 1) {
    const contract = genCritiqueContract(rng, 1);
    check(
      "S3-H-2 equivalence (no intermediate array, early exits kept)",
      JSON.stringify(critiqueContract(contract)) === JSON.stringify(candidateCritiqueNoArray(contract)),
      JSON.stringify(contract.acceptanceCriteria.map((c) => c.observableCheck))
    );
  }
  // Real scale: the heuristic-shaped contract (C=2, long check strings).
  const prod = await extractHeuristicContract({
    objective: "fix the login retry bug in src/auth/session.ts and keep tests green"
  });
  const real = prod.contract;
  check(
    "S3-H-2 heuristic-shaped equivalence",
    JSON.stringify(critiqueContract(real)) === JSON.stringify(candidateCritiqueNoArray(real))
  );
  const curReal = bench(() => critiqueContract(real), 50000);
  const candReal = bench(() => candidateCritiqueNoArray(real), 50000);
  console.log(
    `S3-H-2 bench real heuristic contract (C=${real.acceptanceCriteria.length}): current=${(curReal * 1e6).toFixed(0)}ns cand=${(candReal * 1e6).toFixed(0)}ns delta=${((curReal - candReal) * 1e6).toFixed(0)}ns/call (once per run via heuristicCritic)`
  );
  // Stress both directions (the S2-H-3 lesson): with hits (early exits fire,
  // second scan re-lowercases a prefix) and without hits (both scans full).
  const stressHit = genCritiqueContract(mulberry32(0x334805), 100);
  const curHit = bench(() => critiqueContract(stressHit), 500);
  const candHit = bench(() => candidateCritiqueNoArray(stressHit), 500);
  console.log(
    `S3-H-2 bench stress with-hits (${stressHit.acceptanceCriteria.length} criteria): current=${(curHit * 1e6).toFixed(0)}ns cand=${(candHit * 1e6).toFixed(0)}ns delta=${((curHit - candHit) * 1e6).toFixed(0)}ns/call`
  );
  const stressMiss = {
    ...stressHit,
    acceptanceCriteria: stressHit.acceptanceCriteria.map((c, i) => ({
      ...c,
      observableCheck: `run the suite number ${i}`
    }))
  } as RequirementContract;
  check(
    "S3-H-2 stress-miss equivalence",
    JSON.stringify(critiqueContract(stressMiss)) === JSON.stringify(candidateCritiqueNoArray(stressMiss))
  );
  const curMiss = bench(() => critiqueContract(stressMiss), 500);
  const candMiss = bench(() => candidateCritiqueNoArray(stressMiss), 500);
  console.log(
    `S3-H-2 bench stress no-hits (${stressMiss.acceptanceCriteria.length} criteria, both scans full = worst case 2x toLowerCase): current=${(curMiss * 1e6).toFixed(0)}ns cand=${(candMiss * 1e6).toFixed(0)}ns delta=${((curMiss - candMiss) * 1e6).toFixed(0)}ns/call`
  );
}

/* ================================================================
 * S3-H-4: changeSetsEqual — reference-equality fast path (a === b
 * implies set-equal reflexively). Sound for any input; only helps a
 * caller that aliases the two arrays; the face has no production
 * caller and CommandResult.changeSet never aliases context.changeSet
 * in-repo.
 * ================================================================ */
function referenceChangeSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}
function candidateRefEqFastPath(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true; // S3-H-4 edit
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}
{
  const rng = mulberry32(0x334806);
  const pool = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
  for (let trial = 0; trial < 8000; trial += 1) {
    const gen = () => {
      const base = pool.filter(() => rng() < 0.6);
      if (base.length > 0 && rng() < 0.3) base.push(pick(rng, base));
      return base;
    };
    const a = gen();
    const b = rng() < 0.25 ? a : gen(); // include aliased pairs
    check(
      "S3-H-4 equivalence (ref-eq fast path)",
      referenceChangeSetsEqual(a, b) === candidateRefEqFastPath(a, b),
      JSON.stringify({ a, b, aliased: a === b })
    );
  }
  // Public-adapter probe with an aliased array: both must PASS.
  const adapter = createCheckAdapter();
  const shared = ["a.ts", "b.ts"];
  const context: AdapterContext = {
    episodeId: "ep_00000001" as EpisodeId,
    workingDirectory: "/w",
    revision: "rev-1",
    changeSet: shared
  };
  const result: CommandResult = {
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    durationMs: 5,
    command: "pnpm test",
    cwd: "/w",
    changeSet: shared
  };
  const evaluation = await adapter.evaluate(context, result);
  check("S3-H-4 aliased-array adapter parity", evaluation.outcome === "PASS" && candidateRefEqFastPath(shared, shared));
  const cur = bench(() => void referenceChangeSetsEqual(shared, ["a.ts", "b.ts"]), 200000);
  const aliasedGain = bench(() => void referenceChangeSetsEqual(shared, shared), 200000);
  console.log(
    `S3-H-4 anchor: one changeSetsEqual (2 files)=${(cur * 1e6).toFixed(0)}ns; the fast path can at most save the aliased-call cost=${(aliasedGain * 1e6).toFixed(0)}ns, and the face has no production caller`
  );
}

if (failures > 0) {
  console.error(`\n${failures} equivalence check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL EQUIVALENCE CHECKS PASSED (deterministic, seeded)");
```

MORE_OPTIMA=no
BRANCH=cursor/r3-h-eval-third-pass-83a1
