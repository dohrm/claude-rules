# Token cost (~4 bytes per token)

Paid **per session**: every skill description, plus the unscoped rules of the installed profiles.
Paid **per file opened**: rules scoped by `paths:`. Paid **per invocation**: a skill body, then the extra files it reads.

- skill descriptions (23): ~1761 tokens
- unscoped rules (6), if every profile were installed: ~6697 tokens
- scoped rules (57): ~34080 tokens in total

## Skills

| skill | description | body | extra files |
|---|--:|--:|--:|
| rfc | 125 | 3633 | 2144 (2) |
| architect | 105 | 3483 | — |
| loop-setup | 77 | 2941 | — |
| design-system | 47 | 2473 | — |
| pre-mortem | 73 | 2133 | — |
| ui-prompt | 68 | 1973 | — |
| migrate | 78 | 1947 | — |
| defect | 93 | 1930 | — |
| prd | 44 | 1872 | — |
| profile | 122 | 1735 | — |
| diagram | 52 | 1725 | — |
| postmortem | 73 | 1705 | — |
| interview | 92 | 1597 | — |
| observability | 75 | 1465 | — |
| domain-modeling | 74 | 1437 | — |
| runbook | 66 | 1303 | — |
| update | 84 | 1187 | — |
| experience | 76 | 1125 | — |
| onboard | 63 | 1115 | — |
| ci-setup | 62 | 1112 | — |
| solution-exploration | 68 | 921 | — |
| adr-review | 67 | 825 | — |
| debrief | 81 | 656 | — |

## Rules

| rule | loads | tokens |
|---|---|--:|
| agent/autonomy.md | per session | 2871 |
| product/documents.md | per file | 2088 |
| agent/decisions.md | per session | 1955 |
| testing/ratchet.md | per file | 1548 |
| agent/decision-records.md | per file | 1383 |
| portal-flat/principle.md | per file | 1225 |
| portal-http/react.md | per file | 1216 |
| tauri/app.md | per file | 1200 |
| product/experience.md | per file | 1164 |
| k8s/workloads.md | per file | 1154 |
| cicd/pipeline.md | per file | 1124 |
| testing/strategy.md | per file | 1105 |
| ops/slo.md | per file | 1077 |
| ops/observability.md | per file | 960 |
| cicd/release.md | per file | 955 |
| hexagonal/principle.md | per file | 928 |
| agent/guardrails.md | per session | 895 |
| cqrs/principle.md | per file | 876 |
| testing/contract.md | per file | 819 |
| api/python.md | per file | 708 |
| rust/test-layout.md | per file | 706 |
| devstack/running.md | per session | 658 |
| backend/api-surface.md | per file | 654 |
| api/principle.md | per file | 645 |
| ops/delivery.md | per file | 630 |
| portal-http/state.md | per file | 630 |
| backend/authorization.md | per file | 593 |
| hexagonal/rust-di-container.md | per file | 553 |
| api/node.md | per file | 540 |
| api/rust.md | per file | 535 |
| api/go.md | per file | 465 |
| backend/errors.md | per file | 465 |
| hexagonal/python.md | per file | 459 |
| ops/migrations.md | per file | 433 |
| backend/pagination.md | per file | 423 |
| backend/config.md | per file | 420 |
| backend/health.md | per file | 417 |
| ts/quality-gates.md | per file | 411 |
| hexagonal/go.md | per file | 396 |
| hexagonal/rust.md | per file | 395 |
| godot-csharp/quality-gates.md | per file | 338 |
| rust/code-style.md | per file | 309 |
| rust/quality-gates.md | per file | 305 |
| python/quality-gates.md | per file | 301 |
| go/quality-gates.md | per file | 288 |
| python/error-handling.md | per file | 284 |
| godot-csharp/architecture.md | per file | 266 |
| ts/code-style.md | per file | 238 |
| product/vocabulary.md | per session | 234 |
| godot-csharp/migration.md | per file | 216 |
| godot-csharp/data.md | per file | 214 |
| react/quality-gates.md | per file | 214 |
| python/code-style.md | per file | 214 |
| go/concurrency.md | per file | 208 |
| python/logging.md | per file | 203 |
| godot-csharp/event-bus.md | per file | 203 |
| python/environment.md | per file | 180 |
| go/logging.md | per file | 173 |
| rust/logging.md | per file | 166 |
| rust/error-handling.md | per file | 162 |
| go/grpc-protobuf.md | per file | 159 |
| rust/utf8-safety.md | per file | 143 |
| common/language.md | per session | 85 |
