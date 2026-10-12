# Adaptive automatic model team

Choose **Avtomatik · modellar jamoasi**. The compatible text-model pool remains scoped to the signed-in user's enabled catalog and model access policy. Hosted Antigravity participates in cloud tasks; local Antigravity participates only on the selected project node. Native turns use the CLI adapter rather than the HTTP client, with the same stage selection, load accounting and recoverable handoffs. Restricted agents without both read_file and write_file are excluded from native execution.

- Stage preferences select planning, implementation, repair and review models. Among eligible candidates, current in-flight calls and observed token usage over the recent process-local activity window lower priority for heavily used models. A healthy model stays on its current phase to avoid churn. This is load balancing, not a promise of equal cost or measured token savings; usage data resets with the server process.
- Recoverable transport, rate-limit, timeout, malformed/empty response failures move to another eligible model. Automatic HTTP requests have a 180-second total ceiling and 90-second idle ceiling (shorter existing limits win). A failed candidate is excluded for this run. There are at most six recovery handoffs within the existing agent step budget.
- Two consecutive steps containing technical tool failures request a handoff. A final answer immediately after an unresolved tool failure cannot silently complete the run. A model can call `handoff_model` to request technical help sooner.
- Tool call/result pairs and project files stay in place. A compact shared ledger describes the latest tools, saved paths, errors, exit codes and plan. Routing itself never replays tools. Models are instructed to inspect uncertain side effects before retrying; external writes retain their existing approval rules.
- Old bulky observations are shortened only in outbound model context; recent evidence, audit history and files stay intact. Simple tasks no longer spend two extra calls on upfront specialist advice. Complex architecture tasks can still use a parallel briefing. Explicit consultation receives shared state.
- Cancellation, denied permissions, OpenSI account quotas and policy refusals do not trigger an automatic bypass. If eligible models are exhausted, the run stops with its files preserved. Missing credentials, offline devices or external-service failures still may require user action.

The live progress panel shows model routes and automatic handoff reasons. Provider-reported usage remains recorded; unknown usage is not presented as a measured saving.

## JEV supervisor

When the existing JEV connection is enabled, phase changes, technical failures and healthy-progress milestones evaluate execution metadata (phase, recent tool names and outcomes, candidate priorities and in-flight load). Raw project prompts, file contents, paths and commands are not included in these automatic requests. The model-invoked `jev_decide` tool remains a separate explicit capability.

Validated, confident Choice answers can recommend a next step and select an eligible near-top candidate in automatic mode. A high-confidence switch can trigger a recovery after a technical failure; it cannot change permissions or declare success. Manual model choices stay selected. Native CLI rounds receive boundary monitoring; a recoverable native failure returns to the automatic router after preserving returned files. Guided mode requires the native task approval; automatic execution uses the project's existing automatic policy and retains CLI permission rules. Read-only parallel briefing uses HTTP-capable models; native models execute sequentially against the project to avoid concurrent file edits.

Supervision waits at most 700 ms per assessment, reuses identical states, makes at most 6 requests per run including delegated work, and stops trying after two consecutive service failures. Normal execution continues if JEV is unavailable. This adds bounded overhead; speed or token savings are not guaranteed. Actual provider-reported JEV token usage is recorded with provider ID `jev`; missing usage stays unknown. The UI shows the latest supervision result and latency.

Wire schema: https://docs.typesafe.ai/api (Choice `choice`, `confidence`, `probabilities`; optional usable `usage` is validated before recording).

Provider quota cooldowns, automatic MCP execution and prompt-overhead changes are documented in [Automatic execution and model recovery](automatic-model-recovery.md).
