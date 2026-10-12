# Concurrent OpenSI users

The old global limit was two runs, including runs waiting for human input. The API now defaults to 100 orchestration slots, up to three per user. Human approval/input releases a slot; answering rejoins admission before executing. Different owners rotate when capacity is full. Cancelled waiters never execute; shutdown preserves queued work that has not started.

Settings: `OPENSI_MAX_CONCURRENT=100`, `OPENSI_MAX_CONCURRENT_PER_USER=3`, `OPENSI_MAX_CONCURRENT_SHELLS=2`. Values must be integers from 1 to 1000. A project still has one editing run at a time. Admission is process-local: run one API process with this SQLite deployment; multiple replicas require a distributed queue and shared transactional ownership first.

Authenticated HTTP limits are per validated user or connector, not the shared Wi-Fi/NAT address. Anonymous traffic retains IP limits. Admin `/api/admin/overview` includes `capacity` with executing, queued, waitingForUser, limit and perUser counts.

The 4 GB / 2 CPU server has two isolated execution sandboxes. Cloud commands wait in an abortable pool before their execution timeout starts, instead of failing with `Runner busy`. Commands to each serial native connector also wait before dispatch/timeout. Separate connectors can execute concurrently. Increasing shell concurrency requires changing the broker capacity and provisioning RAM/CPU. Live browser session capacity is separate and unchanged.

Validation: `node --test tests/concurrency.test.mjs` launches 100 authenticated users, holds 100 model HTTP streams concurrently, opens 100 authorized SSE subscriptions, verifies ownership isolation, then checks 100 completions. It also checks approval slot release/reacquisition, cancellation, shutdown persistence and 20 shell calls capped at two. These use a mock provider, not 100 paid model sessions. Provider rate limits, subscription capacity and real long-context memory usage remain external constraints; 100 orchestration slots do not mean 100 simultaneous Chromium instances or native CLI jobs.

Deployment must wait for the existing production runs and document jobs to finish. Do not cancel user work to apply this update.

## Verified on 2026-10-08

- Full local suite: 142 passed, zero failures; syntax/type check and production frontend build passed.
- VPS isolated container, built production image, no production data mount and no external network: all five concurrency tests passed. 100 concurrent mocked model streams, 100 SSE subscriptions, 100 completed runs; measured workload 8.56 seconds, Node RSS 149 MB. Container capped at 384 MB and 0.5 CPU.
- Package `opensi-vps-20261008T094331Z.tar.gz`, SHA-256 `9b51f36246e5f72d0a136c72895db58636974f160d08f45d14f5f37d399693f7`, built manifest `sha256:fee72300ff2a360e24821149b72899ff24b7e341ee901fbddb31f21dd417b919`.
- This image also includes the previously tested composer resize and local bot/file-reference changes.

## Production activated

At 2026-10-08 09:53 UTC the user explicitly approved updating immediately with active work interrupted. A consistent SQLite backup was saved under the existing data volume with mode 0600 before recreation. The existing `opensi_opensi-data` volume was retained. Two in-progress runs were marked interrupted; pending runs were preserved.

The running image matches `sha256:fee72300ff2a360e24821149b72899ff24b7e341ee901fbddb31f21dd417b919`. Runtime configuration verified: 100 orchestration slots, three per user, two shell slots. Container healthy, public health endpoint OK, public frontend `index-D7rJDpFC.js`/`index-CV-fnqEe.css`. Follow-up DB inspection showed zero queued runs and four running concurrently, including the user's `mimo-v2.6-pro` run `run_f9eadd4752afafec1c3391cc`. App memory at that snapshot was 154.7 MiB of 768 MiB. The pending deployment automation was deleted.
