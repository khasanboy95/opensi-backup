# Parallel requests in one project

The workspace composer stays available while a run is active. Enter or the up
arrow submits an additional request without navigating away. The square still
stops the main run. Parallel cards show the actual assigned model, preparation,
ready draft, integration, completion or repair state. A single draft can be
cancelled before integration begins.

`POST /api/runs/:runId/parallel` accepts `prompt`, an idempotent `requestId`, and
optional owned `attachmentIds`. Ownership, model access, account quotas and
attachment limits remain enforced. Requests belong to the existing run and do
not consume another top-level project slot. Three preparations per user run
concurrently by default; further preparations wait for preparation capacity,
not for the main task to finish. Up to 100 unfinished additions can be accepted
in a run. This is bounded parallelism, not unlimited provider throughput.

Workers implement actual file changes in separate snapshots. API and ChatGPT
workers have scratch file tools and, in automatic mode, scratch terminal tests.
Local Antigravity uses its own private scratch directory. Hosted Antigravity
can prepare cloud tasks using a bounded 5 MB / 300-file bridge. It requires an
updated connector advertising `parallel_workspace_v1`. It does not receive
deployment/account tools. Provider limits and technical errors use eligible
model fallback; repeated tool failures go to another model or to the final
coordinator with saved work intact.

The main model continues independently. After it finishes, nonconflicting
changes are applied using original-content hashes. Overlapping edits remain
conflicts until an API/ChatGPT coordinator reads base, proposed and current
content and resolves them using a fresh current hash. Long comparisons are
paged. Binary conflicts can preserve the current or proposed version. A stale
hash fails rather than overwriting a newer edit. The coordinator verifies the
combined result using ordinary project tools and calls `parallel_finish` for
each request. An unresolved conflict or failed latest terminal/browser check
prevents completion. Preparation summaries are claims to verify, not proof of
tests. A new addition arriving during integration is included in the next
integration pass before the run can become complete.

Parallel task metadata is persisted in SQLite; cloud model history is encrypted.
Local source copies, CLI conversations and comparisons stay on the connector;
source bytes sent to an active API request are removed from server command
receipts after use. Parallel inventories are separate from ZIP exports: they
index up to 100,000 source files, pruning dependency/cache and private paths
before counting. Large projects initially copy only a small source subset;
`list_files` paginates the full local index and marks on-demand files. Reading
or editing such a file captures its original bytes and hash before changing
the scratch. Files that were never materialized are never treated as deletions.
`prepare_files` materializes a selected project subfolder before scratch tests.
Copies stay bounded to 64 MB (16 MB per file); large assets remain in the
original, and a narrower subproject can be prepared independently. Native CLI
workers require a fully materialized snapshot; partial source trees use API or
ChatGPT file tools. A setup failure is retried once per continuation, preserving
the same task and any saved scratch edits, including older export-limit failures.
Successful integration removes scratch copies. Interrupted or cancelled parent
runs retain scratch work for the existing same-run continuation flow.

Connector polling supports four independent in-flight commands. A main project
and each scratch task retain separate serial command lanes. The durable result
outbox skips currently running commands when restoring undelivered results;
an in-flight command is never mistaken for a crashed connector command.

Verification: `node --test tests/parallel.test.mjs` exercises real simultaneous
provider requests, source isolation, conflict resolution, stale-hash protection,
idempotent submission, ownership, cancellation, late additions and a real local
connector doing scratch I/O while a terminal process remains active.
