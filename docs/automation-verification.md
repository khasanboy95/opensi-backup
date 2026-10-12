# Deploy and API verification — 2026-10-08

- Production package: `opensi-vps-20261008T084904Z.tar.gz`.
- Package SHA-256: `1397fd23bce5a83b669f727cb1262cef5aa25e1e9ee0171bf60bc049cc1d19ca`.
- Updated while idle; no user run was cancelled.
- Frontend build and server checks passed. The general suite passed 132 tests before the final native-manifest test was added. The final automation plus Antigravity targeted suite passed 21 tests, including all 9 automation tests.
- API provider responses for deployment, environment binding, binary upload, status, webhook, access control, redaction, replay protection and native continuation were mocked in automated tests.
- Live GPT-5.6-Luna / Bot va API dasturchisi run `run_2a5f99f6d2d2d771fb258aa7` completed in 15 seconds. It called `integration_catalog`, then wrote `qa-deploy-api.md` (201 bytes): zero integrations, zero deployments, token not connected. No external mutation was requested or performed.
- Production UI: Deploy workspace tab and Ulanishlar → Deploy va API checked. Service forms checked. Mobile viewport 390 × 844 had document width 390; viewport restored afterwards. Captured browser error log was empty.
- Screenshot: `D:/Dastur 1/14/.codex/tmp/opensi-progress-qa/20261008-deploy-api-final.png`.

## Remaining external boundary

No Vercel or Telegram credential was connected for this change. Real Vercel deployment, real Telegram webhook delivery and other providers' real account mutations remain unverified until the user connects credentials. The live model check validates the catalog and file-writing path, not all models or paid external actions.
