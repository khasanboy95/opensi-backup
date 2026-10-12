# OpenSI 0.7 verification — 2026-10-07

## Automated verification

- `npm run check` and `npm run build`: passed.
- `npm test`: 75 tests passed, zero failures, including binary uploads, document extraction, ZIP traversal rejection, local connector chunking, automatic browser handoff, JEV wire contract and folder delivery.
- Connector bundle executes its usage entry point; Windows launcher parses successfully.

## Production verification

- HTTPS health reports OpenSI 0.7.0; connector ZIP downloads with a valid ZIP signature.
- Real `gpt-5.6-luna` run `run_d94c37323cad021d82523343` completed in 65 seconds: JEV decision, cloud browser navigation, cloud terminal command, file writing and browser test. No approval rows were created for this run.
- Real JEV response reports `jev-1.13.0`. Key stays server-side.
- Explicit browser-test directory `.` initially failed. Fixed the runtime path normalization, rebuilt the production runtime image and verified real Chromium output with no page errors.
- Desktop screenshot: `D:/Dastur 1/14/.codex/tmp/opensi-progress-qa/opensi-070-agent-live.png`.
- Mobile screenshot: `D:/Dastur 1/14/.codex/tmp/opensi-progress-qa/opensi-070-mobile.png`; measured viewport and document width both 433 CSS pixels, no horizontal overflow.
- Clipboard screenshot attachment and attachment-only task submission verified in an isolated browser QA instance.

## Verification boundaries

- Native Windows folder selection and physical phone delivery were not exercised end to end. Directory writes and permission recovery have automated filesystem-handle tests; ZIP bytes were verified at the API boundary.
- Browser extension file URL permission prevented automated native file chooser upload. Multi-file uploads were verified over authenticated HTTP; clipboard upload was verified in the browser.
- Cloud computer means an isolated Chromium browser. It does not control native Windows, Android or iOS apps.
- The 65-second result describes one test, not a speed guarantee for arbitrary tasks.
