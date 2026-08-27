# 我怎么才能做到自适应？—— 操作者手册 — 2026-08-24

- **模型 slug：** `claude-opus-5-thinking-high-fast`
- **工作分支：** `cursor/how-to-adapt-guide-f31b`（自 `main` @ `eb48a31`）
- **对照的 git tip：** `origin/cursor/algorithm-goal-polish-f31b` @ `c2ae225`
  （Phase-3 的 P0-1/P0-2/P0-3 + P1-2/P1-3/P1-5，**尚未合进 `main`**；
  `main` 是它的严格祖先，两者相差 30 个 commit）
- **权威依据：** ADR-004、ADR-005、
  [model-routing-final-plan.md](../research/model-routing-final-plan.md)、
  [adaptive-agent-work-loop.md](../specs/adaptive-agent-work-loop.md)、
  [m0-m2-architecture.md](../specs/m0-m2-architecture.md)、
  [status-matrix.md](../status-matrix.md)、Phase-1b/2/3 三份报告。
- **不是：** Outcome-supported 声称。本文所有本地数字来自 fake executor，
  Checkpoint F-PROD 保持打开。未改任何 `*-9035` 分支。

本文里标 **[已实测]** 的行为都是本轮在这台机器上跑出来的（两棵树各跑一遍：
`main` @ `eb48a31` 与 polish tip @ `c2ae225`，Node v22.14.0，pnpm 10.17.1，
每个场景独立 `--state-root`）。

---

## 0. 一句话回答

在 pi-sparkle 里「自适应」**不是模型在运行中改自己**，而是一条你手动闭合的控制回路：

```text
带路由的运行 → 结构化信号 → 归因诊断 → 候选提案 → 离线对照评估 → 你人工 CAS 晋升 → 下一次 assign 生效
                                                                              ↘ 出问题 → rollback
```

你今天能立刻做的是把这条回路**跑通并观察**；你今天**做不到**的是让它凭 fake
数据自己产出候选——那需要真 provider 产生真实的确定性 FAIL。下面是每一格的
具体入口、开关、以及做了也没用的事。

---

## 1. 自适应在本产品里的准确定义

### 1.1 两个平面，一个方向

ADR-004 把系统切成两个权限域，`docs/specs/m0-m2-architecture.md` 用运行时语言
重述了同一条边界：

| 平面 | 内容 | 能不能改活跃策略 |
|---|---|---|
| **执行平面**（M0–M2.5 运行时 CLI） | `run` / `inspect` / `resume` / `--flowchart` / `--children` / `--track`，事件日志、checkpoint、flowchart supervisor | **不能**。一次 live run 执行的是不可变的 resource version |
| **适应平面**（M3–M6 适应库） | 证据消费、诊断、候选、replay/holdout/shadow 评估、CAS 晋升与回滚 | 只有 `adapt promote --approve` 能改，而且是 compare-and-swap |

代码层面这条边界是可验证的，不是口号：

- `saveLearnedRouting()`（`src/learning/learned-routing.ts`）**直接抛异常**，
  拒绝把 `routing.json` 当 live 策略存储；
- `loadLearnedRouting()` 只读适应注册表的 **active version 指针**，
  并校验 `hashCandidateContent(content) === version.contentHash`，不匹配就 fail-closed；
- `runAutoAdaptLoop()` 的 `autoPromote` 参数**被忽略**（注释与实现一致），
  永远不 CAS；
- 默认审批档 `createDefaultApprovalProfile()` 的 `autoPromoteClasses: []`、
  `budget.maxAutoPromotions: 0`，`canAutoPromote()` 在空列表下恒为 false。

### 1.2 五个阶段各自的代码落点

| 阶段 | 入口 | 关键约束 |
|---|---|---|
| **收集** | `collectSignalsFromEvents()`（`src/learning/signals.ts`）→ `persistSignals()` → `<state-root>/adaptation/feedback/records.jsonl` | 用户回答只写 `criterion: userAcceptance`；`parseObservedSignal` 拒绝 `source: user` / `kind: human` 伪造 `taskSuccess` |
| **归因** | `outcomesFromRoutedRun()`（`src/learning/from-episode.ts`）+ `observationsForR1()`（`src/routing/outcomes.ts`） | 只收 `criterion === taskSuccess ∧ source === deterministic-check ∧ PASS/FAIL`；FAIL 还必须 `failureClass === "model"` |
| **诊断** | `diagnoseModelProjectIssues()`（`src/learning/diagnostics.ts`） | `actionable` 需要 `samples >= 5 ∧ meanScore < 0.45 ∧ kinds 含 deterministic 且不含 human` |
| **提案** | `runAutoAdaptLoop()`（`--track`/`--children` 之后自动）或 `adapt learn --run` | 写 `cnd_...` 候选到注册表；**不动 active 指针** |
| **评估** | `evalRoutingPolicy()`（`adapt eval`） | `evidenceClass: "replay"`；报告工件带 `qualityEvidence: "none-by-construction"` |
| **晋升 / 回滚** | `promoteWithRegistry()` / `rollbackActive()`（`adapt promote --approve` / `adapt rollback`） | CAS + 独立评审出处 + routing-policy 强制 `--eval-file` |
| **生效** | `loadLearnedRouting()` → `applyLearnedRouting()`（在 `assignTasks` 内） | 只在下一次带路由的运行的 **assign 阶段** 生效 |

### 1.3 "适应"能达到什么等级

ADR-004 的四级词表：`Present` → `Wired` → `Exercised` → `Outcome-supported`。
`docs/status-matrix.md` 里**没有任何一行**是 Outcome-supported，包括适应回路本身。
所以：你能做到"这条回路跑通并且可审计"，做不到"这条回路被证明有用"。后者需要
Checkpoint F-PROD（见 §5）。

---

## 2. 现在就能做的最短路径

前置：Node ≥ 22.19.0（本机 22.14.0，pnpm 每次都警告 `Unsupported engine`，
本轮没有因此失败，但任何结果都不算对声明版本的证据）；`pnpm install`。

### 2.1 第一条命令：让路由和适应真的发生

```bash
# 用一个独立 state-root。不要把实验数据混进 ~/.pi-sparkle
export SR=/tmp/pi-sparkle-adapt

pnpm cli run \
  --project /path/to/proj \
  --objective "Fix the login bug in login.js so empty usernames are rejected" \
  --track --assume-defaults \
  --state-root "$SR"
```

**[已实测]** 输出（`main` @ `eb48a31`）：

```text
Run run_ea56...: COMPLETED
  routing (primary=premium, fast=cheap):
    tsk_2a42... (planner, MEDIUM) -> premium
    tsk_50b2... (scout, LOW)      -> cheap
    tsk_fade... (implementer, MEDIUM) -> cheap
    tsk_f4ad... (reviewer, MEDIUM)    -> cheap
  learn: no actionable model-project issue
  events: 35 -> .../runtime/runs/<runId>/events.jsonl
```

`learn:` 那一行就是自动适应回路的回执。它出现，说明 collect + diagnose +
propose 走完了；`no actionable model-project issue` 说明**没有**够格的候选（见 §4.2）。

### 2.2 看当前适应平面的状态

```bash
pnpm cli adapt status --state-root "$SR"
```

**[已实测]** 它逐条打印自己的边界，最后一行是候选清单：

```text
Adaptation plane is proposal-first (ADR-004).
  live runs execute immutable resource versions; they cannot rewrite policy.
  R0-equivalent static routing is live (flowchart ModelRouter + --track/--children assign).
  R1/bandit remain shadow-only until Checkpoint F holdout policy is approved.
  adapt auto never CAS-promotes; SPARKLE_AUTO_ADAPT=0 still collects. Use adapt promote --approve.
  proposed candidates: 0 (no registry yet; run --track or adapt learn)
```

polish tip 上多一行诚实说明：
`adapt eval replays frozen episodes for cost and action-diff evidence only;
qualityEvidence is none-by-construction (utilityDelta 0)`。

### 2.3 从一次已结束的 run 里显式提案

```bash
pnpm cli adapt learn --run <runId> --state-root "$SR"
# 或者对整个项目重跑收集 + 提案（不 CAS）
pnpm cli adapt auto --run <runId> --project /path/to/proj --state-root "$SR"
```

**[已实测]** fake executor 下永远打印 `no bound taskSuccess outcomes`——这是
正确行为，不是 bug（§4.2）。

### 2.4 拿到候选之后：评估 → 晋升 → 验证 → 回滚

`adapt eval` 需要一份**冻结的 replay 数据集目录**，里面一个
`manifest.json`（`src/adaptation/eval-routing.ts` 的 `parseEpisode` 是权威 schema）：

```json
{
  "datasetId": "ds-2026-08-24",
  "environmentVersion": "env-1",
  "episodes": [
    { "episodeHash": "eh-1", "taskId": "tsk_edit01", "role": "implementer",
      "objective": "Implement the cache layer", "taskFamily": "edit",
      "taskSuccess": "PASS", "originalWorkspace": "/frozen/ws-1" },
    { "episodeHash": "eh-2", "taskId": "tsk_edit02", "role": "implementer",
      "objective": "Implement the cache layer", "taskFamily": "edit",
      "taskSuccess": "FAIL", "originalWorkspace": "/frozen/ws-1" }
  ]
}
```

`originalWorkspace` 会被 `createIsolationGuard` 检查：输出目录
（`<state-root>/adaptation/evals`）不得与它重叠，否则直接拒绝。

```bash
pnpm cli adapt eval --candidate cnd_xxx --dataset /path/to/dataset --state-root "$SR"
```

polish tip 的输出会同时打印报告路径、`quality evidence: none-by-construction`、
`action diff: N episode(s) route to a different model`，以及成本上界为正时的警告。

晋升需要**两个文件**。评审文件（`parsePromotionReview` + `assertCanPromoteFromReview`）：

```json
{
  "reviewId": "review-cnd_xxx",
  "candidateId": "cnd_xxx",
  "contentHash": "<hashCandidateContent(候选内容)>",
  "verdict": "approved",
  "reviewerKind": "independent",
  "reviewerId": "human:reviewer",
  "actorId": "roy",
  "evidenceRefs": ["manual-review"]
}
```

`reviewerKind: "self"` 或 `reviewerId === actorId` 会被 fail-closed 拒绝；
`evidenceRefs` 不能为空。

```bash
pnpm cli adapt promote \
  --candidate cnd_xxx \
  --expected  rsv_<当前 active 版本> \
  --content-file  policy.json \
  --review-file   review.json \
  --eval-file     "$SR/adaptation/evals/cnd_xxx.<cacheKey>.json" \
  --approve \
  --approved-by roy \
  --state-root "$SR"
```

`routing-policy` 类型缺 `--eval-file` 直接拒绝（`assertRoutingPolicyEvalReport`）；
`--approve` 缺失时打印 `refusing to mutate live policy; promotion is
compare-and-swap after explicit approval (M6-T5)`。

验证生效：**用同一个 objective 和同一个 state-root 再跑一次 §2.1**，
`routing (...)` 那几行的模型应该变了。不满意：

```bash
pnpm cli adapt rollback \
  --expected rsv_<新版本> --target rsv_<旧版本> \
  --reason degradation --state-root "$SR"
```

`--reason` 只接受 `guardrail | degradation | user`；`guardrail` 会被记成
automatic 回滚。

### 2.5 什么时候用 `--executor pi`

**当你需要真实的 taskSuccess FAIL 时——也就是任何时候你真想产出候选。**

```bash
pnpm cli models set-default <provider>/<model>     # 或 pi-sparkle auth login <provider> --key ...
pnpm cli run --project /path/to/proj --objective "..." \
  --track --executor pi --primary-model <provider>/<model> \
  --state-root /tmp/pi-sparkle-real     # 关键：与 fake 实验分开
```

`--executor pi` 需要 Node ≥ 22.19.0、凭据、网络（status-matrix 那一行是
`opt-in PI_SMOKE=1`）。**必须用与 fake 实验不同的 state-root**：
`calibrateCatalogFromState` 会读 `runtime/invocations.jsonl` 校准成本目录，
`adaptation/feedback/records.jsonl` 会混入 fake 分数。

---

## 3. 适应真正生效的条件

### 3.1 路由必须先发生

`--children` / `--track` / `--flowchart` 编译进**同一个 flowchart 引擎**
（`compileChildrenToFlowchart` → `startFlowchartRun`），三者互斥，因为它们
占用同一个编译入口。**不带这三个旗标之一的 `run` 完全不路由。**

**[已实测]** plain `run`：12 条事件，0 条 `MODEL_ROUTED`，0 条适应事件。
在 polish tip 上会多一行 stderr：
`note: routing and tracking are off without --track, --children, or --flowchart`；
在 `main` 上**什么都不说**。

### 3.2 哪些事件会变成信号

`collectSignalsFromEvents` 只吃四类：

| 事件 | 产出 | criterion |
|---|---|---|
| `CHILD_MESSAGE` / `TASK_RESULT` | 分数由 `scoreTaskResult(outcome, verification)` 给（PASSED→90，FAILED→15，CANCELLED→25，PARTIAL→50，UNOBSERVED→45） | 只有走 `taskSuccessFromResult` 的确定性适配器才写 `taskSuccess` |
| `CHILD_MESSAGE` / `PEER_MESSAGE` | 25 或 65 | `policyCompliance` |
| `USER_ANSWER` | 关键词命中才计分（10/90），否则丢弃 | `userAcceptance`，**永不绑定最后一个路由模型** |
| `JUDGE_DECISION` | 85/20/50 | `policyCompliance` |
| `RUN_FAILED` | 10 | 无 criterion |

跟踪分（tracking `score`）**永远不进** avoid、bandit reward 或 R1（ADR-005 决策 5）。

### 3.3 哪些观测能更新路由后验

`observationsForR1()` 是唯一的闸门：

```text
criterion === "taskSuccess"
  ∧ outcome ∈ {PASS, FAIL}
  ∧ source === "deterministic-check"
  ∧ (outcome === "FAIL" → failureClass === "model")
```

`failureClass` 由 `classifyTaskFailure()` 判：合同遗漏 → `contract`，
`EACCES/ENOENT/network` → `environment`，`tool error/spawn` → `tool`，
超时/协议违规 → `run`。**这四类都不会降模型后验。** 只有 `verificationKind ===
"FAILED"` 且没命中上述提示词时才落到 `model`。

另外 `isCompleteRoute()` 要求 `MODEL_ROUTED` 同时带
`family` + `featureVersion` + `modelVersion` + `agentRole`，缺一条就不建观测。
这是 F2 的 fail-closed 语义：**宁可没有观测，也不发明 `unknown`/`worker`。**

### 3.4 routing-policy 怎么进入下一次 live assign

只有一条路径：

```text
registry 的 active version 指针
  → loadLearnedRouting(stateRoot, projectRoot)   # 校验 contentHash
  → assignTasks({ ..., learned })
  → applyLearnedRouting(family, catalogIds, preferredModel, learned)
      · avoid[]  : 按 family 过滤掉模型（全被过滤掉时回退整个目录，不 fail-open 到空）
      · prefer[] : family → modelId，命中且仍在 allowedModels 时改 preferredModel
  → router.route(...) 硬过滤 + 排序
```

作用域是 `stableProjectKey(projectRoot)` 哈希出的 **project 级** 身份
（`routing-policy / smart-assign / prj_p<hash>`）。换项目路径 = 换策略。

**[已实测]** 没有已晋升候选时 `loadLearnedRouting` 返回 `undefined`，
同一 state-root 连跑三次 `--track` 路由字节级一致。

### 3.5 开关清单

| 开关 | 位置 | 语义 |
|---|---|---|
| `--track` / `--children` / `--flowchart` | `run` | 唯一的路由/跟踪/适应开关；互斥 |
| `--state-root <dir>` | 全部命令 | 默认 `~/.pi-sparkle`。事实上的实验隔离边界 |
| `--primary-model` / `--fast-model` | `run` | 目录里的 primary/cheap 两档；`--primary-model` 是硬约束，记为 `constraint.preferred` 而不是质量分 |
| `--privacy local\|cloud-approved\|cloud-general` | `run`（**仅 polish tip**） | 显式隐私类；**禁止从 prose 推断** |
| `--require-capability <name>` | `run`（**仅 polish tip**，可重复） | 显式能力要求，同上 |
| `--public-prior <file>` / `--require-public-prior` | `run` | 加载哈希冻结快照。默认 fail-soft：文件缺失/哈希失败只打一行 stderr 并退回今天的 R0 |
| `--assume-defaults` | `run --track` | 只填澄清问题与决策门默认值；**不豁免高风险人工门**（polish 定版） |
| `SPARKLE_AUTO_ADAPT=0` | 环境变量 | 关掉"提案"，**仍然收集**（`isAutoAdaptEnabled`） |
| `--ingest-pi-runs` | `adapt auto`（**仅 polish tip**） | sidecar `.pi/subagents/runs` 摄入，**默认关**。polish 还保证 sidecar 记录不会被打上当前 episodeId |

sidecar 的差异值得单独强调：在 `main` 上，`runAutoAdaptLoop` 默认就去读
`<project>/.pi/subagents/runs`，别的工具留下的运行记录会**静默**变成本 episode 的
反馈；polish tip 把它改成显式 opt-in。这条对"我的信号从哪来"是决定性的。

---

## 4. 做了也不会自适应的坑

### 4.1 不带 `--track` 就什么都没有

**[已实测]** 12 事件 / 0 `MODEL_ROUTED` / 0 适应。`main` 上零提示。
这是 Phase-1b 异常 #9，polish 的 P1-5 修了提示但没改行为。

### 4.2 fake executor 永远产不出候选

链条是这样断的（每一环都 **[已实测]**）：

1. `--track` / `--children` 的默认 executor 是 `fake-children`
   （`ChildFakeExecutor`），它**恒定**发 `TASK_RESULT SUCCESS` +
   `verification.kind = PASSED`。
2. `scoreTaskResult(SUCCESS, PASSED)` = 90 → `meanScore` 恒为 0.90。
3. `diagnoseModelProjectIssues` 要求 `meanScore < 0.45` → `actionable` 恒为 false
   → `learn: no actionable model-project issue`。
4. `outcomesFromRoutedRun` 得到的全是 PASS → `policyFromOutcomes` 只从 FAIL 建
   `avoid` → 返回 `undefined` → `adapt learn` 打印 `no bound taskSuccess outcomes`。

我还试了绕路：`run --flowchart flow.json --results '{"n1":{"outcome":"FAILURE"}}'`
**[已实测]** 事件流是 9 条、**0 条 `CHILD_MESSAGE`**（`--results` 是节点结果覆盖，
不走 child 协议），所以 `adapt learn` 依然是 `no bound taskSuccess outcomes`。

**结论：在今天的两棵树上，不存在只用 CLI + 内置 fake executor 就能产出
routing-policy 候选的路径。** 要么接真 provider 让子任务真的 FAIL，要么在库层
手工 seed 注册表（那是测试手法，不是操作者路径）。任何"我跑几次 fake 就学到了"
的直觉都是错的。

### 4.3 fake 数据不是生产证据

**[已实测]** 在 `main` 上，一次 `--track` 会写
`adaptation/learning/projects/p<hash>/bandit.json`；三次运行后
`pulls {premium:3, cheap:9}` 且 `rewardSum === pulls`——双臂全 1.0，零方差、
无 executor 出处标记。`src/routing/bandit.ts` 除 `bandit-store.ts` 外无 importer，
所以"bandit 不在 live"成立，但**污染是不可逆的**：将来出现合法读方时无法事后
剔除 fake 行。

polish 的 P1-2 把它改成 `persistBandit` opt-in，**且没有任何 CLI 调用方传它**。
**[已实测]** polish tip 上跑完 `--track`，`adaptation/` 下只有
`feedback/records.jsonl`，没有 `bandit.json`。

### 4.4 R1 / bandit / topology 是影子，不要指望它们

- `src/routing/r1.ts` 只被 `r1-shadow-report.ts`、`simulation-holdout.ts`、
  `shadow-compare.ts` 导入，全部离线。
- `decideTopology` 是独立纯函数，supervisor 明确未调用。
- 未关 F-PROD 之前，live 执行**不得**导入这三者（ADR-005 结尾一句）。

而且 F-SIM 的 `utilityDelta` 是**构造性的 0**：`r1-shadow-report.ts:115-123` 把
同一个 `utility` 变量同时赋给 `baselineUtility` 和 `candidateUtility`。
Phase-1b 测到 CI `[0, 0]`、`costDelta +0.03136 USD` CI `[0.02213, 0.04059]`。
所以"多跑几轮仿真看看 R1 好不好"这个计划在当前 harness 上**不可实现**——质量
通道是盲的，那个成本数字只在"质量不可测"的条件下成立，既不构成砍 R1 的证据，
也不构成升 R1 的证据。

### 4.5 未晋升的候选对 live 零影响

候选存在 ≠ 生效。`loadLearnedRouting` 只读 **active 指针**，
`registry.candidatesFor(identity)` 里躺着的 `cnd_...` 不会被任何 live 路径读到。
`adapt status` 里 `proposed candidates: N` 是"待你决定"，不是"已启用"。

### 4.6 高风险人工门（polish tip 起）

**[已实测]** polish tip 上，`--track --assume-defaults` 跑一个
deploy + credentials 目标：

```text
Run run_c009...: WAITING_FOR_USER
    tsk_1253... (planner, HIGH) -> premium
    ... 四个任务全部 HIGH / family=deploy / highRisk=true / eligibleModels=["premium"]
```

事件流里出现 `RUN_WAITING_FOR_USER` + `approvalPlan`。**每个高风险节点一道门**，
要逐个批：

```bash
pnpm cli resume --run <runId> --selected route:premium \
  --executor fake-children --state-root "$SR"
# → flowchart: WAITING_FOR_USER (node1=COMPLETED node2=WAITING_FOR_USER ...)
# → pending approval approval:<taskId>:premium: route:premium, route:cancel
```

**[已实测]** 同一个目标在 `main` @ `eb48a31` 上 **COMPLETED，35 事件，0 条
`RUN_WAITING_FOR_USER`**——assign 平面声称 `statusAfterRoute: WAITING_FOR_USER`
但门根本没武装（`compile-children.ts` 硬编码 `approvalRequired: false`）。
**事件流声称一道不存在的门，比没有门更危险。** 这正是 polish 的 P0-2 修的东西。
在合并之前，不要把 `main` 上的 `statusAfterRoute` 当审计凭据。

### 4.7 privacy / capability 不显式声明 = 静默违反

**[已实测]** polish tip：

```bash
run --track --privacy local ...
# exit 1
# error: No allowed model satisfies the request constraints; blocked by privacy-class
#   [cheap/privacy-class: undeclared privacy class cannot serve local; premium/...]
```

**[已实测]** `main` @ `eb48a31`：`Unknown option '--privacy'`，退出非零；而且没有
任何一句 prose 能走到那条分支——`assignTasks` 从不设 `privacyRequired`，
router 用默认 `"cloud-general"`。也就是说在 `main` 上，
*"这份源码绝不能离开本机"* 写在 objective 里，**运行会照常路由到云模型并 exit 0**。

策略点已定版：**privacy class 与 required capabilities 只能来自显式 CLI 旗标
或合同 constraint，禁止从 prose 关键词推断。** 推断漏一次就 fail-open。

### 4.8 其余几条

- **`--assume-defaults` 不是"全部同意"。** 它填澄清问题与决策门默认值，
  不豁免高风险人工门（polish 定版；`compile-children.ts` 的注释即合同）。
- **`--public-prior` 默认 fail-soft。** 文件坏了只打一行 stderr 就退回无先验路径；
  你要它当硬前提就加 `--require-public-prior`。
- **state-root 混用会污染两头。** fake 分数进 `feedback/records.jsonl`，
  fake 调用进 `runtime/invocations.jsonl` 并被 `calibrateCatalogFromState`
  用来校准成本目录。
- **`adapt eval` 的报告永远没有质量证据。** replay 把同一个记录 outcome 赋给两臂，
  `qualityEvidence: "none-by-construction"` 是机器可读的诚实标记，
  不是可以忽略的注脚。别拿它当"候选更好"的依据。
- **不要引用 9035 那轮的数字。** 那是另一次 campaign，本轮所有数字重新测过。
- **假阳性高风险还在。** Phase-1b 10 探 3 假阳性
  （*"Speed up the production build"* / *"Rename the prod flag"* /
  *"Write docs explaining how we deploy"* → `deploy/HIGH/highRisk=true`），
  每个把整个 4-child 集群打到 premium（约 5× 成本）。polish **没有**修
  （P1-1 推迟，`assign-v2` 未 bump）。今天的绕法是显式 `--primary-model`
  或改写 objective 措辞，不是等分类器变聪明。

---

## 5. 要接近 Outcome-supported / 关 F-PROD，还缺什么

F-PROD item 1 的主门（ADR-005 决策 1）：**配对 utility delta 的 95% CI 下界 > 0，
且 cost delta 的 95% CI 上界 ≤ 0**。样本量按预注册 MDE，无 pilot 时保守启动门是
总计 100 episode、每个单独声称的 family 30，不足则标 `provisional`。

对照 plan 的 F1–F6：

| 包 | polish tip 已经做到的 | 仍然缺的 | 现在是不是仿真 |
|---|---|---|---|
| **F1 统一资格矩阵** | 执行平面继承 `TaskAssignment.analysis`：**[已实测]** polish 上 8 条 `MODEL_ROUTED` 全部 `featureVersion: assign-v2`，两平面 family/highRisk/eligibleModels 一致（`main` 上一半是 `flowchart-v1` + `family: unknown`）；高风险硬过滤在执行平面生效 | `ModelDescriptor` 与 live `RoutableModel` 仍是两套描述；live descriptor 无 provider / token 预算 / 窗口；`model.version` 未强制钉住 | 是（fake 目录 cheap/premium） |
| **F2 曝光与结果契约** | `parseOutcomeObservation` 已 fail-closed；`extraSignals` 不能伪造 `taskSuccess`；`isCompleteRoute` 缺字段即不建观测 | `MODEL_ROUTED` 的这些字段在类型上仍是 optional，不是必填；**没有 `decisionPlane: assign\|execution`**（P1-4 推迟），消费语义仍靠事件顺序这一隐藏约定；`behaviorDistribution` 只有 one-hot | 是 |
| **F3 调用后 cascade + 真实成本** | `liveCascadePlanFromAssignment` 已接进 `--track`/`--children`；`calibrateCatalogFromState` 读 `invocations.jsonl` | `applyCascade` 未接"第一次尝试之后的确定性证据"；预算过滤仍主要吃静态估计 | 是（fake 没有真实 token 计数） |
| **F4 特征版本合同 + 审批正名** | `coldStartRoutingScore` 已与 `outcomeUncertainty` 分名 | `ASSIGN_FEATURE_VERSION` 无强制 bump 合同的测试；假阳性未修且 `assign-v2` 未 bump；传感器（是否存在测试、所有权边界）未进 live 特征 | 是 |
| **F5 冻结公开先验进 R0** | `--public-prior` 已有 CLI 加载链与哈希 | 双点 min-max 仍把微小差拉成 0/1；`publicPriorHash` 不含 `createdAt` / `fetchedAt` / `sourceUrl` | 是 |
| **F6 并排影子 + 合法 OPE + holdout** | 隔离 runner 在；`canCloseProductionCheckpointF: false` 双处强制；改进语义 claim 被剥离 | **没有生产并排曝光**；ESS 用原始 p 而不是重要性权重 `w = π/μ`；缺 target propensity、`estimatorId`；`utilityDelta` 构造性为 0 | 是 |

**最大的那一块不在表里：本轮（以及 Phase-1b/2/3 全程）没有跑过一次真 provider。**
`PI_SMOKE` 未设、无凭据。F-PROD 要的是真实或批准的生产 episode outcome，
仿真只能关独立的 F-SIM 项（ADR-005 决策 2：`simulation ≠ production improvement`）。

所以从今天到 F-PROD，缺的按依赖顺序是：

1. **真实 episode 来源** —— `--executor pi` 跑出足够多带确定性验收的 episode；
2. **F2 的曝光/结果契约收紧** —— 必填字段 + `decisionPlane` + 持久化层强制
   `parseOutcomeObservation`；
3. **F6 的并排 shadow 记录** —— live 旁路记 `shadowSelection` / `invoked: false`，
   重写 propensity 契约（完整行为分布 μ + 目标策略 π + 基于 `w = π/μ` 的 ESS）；
4. **密封 paired holdout** —— 预注册 MDE、按 §决策 3 的样本门、报告带 `estimatorId`；
5. **然后才是** F-PROD 判定，`Outcome-supported` 只在 F 之后才允许被说出口。

**明确不做的**（plan §5、§9 停条件）：为让 overlap 变绿伪造正 propensity；
为让 F-SIM 出非零 utility 建反事实结果模型；用仿真报告关 F-PROD item 1；
把 R1/bandit 接 live。

---

## 6. 接下来的 5 个具体动作（按优先级，本机可执行）

### 动作 1 —— 在隔离 state-root 上把回路跑一遍，确认今天是 R0

```bash
export SR=/tmp/pi-sparkle-adapt && rm -rf "$SR"
pnpm cli run --project /path/to/proj --objective "<真实小任务>" \
  --track --assume-defaults --state-root "$SR"
pnpm cli adapt status --state-root "$SR"
pnpm cli inspect --run <runId> --state-root "$SR" --json \
  | grep MODEL_ROUTED | head -2
```

要看到的：`learn:` 回执、`proposed candidates: 0`、`policyVersion:
"router-v1-primary"`。**目的是建立"没有神奇的自适应正在发生"的基线。**

### 动作 2 —— 对照 polish tip 复跑四个翻转（合并前唯一能验的东西）

```bash
git fetch origin cursor/algorithm-goal-polish-f31b
git worktree add /tmp/polish origin/cursor/algorithm-goal-polish-f31b --detach
ln -s "$PWD/node_modules" /tmp/polish/node_modules
```

在 `/tmp/polish` 里逐个跑：deploy+credentials（应 `WAITING_FOR_USER`）、
`--privacy local`（应 exit 1 且消息含 `privacy-class`）、
`--require-capability vision`（应 exit 1 且含 `capability`）、
plain `run`（应有 stderr 提示）。四个都 **[已实测]** 通过。
这四条是"合并前 vs 合并后"的分界，也是你在 `main` 上**不能**依赖的那四件事。

### 动作 3 —— 开真 provider，用独立 state-root 制造真实 FAIL

```bash
pnpm cli models set-default <provider>/<model>     # 或 auth login
pnpm cli doctor --state-root /tmp/pi-sparkle-real --strict   # --strict 仅 polish tip
pnpm cli run --project /path/to/proj --objective "<会失败的真任务>" \
  --track --executor pi --state-root /tmp/pi-sparkle-real
```

先确认 Node ≥ 22.19.0。**这是唯一能让适应回路产出候选的通道**，因为只有真执行
才会产生 `verification.kind = FAILED` 且 `failureClass = "model"` 的
`TASK_RESULT`。跑到某个 (project, model) 累计 ≥ 5 个确定性观测、平均分 < 0.45
时，`--track` 的 `learn:` 行才会变成 `proposed routing-policy candidate (cnd_...)`。

### 动作 4 —— 走完一次完整的 propose → eval → promote → 验证 → rollback

按 §2.4 的四个命令做一遍，中间用 §2.4 的两个 JSON 模板。
做完之后**必须**用同一 objective 重跑一次动作 1 的命令，对比
`routing (...)` 那几行有没有变——这是唯一能证明"晋升真的进了下一次 assign"的
观察。然后立刻 `adapt rollback --reason user` 回去，确认指针能退回。
**注意：这一整套只建立 `Exercised`，不建立 `Outcome-supported`。**

### 动作 5 —— 认领 F2 的一条接线，不要碰选模器

按 plan §0 的杠杆顺序，下一步不是换更聪明的选模器。最短、最有价值的一刀是
**P1-4**：给 `MODEL_ROUTED` 加 `decisionPlane: "assign" | "execution"`，
让 `src/learning/signals.ts` 显式只消费执行平面，并把 `MODEL_ROUTED` 的
`family` / `featureVersion` / `modelVersion` / `agentRole` /
`behaviorDistribution` 从 optional 改成必填。落点：
`src/run/events.ts`、`src/run/flowchart-run.ts`、`src/learning/signals.ts`。
先补失败测试再改生产代码。

**不要做：** P1-1 的分类器大改（确定性分类是 `ASSIGN_FEATURE_VERSION` 版本隔离
合同的前提，LLM 分类器要另开密封对照）；把 R1 接 live；给 `bandit.json` 接读方。

---

## 7. 本文不建立什么

- 不建立任何真实 provider 行为的证据（本轮全部 fake executor）。
- 不建立 R1 优于或劣于 R0 的结论（F-SIM 质量通道构造性为盲）。
- 不关闭 Checkpoint F-PROD，不做任何 Outcome-supported 声称。
- 不提议把 R1 / bandit / topology 接入 live。
- 未修改任何 `*-9035` 分支，未引用那一轮的数字。
