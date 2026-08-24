# 全库持久 SOTA 优化战役

**专属分支:** `cursor/sota-persistent-opt-83a1`  
**停轮条件:** 仅当用户明确说停。至少 20 轮 × 每轮 10 个云端子代理，达到后仍继续。  
**子代理模型:** `claude-fable-5-thinking-xhigh`（用户当次指定）。  
**父代理直改:** 仅文档/注释/配置措辞，或 ≤10 行且不涉及业务逻辑/权限/数据面。

本目录是进度、方案与排除表的单一来源。每轮子代理必须先读本目录再动手，并在返回摘要第一行自报 `MODEL_SLUG=...`。

- [PROGRESS.md](./PROGRESS.md) — 轮次与合并状态
- [EXCLUSIONS.md](./EXCLUSIONS.md) — 全局排除表（禁止重复提案）
- [round-01/PLAN.md](./round-01/PLAN.md) — 第 1 轮分区
- [round-03/PLAN.md](./round-03/PLAN.md) — 第 3 轮分区
- [round-04/PLAN.md](./round-04/PLAN.md) — 第 4 轮分区
- [round-05/PLAN.md](./round-05/PLAN.md) — 第 5 轮分区
- [round-06/PLAN.md](./round-06/PLAN.md) — 第 6 轮分区
- [round-07/PLAN.md](./round-07/PLAN.md) — 第 7 轮分区
- [round-08/PLAN.md](./round-08/PLAN.md) — 第 8 轮分区
- [round-09/PLAN.md](./round-09/PLAN.md) — 第 9 轮分区
- [round-10/PLAN.md](./round-10/PLAN.md) — 第 10 轮分区
- [round-11/PLAN.md](./round-11/PLAN.md) — 第 11 轮分区
- [round-12/PLAN.md](./round-12/PLAN.md) — 第 12 轮分区
- [round-13/PLAN.md](./round-13/PLAN.md) — 第 13 轮分区
- [round-14/PLAN.md](./round-14/PLAN.md) — 第 14 轮分区
- [round-15/PLAN.md](./round-15/PLAN.md) — 第 15 轮分区

不声称 Outcome-supported。Checkpoint F-PROD 仍开放（ADR-005）。
