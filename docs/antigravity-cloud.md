# Antigravity Bulut

This is an owner-scoped official Antigravity CLI running on the VPS, independent of the owner's Windows PC. It is not a Gemini API-key proxy or a copy of the PC's OAuth tokens.

## Deployment

Build the existing `opensi-runtime:0.10.0` first. Then run `docker compose -p opensi-agy -f compose.antigravity.yaml up -d --build`. This is a separate Compose project; redeploying the OpenSI web app does not interrupt its OAuth/keyring session.

The image installs Google's official Linux CLI with its installer checksum verification. The service has no published ports, Docker socket, host credentials or production application database mount. It runs as UID 1000 with a read-only root, limited memory/CPU/PIDs, dedicated workspace and state volumes. Google tokens use GNOME Keyring over a private D-Bus session. The random keyring unlock secret is private in the service state volume; protect backups of the whole volume as credentials.

Complete Google OAuth interactively in `/opt/agy/agy` in this container, with the actual SSH connection environment passed through. Google's documented remote login flow yields a one-time code that belongs only in the CLI prompt. Do not copy Windows credentials or log the code. Once authenticated, verify `agy models` and one bounded generation before claiming readiness.

Pair the connector with the requested OpenSI owner. The operator helper `deploy/antigravity/pair-owner.mjs` is executed via stdin in the app container with working directory `/app` (`node --input-type=module - <owner-id>`). Pipe its output directly into an atomic, validated write of `/state/connector/connection.json` in the cloud container; stdout contains a credential and must never be logged. It creates an owner-bound node token hash and encrypts the hosted setting with the application vault. The server is the OpenSI origin and workspace is `/workspace`. The service waits for pairing and retries startup without printing credentials. Connector catalog submissions cannot set the server-owned `hosted-antigravity:<nodeId>` flag. Model catalog remains owner scoped and revocation remains effective.

Hosted selection creates cloud projects. Existing cloud projects can continue on this service with scoped file approval; native permission denials are not bypassed. The current bridge has the same bounded text synchronization as other native connectors: 150 files, 500 KB each, 5 MB total. The platform's larger upload storage limit does not imply that every large binary is injected into CLI context.

## Verified 2026-10-08

- Official CLI 1.3.1 installed and starts in the VPS container.
- Private D-Bus and keyring initialize successfully.
- Remote Google OAuth completed for the previously selected owner account. `agy models` returned 14 models from the authenticated server session.
- 115 automated tests passed, including hosted-owner isolation, new cloud project routing, scoped approval and returned native files.
- The user explicitly approved the CLI terms; optional Interactions data sharing was unchecked before Done. The CLI then opened the authenticated Google AI Pro account.
- Dedicated node `node_96ace3622bc6bbd574a6fad1` is paired with the requested owner. The first provisioning attempt wrote a plaintext hosted flag; it was immediately corrected to vault encryption and the helper was fixed. Authenticated OpenSI bootstrap and model selection then worked.
- Live Gemini 3.8 Flash High run `run_654fd5d3101bbf9d001c5b30` completed with no error. It created a real 2298-byte `index.html`, including the requested heading and mobile viewport, in cloud project `prj_70b9896e9bfa4371b087825b`. The personal PC node was offline throughout.
- Restarted the dedicated cloud container after confirming no active tasks. Keyring login persisted, the official CLI returned 14 models again, and connector heartbeat resumed without another login.
- After that restart, run `run_572581dfc35737b95f8368b0` was submitted and approved from a 390x844 mobile browser viewport. It completed and persisted the requested edit in the same cloud HTML. Both its synchronization and CLI commands were handled only by the dedicated cloud node; the personal PC remained offline.
- Final frontend build and all 12 Antigravity-specific tests passed. Final UI package: `opensi-vps-20261008T035917Z.tar.gz`, SHA-256 `f8c51b1d39332cd5a6fb65389d0029e55dfdcc21317965c81151f3956da565cc`.
- Catalog availability is not a claim that all 14 models were individually generation-tested. Provider account quotas and CLI permissions remain in effect.

Official references: https://www.antigravity.google/docs/cli/install/ and https://www.antigravity.google/docs/cli/headless/ .
