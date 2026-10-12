# Interrupted tool-history recovery — 2026-10-08

## Confirmed incident

Production run `run_86fb18e522c1ee04df9b7912` failed at the first automatic-model request with `No tool output found for function call`. Its preceding run had persisted an assistant message with 16 calls, then the runner's 12-call guard threw before writing any results. Continuing the project sent those unmatched calls to GPT-5.6-Sol.

## Fix

- `server/history.mjs` closes interrupted call groups with explicit unknown-execution results before the next conversational message. It retains real results, preserves orphaned output as labeled historical data, and remaps duplicate call IDs with their corresponding outputs. It never executes a tool or edits audit records.
- Both Responses/ChatGPT and Chat Completions normalize history at the outbound boundary. The runner also repairs loaded history and emits a recovery notice. Truncating the last 60 messages no longer discards the whole context when the retained window contains no user message.
- Large batches execute at most 12 calls per step. Remaining calls receive explicit not-executed results and can be requested in a later smaller batch. The runner no longer exits with an unmatched batch solely because it contains more than 12 calls.
- Invalid file-tool arguments no longer crash progress reporting before the validation result can be recorded. Existing approval and tool authorization checks remain unchanged.

## Verification

- 120/120 automated tests passed, including five regression tests for interrupted calls, truncation, reused IDs, 16-call execution/remainder handling, and persisted-history continuation. Syntax/type checks and frontend build passed.
- Deployed `opensi-vps-20261008T040709Z.tar.gz`, SHA-256 `a7d45c44497b14f8a8f6910a1a8d05582049631488a3eba9df97a425ad7ac182`, after confirming no active runs.
- Real GPT-5.6-Sol validation used the incident's original 26-call history, including its 16 missing outputs. All 26 calls had matching outputs after repair; the model returned `OPENSI_HISTORY_OK`. No tools were executed and the original message audit was byte-for-byte unchanged. Actual provider usage was recorded against the incident run.
- This verifies transport recovery, not completion of the user's original website-cloning project. The original failed run remains a historical record; Retry/new continuation uses repaired context and preserved project files.
- External provider outages, account quotas and unsupported permissions remain possible; these checks are not a guarantee of universal error-free execution.
