# Round 1 分区（10 子代理并行）

模型一律 `claude-fable-5-thinking-xhigh`。基线：`cursor/sota-persistent-opt-83a1`。

因云端异步 VM 上限为 3，本轮按 A+F+J → B+C+D → E+G+H → I 分波派出，目标仍是 10 区全覆盖。

| 代号 | 范围 | 报告路径 |
| --- | --- | --- |
| R1-A | `src/tracking/`、`src/run/child-tracking.ts`、`src/run/gate-apply.ts` | `docs/reports/sota-opt/round-01/R1-A.md` |
| R1-B | live 路由：`src/routing/{r0,assign,policy,live-cascade,analyze-task,primary-catalog,catalog-model}.ts`、`src/supervisor/model-router.ts` | `docs/reports/sota-opt/round-01/R1-B.md` |
| R1-C | 离线路由：`src/routing/{r1,r1-shadow-report,posterior,offline-logit,offline-prob-add,propensity,lin-alg,bandit,shadow}.ts` | `docs/reports/sota-opt/round-01/R1-C.md` |
| R1-D | `src/adaptation/` | `docs/reports/sota-opt/round-01/R1-D.md` |
| R1-E | `src/learning/` | `docs/reports/sota-opt/round-01/R1-E.md` |
| R1-F | `src/experiments/` | `docs/reports/sota-opt/round-01/R1-F.md` |
| R1-G | `src/run/`（除 A 已列）、`src/supervisor/`、`src/graph/`、`src/domain/` | `docs/reports/sota-opt/round-01/R1-G.md` |
| R1-H | `src/evaluation/`、`src/requirement/`、`src/review/`、`src/rubric/` | `docs/reports/sota-opt/round-01/R1-H.md` |
| R1-I | `src/cli/`、`src/pi-adapter/`、`src/config/`、`src/telemetry/` | `docs/reports/sota-opt/round-01/R1-I.md` |
| R1-J | `src/cluster/`、`src/privacy/`、`src/preferences/`、`src/episode/`、`src/persist/`、`src/track/`、`src/context/`、`src/feedback/` | `docs/reports/sota-opt/round-01/R1-J.md` |

硬约束见仓库三线最终规格与 ADR-004/005。排除表见 [../EXCLUSIONS.md](../EXCLUSIONS.md)。
