# Linked workspaces

Projects → **Mavjud papkani ulash** links an existing folder. ZIP import remains an explicitly labeled cloud-copy option.

- Computer: run the connector and `Link-Folder.ps1` to register a folder locally. Select its name in OpenSI. Source paths stay in the connector's `folders.json`; the server receives opaque IDs and labels. Commands resolve only locally registered IDs. All source changes go directly to that folder.
- Browser: select a read/write directory using File System Access. The handle and connector credential remain in this browser's IndexedDB and are separated by OpenSI user. Keep the tab open. Re-select the folder after a permission reset. Web Locks prevent two tabs from executing the same folder queue simultaneously. File editing and static preview are available; OS commands require a computer connector.
- Phone: use an online paired computer from the same account. Browsers without File System Access cannot directly link phone storage. This is not an offline execution system.

Linked project file routes never fall back to cloud copies. Preview assets are read on demand through the connector and held in memory. Command arguments/results are cleared after consumption, file versions and streamed code drafts are not persisted in server storage. Required source excerpts are sent to the selected model during the active request. Conversation text, project context and bounded operation logs remain server-side.

Existing projects keep their IDs, conversation and context. Before removing an old cloud snapshot, download a backup, verify every file hash and reject unbacked/new files. Never remove local originals or unrelated cloud services. The 2026-10-09 migration backed up 18 projects (4,842 files) to `D:\OpenSI Projects\Cloud backups\20261009` before switching their references and clearing the duplicate cloud workspace files. Small document projects use the consolidated local backup as their working folder to retain all generated outputs.

Verification: connector HTTP read/write into the original folder, model tool execution, no workspace copies, ephemeral command payloads, owner isolation, unapproved source rejection, offline failure, browser file-handle operations/traversal rejection, production local preview and responsive UI. A real browser folder permission-picker flow requires the user to grant access; file-handle tests do not establish support on every mobile browser.


## Direct local attachments (2026-10-09)

For a local environment, drop/paste sends bytes only to the paired device's authenticated loopback bridge. The Windows native picker registers an original path in the connector's private registry, without uploading the file. Before execution, a local working copy is prepared under the project's inputs folder. Browser-linked folders write directly through the selected directory handle. Server attachment rows retain only owner/node, name, MIME and size; they never store these source bytes in the library. Needed excerpts or images still go to the chosen model.

The bridge binds only 127.0.0.1 on an ephemeral port, requires the exact OpenSI Origin/Host and a short-lived owner/node ticket checked by the server, including revoked/disabled status. A different browser device cannot connect to another computer's loopback. It must use its own browser folder or explicitly use cloud uploads; failure never silently switches to cloud storage. The library button is explicitly a cloud library.

Windows: Connections > local connector > Windows kompyuterga ulash generates an account-specific, one-use installer (10-minute pairing expiry). The installer verifies a pinned official Node.js binary hash, asks for the workspace, pairs, starts hidden, and offers Windows startup. Existing connector ZIP remains available for macOS/Linux. No platform silently gains filesystem access before a local user selects a folder/installs the connector.

Astra model IDs are filtered from non-owner catalogs and automatic candidates and rejected at provider resolution; access is limited to khasandjemilov@gmail.com, not every administrator. There is no quota/provider bypass.
