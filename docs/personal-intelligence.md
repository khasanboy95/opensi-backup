# OpenSI persistent personal workspace

`Davomiy suhbat` creates one owner-scoped project and reuses it on subsequent
submissions, including from another authenticated device. Ordinary New task
continues to create an independent project. The persistent project retains its
execution environment; the model may change without moving its files.

Every successful top-level run records a bounded excerpt of its request and
final answer in encrypted per-user settings. At most 40 records are retained;
the six most relevant records (same project, query overlap, recency) and editable
personal notes are supplied to both the API runner and native Antigravity prompt.
These are historical reports, not verified present state or permission. This
does not modify model weights. Settings supports disabling, clearing, and
forgetting individual records. Disabling affects subsequent runs; conversation
history and project files are independent and remain available.

The normal runner loads the latest 60 project messages, repairs incomplete tool
call pairs, and offers `conversation_search` for older owner-scoped messages.
Existing checkpoints, model handoffs, connected-account authorization and tool
approvals remain authoritative. Successful actions must not be replayed from
memory. A process restart preserves records and files but does not promise
automatic continuation of an in-flight external action with unknown outcome.

For local browser work select the online computer in Computer → Browser
environment. The connector uses a separate visible Google Chrome session.
It never silently substitutes Edge or opens the user's ordinary profile.
One OS-owned lock per connector state directory prevents two workers from
claiming commands for the same node. Closing Chrome clears that session's
cookies. Connected API account credentials have their separate vault lifecycle.

On a login/CAPTCHA page the agent enters `waiting_input`, yields control and
releases its execution slot. The user completes login, then presses
`Kirish tugadi — agent davom etsin`. Resume observes a fresh page, rejects a
still-sensitive screen, and continues the same run without replaying its original
action. Website restrictions, account permissions, and provider quotas still
apply. No credentials belong in personal memory or task messages.

Verification: owner-isolation and real runner memory tests in personal.test.mjs;
login, early-resume rejection, and non-replay tests in browser-workflow.test.mjs;
live two-model conversation recall and actual local Chrome page capture.
