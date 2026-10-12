# ZCode account connection

OpenSI invokes `login --json --no-browser` from the **official ZCode CLI** in a
private server home. The CLI handles OAuth and obtains the account's individual
Coding Plan API credential. The OpenSI adapter reads only that API credential in
place, decodes its official `enc:v1` records in memory using the same CLI home
and OS user, and sends requests to the documented Z.ai Coding API endpoint:
`https://api.z.ai/api/coding/paas/v4/chat/completions`.
It does not extract browser sessions, fake account permissions, use private
desktop Start Plan APIs or switch to the separately billed general API endpoint.

The owner opens **Ulanishlar → API provayderlari → ZCode → Z.ai hisobiga kirish**
and follows the official authorization link. Only the platform owner manages
this connection. Google users can use the shared models after a successful
model response. They cannot read the account identity, authorization URL or
credentials. Sharing can be revoked immediately.

Account login and usable model access are separate states. Candidate model IDs
come from the official CLI's individual Z.ai Coding Plan catalog. OpenSI sends
a small actual model request before enabling them in the public model selector
or automatic team. A successful login with no API resource package remains
**Hisob kirgan · Model hali ishlamadi** with an explicit quota/plan diagnostic.
The `1113` insufficient balance/resource package response does not grant access.
ZCode desktop Start Plan trials are not a promise of free CLI/API access.

Use **Saqlangan hisobni tekshirish** to restore an existing official CLI login,
or **Javobni tekshirish** after changing the account's plan/quota. Neither action
requires sharing a password in chat. OpenSI never purchases a plan automatically.

## Private server runtime

Install these files from the official signed desktop installer under
`DATA_DIR/zcode/runtime/`:

```
zcode.cjs
provider/zcode-builtin.json
```

The deployed installer version is 3.14.5 (CLI 0.16.9). Obtain it from the download
links at https://zcode.z.ai/en/docs/install and verify its Windows signature.
Extract `resources/glm/zcode.cjs` and
`resources/config/provider/zcode-builtin.json`. Do not include these vendor files
or account credentials in public OpenSI connector/release archives.

The service uses `DATA_DIR/zcode/account` as the private CLI home and an empty
gateway workspace. Its environment contains no OpenSI provider keys. No user
project is opened in the CLI. OAuth credentials and the issued API key remain
in that private data volume; they never enter the client, project files, usage
records or logs. Disconnect revokes local access first and runs official CLI
`logout` to remove its saved login.

## Tools, routing and boundaries

The documented OpenAI-compatible API receives the current conversation and
OpenSI tool schemas. Structured calls return to OpenSI's existing agent loop;
files, terminal, browser, approvals, checkpoints and parallel drafts use the
same execution path as other API providers. The CLI has no independent access
to user project files or shell commands.

Only models with a verified account response participate in automatic planning,
coding, repair and review. The shared account has a bounded, user-fair request
pool and account-wide quota cooldown. Usage is recorded against the requesting
OpenSI user. In automatic mode an exhausted Z.ai account hands the current
conversation and saved tool results to another connected provider, preserving
completed file writes. Authentication/permission failures remain explicit.

This adapter supports **text and tool calls**. It rejects images explicitly;
automatic routing uses another connected vision model for image conversations.
Raw provider errors are replaced with fixed diagnostics. Model text streams to
the OpenSI activity view; reasoning text is not exposed as fabricated progress.

Tests cover HTTP streaming, real runner file writes, tool identity preservation,
cancellation, owner-only activation, shared-user access/revocation, failed quota
activation and automatic handoff without repeated saved tools. Fixture tests
prove the integration behavior; only a successful live account response proves
external entitlement and quota.

Official references:
- https://zcode.z.ai/en/docs/configuration
- https://docs.z.ai/devpack/overview
- https://zcode.z.ai/en/docs/qa
