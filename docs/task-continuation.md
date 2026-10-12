# Task continuation and reconnect

`POST /api/runs/:runId/resume` continues the owned, unfinished run in the
original project. It does not create another run, duplicate the original user
prompt, reset files or change the model/environment from the composer. Repeated
clicks return the already active run. Another active run in the same project,
foreign accounts, completed tasks and disabled users are rejected.

Stop followed immediately by Continue is accepted even while the old execution
is closing its tools and workers. The continuation waits for that cleanup and
then starts exactly once in the same run. A second Stop cancels the pending
continuation. No original prompt or completed work is recreated.

Prepared parallel drafts and completed integrations keep their state. Stopping
during review preserves the main result and resumes only unfinished integration;
completed drafts are not prepared or applied again.

The runner retains the existing transcript, tool results, plan, drafts and native
Antigravity conversation. An encrypted checkpoint records verified actions and
native conversation metadata. Linked local projects retain fingerprints and
result metadata instead of source files or terminal contents. Repeated completed
edits are suppressed on continuation; code changes invalidate old terminal test
evidence. Unknown outcomes require inspecting the actual state before proceeding.

Transient provider/transport failures automatically reconnect with bounded
backoff. Local commands wait without spending model tokens while their connector
is offline, then receive the original result. The connector journals results on
its own machine before delivery and retries lost acknowledgements. The server
acknowledges duplicate deliveries without overwriting the first result. A
connector killed during execution reports an unknown outcome instead of
replaying a command.

New in-progress tasks resume after a gateway restart. Explicit user cancellation,
permission denial and login/approval waits do not automatically resume. Provider
authentication, quota or persistent errors still need a real fix. Browser SSE
reconnects and refreshes the existing task; it never submits the prompt again.

Deploy both the web gateway and connector bundle, including the hosted
Antigravity image. Updating only the gateway cannot fix lost connector results.
