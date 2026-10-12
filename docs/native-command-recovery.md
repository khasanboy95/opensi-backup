# Native terminal continuation

Antigravity CLI 1.3.x can report several unexecuted `run_command` steps as
`DONE` without output and summarize them as one denied `command` action.
The connector now retains all terminal step identities and merges partial
updates without losing the command, working directory or execution output.

Only terminal steps with a confirmed soft denial and no execution output are
forwarded to OpenSI. Active/unfinished steps, policy errors, already executed
commands and paths outside the selected workspace are excluded. Duplicate
command/directory pairs are collapsed; up to twelve requests can be bridged
per native round. Explicit CLI settings denials still stop execution.

OpenSI's existing project policy controls each bridged command. Automatic
projects run them without another confirmation. Guided projects wait for
approval. Actual output is returned to the same native conversation, preserving
usage accounting. Commands already executed in that task are never replayed.

Updated connectors advertise `native_command_bridge_v2`. Both the downloadable
desktop connector and the dedicated hosted Antigravity image must be updated;
updating only the web application leaves old connector behavior unchanged.

## CLI failures and model limits

Exit code `3` is not an authentication or permission diagnosis. The connector
classifies the CLI's structured `AGY_ERROR` and final result locally. Raw stderr,
tokens and arbitrary diagnostic text are never sent to the server. Quota,
rate-limit, temporary-service, authentication and permission failures remain
distinct, with bounded provider reset metadata when supplied by the CLI.

An automatic model-team task keeps partial files, conversation and actual usage
before handing quota/service failures to another available model. The exhausted
model is excluded for its real reset interval (up to 24 hours). Other models in
the same account stay eligible unless an account-wide quota is explicitly known.
Authentication, permission and user cancellation still stop the affected action.
An explicitly selected single model reports its own limit rather than silently
substituting another account or model. Updated connectors advertise
`native_diagnostics_v1`.
