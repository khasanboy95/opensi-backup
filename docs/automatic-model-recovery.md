# Automatic execution and model recovery

Select **Avtomatik · modellar jamoasi** for provider/model failover. Select
**Agent rejimi → Avtomatik** for execution without repeated project-tool prompts.
These are separate settings: a manually selected model remains pinned.

Browser and tool recovery also work with a pinned model. A source such as
`https://example.com/login` opens for a human login handoff instead of failing
the native clone preflight. After login, the original capture/exploration
continues on the authenticated page, including its saved visited pages and
remaining in-memory queue. The mobile capture uses the authenticated URL.
Authentication/action links are still excluded from discovered crawler links;
the browser gateway's network and ownership checks remain in force.

The chat and computer login buttons validate the live browser before resolving
the same approval. An early click leaves that approval pending, rather than
opening repeated approvals. The legacy resume endpoint checks readiness only;
it cannot release control while the run still waits for a login decision.

For an explicit **only login page / faqat kirish sahifasi** task, capture the
visible public form using `computer_capture` with `publicPage=true`. Capture
redacts input text, does not submit forms or switch tabs, and does not authenticate.
The automatic and native preflight paths select this mode for that narrow task;
internal-page exploration still requires the account owner's real sign-in.

Native clone preflight checkpoints successful desktop/mobile references for
the current run. Model changes, review and reconnect reuse those references
instead of collecting the same page again. Hosted CLI captures remain in the
cloud workspace for API fallback; the referenced screenshots, assets and
metadata are also copied to the CLI once per content version and node. Older
unrelated browser collections are excluded from source-code synchronization.
Empty connector reservations do not consume a server evidence slot. Real
collection/byte limits remain; their errors tell the agent to inspect matching
existing manifests without silently deleting files or claiming a fresh capture.

Pasted URL wrappers, surrounding whitespace, bare domains and an HTTP address
with a standard port are normalized to HTTPS on the same host. Invalid or
blocked addresses produce a specific error and recovery guidance. A transient
browser observation/capture failure gets one immediate retry; clicks and
submissions are never automatically replayed. Human takeover, denial and
cancellation stop recovery. If every explored page fails, the result contains
an error and the actual evidence index rather than implying success.

Technical tool errors return `recovery.kind` and `recovery.next` to the agent.
If a model tries to finish immediately after a failed tool/test, the loop gives
it at most two focused repair prompts. Four consecutive failed tool turns
without progress stop honestly with saved files. Automatic model selection
can still hand off after two failed turns; a pinned model stays selected.
This does not manufacture missing credentials, bypass login/access policies,
replay uncertain external side effects or guarantee that every external
provider/site is available.

- Only the current user's enabled, permitted text models participate. Hosted
  Antigravity works in cloud projects; local Antigravity stays on the chosen node.
- Automatic execution covers project terminal/package/browser tools and connected
  MCP tools, including explicitly selected Antigravity. Human questions and browser
  login still wait for input. Saved external API connections retain their own
  automatic-operation permission. Denials and account access restrictions are not
  failover signals.
- HTTP 402, insufficient quota, exhausted credits, 429, Gemini
  RESOURCE_EXHAUSTED, ChatGPT usage_limit_reached and transient transport failures
  can hand off the existing task. Explicit account balance failures skip sibling
  models on that provider; model rate limits skip the affected model.
- Cooldowns use Retry-After when provided (1 second–1 hour), otherwise 5 minutes
  for quota, 1 minute for rate limits, 15 seconds for transient failures. Cooldowns
  are per OpenSI account, shared across its runs, and reset on server restart.
  Recovery is bounded to six handoffs; all candidates exhausted produces an honest
  failure with files preserved. OpenSI's own user quota still stops all calls.
- Tool call/result pairs, saved files and shared handoff notes are retained.
  Partial native changes are inspected before continuing. Recovery never replays
  already executed external actions automatically.
- Lightweight model tiers receive routine planning/build priority. Repair, design,
  research and review retain specialist preferences. Actual token use and active
  requests influence load distribution. These are routing heuristics, not measured
  provider prices or a guarantee of equal token spending.
- Routine routing allows for native CLI startup overhead; a `high` reasoning suffix
  does not turn a Flash model into the strongest planning candidate. Text-only
  native replies finish directly. Native file changes, terminal execution and
  external actions still trigger the final review.
- JEV sees execution metadata only, with a bounded timeout and at most six calls
  per run. Healthy progress is assessed at milestones (four observations) and phase
  changes; failures are assessed immediately within that budget. Its absence does
  not block work. API calls no longer carry duplicate native manifest schemas;
  native CLI still receives them. Specialist advice is limited to 180 words.

Regression coverage includes quota after a real saved write, intact handoff,
provider sibling exclusion across runs, cooldown expiry, native/API transitions,
manual native automatic execution, guided denials, MCP execution, JEV milestones
and Responses error-code propagation.
