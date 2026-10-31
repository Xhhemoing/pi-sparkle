# Grok 续办提示词：修复独立审查的四项缺陷

> 以下内容可直接转发给 Grok。它是对已合并 G0～G3 的纠正任务，不是重做原计划。收到前先确认能访问此文件及审查报告；若文件尚未推送，由 SCM 提供获批文档 patch 或 owner 粘贴全文，不假设本机 `.agent_workspace/` 对远程 bot 可见。

## Identity / 接单范围

你是本项目的 Grok 实施 bot。执行 `TASK-20260913-grok-review-repair`，状态 `planned`；owner 为 Grok（实施）、独立 reviewer（复验）、SCM/xhh（交付）、project owner（权限/merge）。日期 2026-09-13。

已核验 main：`fe2533014e76dcddfd10beada5dc22ecec4c2a8a`，PR #37～#41 均已 MERGED。请不要重复 G0/G1A/G1B/G2/G3，也不要再报告“尚未派发原计划”。本任务是否接单由你实际回复确认，不能以本文件存在替代派发记录。

独立审查结果 **REQUEST CHANGES**。证据：[review report](../../reports/2026-09-13-grok-trusted-execution-review.md)。当前既有 focused 38/38 pass；全量 gate 2766 tests / 2748 pass / 0 fail / 18 skip；但新增五条审查反例有四条失败、一条对照通过。不要用已有 CI 绿色关闭四个 finding。

### 接单先回复

- 实际身份、repo/worktree/branch、完整 base SHA、工作区状态、Node/pnpm 版本。
- 确认读取 `AGENTS.md`、workflow、tasks、原 trusted-execution 计划及本次报告。
- 从获批 main 新建 `grok/trusted-execution-review-fixes` 或同前缀的新分支；main 若已前进，先确认四个 finding 是否仍可复现，报告 ancestry/差异，不盲目回滚到旧 tip。
- 给出四个 finding 对应的测试/源码文件白名单。开始顺序 **R3 → R1 → R2 → R4**；共享源码改动串行，不让多个 agent 同时改 closed-loop 或 process policy。

## 全局限制

1. 本轮只修以下四个 finding、必要回归与状态留档。不开新功能，不接 ObservationPack live/default coding CLI，不改 live R1/bandit/topology、Pi extension 或 model pin。
2. 不运行付费 provider、真实 crash/benchmark、holdout/custody/seal；不访问真实用户运行数据、凭据或隐藏 oracle。文件逃逸测试只用你创建的临时 root/outside sibling。
3. 不 reset/clean/stash/覆盖原用户脏工作区；不批量 `git add .`；不自动 push/merge，按 SCM 和 owner 授权执行。
4. 每个修复先移植真实负例到产品 `test/`，运行并确认 **RED 是预期断言失败**；再定位根因、最小实现、GREEN；不能削弱断言、改 fixture 避开中文/悬空 link、关闭 quotePath 或 skip 失败用例。
5. worktree/cwd/allowlist 不是 OS 沙箱；不要以修完 symlink 宣称敌对代码已隔离。保留 TOCTOU 的明确残余边界。
6. 新增/改变内部证据 schema 必须显式版本化，旧记录不得默认为新级别可信。冻结 Event/CLI/JSON 不能顺手改变；如修复需要该变化，停止提出单独设计。

## R3 / P1 — 悬空 symlink 根外写入

**现有根因：** `src/execution/paths.ts` 用 `existsSync(cur)` 才进入 `lstatSync`。悬空 link 的 exists 为 false，最后 writeFile 跟随它创建根外文件。无需竞态。

**修改白名单：**
- `src/execution/paths.ts#assertNoSymlinkEscape/resolveInsideRoot`。
- `src/pi-adapter/worktree-coding-tools.ts` 仅必要调用/错误传播修改。
- `test/unit/execution/paths.test.ts`、`test/unit/pi-adapter/worktree-coding-tools.test.ts`。

**必须先复现：**
1. 新建 worktreeRoot 和其外部临时 sibling 目录；`outside-new.txt` 不存在。
2. `symlink(outsideNewPath, path.join(worktreeRoot,'link.txt'),'file')`。
3. 创建 coding tools，调用 write tool `execute('fixture',{path:'link.txt',contents:'outside sentinel'})`。
4. 断言拒绝，且 outsideNewPath 不存在。审查现值：**调用成功、根外文件内容为 outside sentinel**。

**实现/验收：**
- 使用不跟随 link 的 `lstat` 判断组件本身；解析 link 失败/目标不存在要拒绝，不跳过检查。区分真实不存在的新文件和存在的悬空 link。
- 检查父目录 link/junction、悬空文件 link、根外现存目标；正常根内新文件仍可创建。
- 不能把二次检查当作原子文件安全；若仍有 TOCTOU 留下明确说明。
- Windows 无 symlink 权限只能记环境阻塞并取得支持环境证据，不能据 skip 标记修复通过。本次审查 Windows 上此用例实际执行、未 skip。

```bash
pnpm test -- test/unit/execution/paths.test.ts test/unit/pi-adapter/worktree-coding-tools.test.ts
```

## R1 / P1 — 指纹漏掉中文/转义文件内容变化

**现有根因：** `src/execution/worktree-snapshot.ts` 逐行解析 porcelain v1，只去引号不解转义，再把 `\\` 改 `/`；真实文件找不到时用 null hash。两次不同内容被认为一致。

**修改白名单：**
- `src/execution/worktree-snapshot.ts#gitPorcelain/captureWorktreeFingerprint`。
- `test/unit/execution/worktree-snapshot.test.ts`。
- `test/integration/execution/closed-loop.test.ts` 中加入真实检查时改文件的回归。

**必须先复现：**
1. 临时 Git repo 提交 `中文.txt`，值 v1；设置 fixture repo 的 `core.quotePath=true`。
2. 改为 v2 后调用 `runIndependentCheck({cwd,command:'node',args:['-e',"require('fs').writeFileSync('中文.txt','v3')"]})`。
3. 断言 `check.ok===false`；通过 closed-loop 的同场景不得 accepted。
4. 审查现值：两次 entry 都是 `/344/270/255/346/226/207.txt` + `sha256:null`，**ok=true**。

**实现/验收：**
- 使用 NUL-delimited `git status --porcelain=v1 -z -uall` 或等价可靠协议，正确读取 rename/copy 额外 path；不要拆 literal ` -> `、手工剥引号或依赖用户 quotePath。
- 保留实际路径字节/字符语义；含中文、空格、引号/换行（平台支持时）、重命名、新增、删除、二进制均测试。测试必须明确平台限制。
- 非删除候选无法读取/类型不支持时 fail closed，不能记录静默 null 而认为验证成功。
- 不修改用户 index/config；同样文件树指纹确定，allowed output dirs 的既有正例仍通过。
- 保留 staged delete + 同名 untracked 重建的通过对照；审查此场景已能检测 drift，不误报为已修旧 bug。

```bash
pnpm test -- test/unit/execution/worktree-snapshot.test.ts test/unit/execution/acceptance.test.ts test/integration/execution/closed-loop.test.ts
```

## R2 / P1 — closed-loop 高层 API 复活已删除 run

**现有根因：** `src/execution/closed-loop.ts#runClosedLoopCheck` 无条件 mkdir run；`loop-artifact.ts#assertRunPresent` 仅检查目录。低层 delete/read/save 测试通过，但真实入口绕过生命周期。

**修改白名单：**
- `src/execution/closed-loop.ts`、`src/execution/loop-artifact.ts`。
- `test/integration/execution/loop-artifact-lifecycle.test.ts`、`closed-loop.test.ts`、`pi-closed-loop.test.ts`、`test/unit/execution/loop-artifact.test.ts`。
- 只读参考 `src/context/observation-store.ts`、`src/run/event-store.ts`、`src/privacy/deletion.ts`；若需要改变锁协议/公共删除返回值，先停下说明，不扩大 PR。

**必须先复现：**
1. 测试创建真实 durable run 并保存其 runId；`deleteRunRecords(stateRoot,runId)`，断言 run directory 已消失。
2. 同一 runId 调用 `runClosedLoopCheck({session,stateRoot,runId,command:'node',args:['-e','process.exit(0)']})`。
3. 断言拒绝、目录不复活、无新 artifact/accepted 结果。审查现值：**revived=true、accepted=true**。

**实现/验收：**
- 移除检查 API 的隐式 run 初始化；合法 run 必须通过已有 durable lifecycle 创建。不存在/已删 run 不允许仅因 mkdir 就有效。
- 对 run 的有效性检查和每次 artifact 持久化使用已有 run identity/event 和 cooperative lock 协议；不能只用目录 access。
- 删除与写入竞争：删除先完成则之后所有写入拒绝；写入先持锁则删除等待/按既有超时失败；不得 deadlock，不能嵌套同一 run 锁。新增受控交错测试，不能只做顺序 save/read。
- 更新 G2 fixture：通过正常 run 初始化创建，不能在测试里重新 mkdir 已删 run 让旧实现过关。
- 合法 run 的正常闭环、失败 evidence 保留、删除 cascade 继续通过。不新增无期限 tombstone 或新冻结事件来掩盖问题；若确有必要另行设计。

```bash
pnpm test -- test/unit/execution/loop-artifact.test.ts test/integration/execution/loop-artifact-lifecycle.test.ts test/integration/execution/closed-loop.test.ts test/integration/execution/pi-closed-loop.test.ts test/unit/privacy/deletion.test.ts test/integration/cli/delete.test.ts
```

## R4 / P2 — 独立检查漏执行 per-stream output cap

**现有根因：** `independent-check.ts` 只把两个上限的 max 给 spawnSync，未逐项检查结果。工具路径有该检查，独立验收路径没有。

**修改白名单：**
- `src/execution/independent-check.ts`；必要时复用/增加 `src/execution/command-policy.ts` 内的结果验证函数。
- 新增 `test/unit/execution/independent-check.test.ts`；扩展 `test/unit/pi-adapter/worktree-coding-tools.test.ts` 做一致性回归。
- `src/pi-adapter/worktree-coding-tools.ts` 仅必要的共享结果检查接线。

**必须先复现：**

```ts
const check = runIndependentCheck({
  cwd: fixtureRepo,
  command: 'node',
  args: ['-e', "process.stdout.write('x'.repeat(64))"],
  commandPolicy: {
    allow: [{ executable: 'node', argvPrefix: ['-e'] }],
    maxStdoutBytes: 8,
    maxStderrBytes: 1024
  }
});
assert.equal(check.ok, false);
```

审查现值 **ok=true / exitCode=0**。修复若采用显式异常则测试断言对应稳定拒绝错误；不能忽略超限。

**实现/验收：**
- stdout/stderr 按 UTF-8 实际字节分别检查；任意超限、spawn error、timeout、截断均不能 PASS。
- 两边上限不同、恰好上限、超一个字节、多字节文本、正常 exit 0/非零、spawn 失败/timeout 都覆盖。
- timeout/大小配置不能用零/负数/NaN 绕过限制；错误信息只记录原因和安全计数，不输出原始 stdout/stderr。
- 不借此放宽命令 allowlist/env 策略，也不新接 provider。

```bash
pnpm test -- test/unit/execution/independent-check.test.ts test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/execution/closed-loop.test.ts
```

## 最终验证与交付

每个 finding 单独最小提交，包含测试和实现；先 RED 后 GREEN 的日志放 `.agent_workspace/`，记录具体断言与运行环境，不只粘贴总数。

最终修复 head 上执行：

```bash
pnpm test -- test/unit/execution/ test/unit/pi-adapter/worktree-coding-tools.test.ts test/integration/execution/
pnpm gate
pnpm security:probe
pnpm pi:probe
pnpm workflow:check
git diff --check
```

- 四个原始反例须在最终 head 再复跑通过。原 `.agent_workspace/grok-review/review-regressions.test.ts` 若不可访问，按本任务书的精确输入重建产品回归，不以材料不可见跳过测试。
- 输出最终完整 SHA、文件清单、四项 root cause/fix/test 映射、各检查的实际 pass/fail/skip、兼容/隐私风险、残余限制。
- 持久化报告 `docs/reports/2026-09-13-grok-review-repair-verification.md`；同步 tasks 和相关 status 行。G0～G3 写“已合并”，本次 R1～R4 独立追踪验收，不能把未修复说成已 accepted。
- G3 报告 §7 缺失验证结果只追加本次实际跑出的新记录，不能伪造历史输出；旧 PR-B merge 状态和 P3 错误文件路径顺带按证据更正，不改实验结论。
- 提交独立 reviewer 验证，不自报为独立审查通过；push/merge 要 SCM 按 owner policy 进行。本提示词不授权 merge。

## 修完以后，不要自动开始

F6 仍 **NOT READY**。owner 需先裁定公开的 115 草稿仅作 pilot 还是需要 custodian 新写样本。freeze/oracle/retention 的 runner 接线应另立有 fake-only integration 的计划；本轮不接线、不 seal、不采集。真实 coding smoke、性能量化、ObservationPack live 也另需范围/预算审批。

## 本提示词的规划记录

- 本会话只做 review + 规划，未实施上述修复、未派发给 Grok。
- 相关报告已记录五个审查用例的 4 fail / 1 pass 和现有 gate 的通过结果。
- 验收：四个 finding 的文件、根因、可移植复现、RED/GREEN 命令与交付边界完整；本地链接/流程检查结果见审查报告收尾。
