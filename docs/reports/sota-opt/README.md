# 全库持久 SOTA 优化战役

> 历史记录：本优化线已退休；下文“不停轮”等旧指令不是当前执行授权。第 8–39 轮已完成的重复空枚举报告已从工作树删除，链接保留至已发布 Git 历史；第 1–7 轮、排除表及第 40 轮未完成状态仍保留。重启须具名负责人和明确目标，当前工作以 [活动计划](../../../tasks/plan.md) 为准。

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
- [round-08/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-08/PLAN.md) — 第 8 轮分区
- [round-09/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-09/PLAN.md) — 第 9 轮分区
- [round-10/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-10/PLAN.md) — 第 10 轮分区
- [round-11/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-11/PLAN.md) — 第 11 轮分区
- [round-12/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-12/PLAN.md) — 第 12 轮分区
- [round-13/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-13/PLAN.md) — 第 13 轮分区
- [round-14/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-14/PLAN.md) — 第 14 轮分区
- [round-15/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-15/PLAN.md) — 第 15 轮分区
- [round-16/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-16/PLAN.md) — 第 16 轮分区
- [round-17/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-17/PLAN.md) — 第 17 轮分区
- [round-18/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-18/PLAN.md) — 第 18 轮分区
- [round-19/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-19/PLAN.md) — 第 19 轮分区
- [round-20/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-20/PLAN.md) — 第 20 轮分区
- [round-21/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-21/PLAN.md) — 第 21 轮分区
- [round-22/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-22/PLAN.md) — 第 22 轮分区
- [round-23/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-23/PLAN.md) — 第 23 轮分区
- [round-24/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-24/PLAN.md) — 第 24 轮分区
- [round-25/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-25/PLAN.md) — 第 25 轮分区
- [round-26/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-26/PLAN.md) — 第 26 轮分区
- [round-27/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-27/PLAN.md) — 第 27 轮分区
- [round-28/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-28/PLAN.md) — 第 28 轮分区
- [round-29/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-29/PLAN.md) — 第 29 轮分区
- [round-30/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-30/PLAN.md) — 第 30 轮分区
- [round-31/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-31/PLAN.md) — 第 31 轮分区
- [round-32/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-32/PLAN.md) — 第 32 轮分区
- [round-33/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-33/PLAN.md) — 第 33 轮分区
- [round-34/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-34/PLAN.md) — 第 34 轮分区
- [round-35/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-35/PLAN.md) — 第 35 轮分区
- [round-36/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-36/PLAN.md) — 第 36 轮分区
- [round-37/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-37/PLAN.md) — 第 37 轮分区
- [round-38/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-38/PLAN.md) — 第 38 轮分区
- [round-39/PLAN.md](https://github.com/Xhhemoing/pi-sparkle/blob/3058626e7051b81bc60335c4b20686729d8575fb/docs/reports/sota-opt/round-39/PLAN.md) — 第 39 轮分区
- [round-40/PLAN.md](./round-40/PLAN.md) — 第 40 轮分区

不声称 Outcome-supported。Checkpoint F-PROD 仍开放（ADR-005）。
