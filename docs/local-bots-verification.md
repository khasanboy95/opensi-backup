# File references and local bot runtime — 2026-10-08

Implemented:
- Existing workspace file names in assistant/user Markdown are actionable. `path:line` and `path#Lline` select the exact editor line, including on mobile. Ambiguous basenames and external URLs are not treated as workspace files. Unsaved edits retain the existing save-first guard.
- Telegram tokens provided in a new task are verified with getMe, encrypted per user and replaced with a connection ID/verified username before task persistence or model execution. Existing histories are not rewritten. Other API secrets use the existing protected connection form.
- Local automatic projects can install/test through their paired terminal without repeated command approval. Guided mode and MCP approvals remain.
- `project_service` starts/statuses/stops a managed Node/Python service on the project's own paired local connector. Secrets remain references in stored commands and are hydrated only in that connector's response. Logs redact token values. A running name is not duplicated; a Telegram polling token cannot start a second service on the same connector. The process survives an agent turn, but this is not an OS startup service or an uptime guarantee.
- Telegram deleteWebhook preserves pending updates for a switch to polling.

Evidence:
- `npm run build`, `npm run check`, connector package build passed.
- Full automated suite: **137/137 passed**, `.codex-bot-runtime-full-tests.log`.
- Real temporary Node process served an HTTP health response, returned process status, masked a test secret and stopped. Real paired test connector transported the environment without persisting plaintext. External Telegram validation was mocked; no real Telegram bot messages were sent.
- Desktop and 390×844 browser QA: clicking `bot.mjs:25` selected `// Qator 25`; inline `bot.mjs:40` selected line 40. Mobile switched from chat to the code panel and selected line 25. Captured browser error log empty. Temporary viewport restored.
- Screenshot: `D:/Dastur 1/14/.codex/tmp/opensi-progress-qa/20261008-file-links-local-bots.png`.
- Existing paired Khasan PC connector bundle updated with a backup and started hidden. Server's read-only node metadata confirmed fresh heartbeat at 09:30 UTC. Existing connection credentials were retained.

Deployment:
- Package `opensi-vps-20261008T092930Z.tar.gz`, SHA-256 `edb84f7a02d234c4f617d6163bea4597ae04f0fcca2ea740ec59a242b0b0a6a9`.
- Package uploaded to `/tmp` and extracted to `/opt/opensi`; `opensi-opensi` image built on VPS.
- Built image manifest `sha256:d004f494c27785d150c902265025da7b9bc8b99da0fa5922e035a48d77d41fde`.
- Previous running image retained as `opensi-app:before-bot-runtime-20261008`.
- **Production activated at 2026-10-08 09:53 UTC**, included in concurrency package `opensi-vps-20261008T094331Z.tar.gz`. User explicitly approved immediate restart; two active runs interrupted, queued work and files preserved. Container healthy and public frontend assets confirmed. See `concurrency.md` for image identity and checks. The old pending package was superseded, and deployment automations were removed.
- Real Telegram conversation and live production model → local-service flow remain unverified until an explicitly selected bot test.
