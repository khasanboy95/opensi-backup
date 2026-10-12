# Existing local projects by path

In **Mavjud papkani ulash**, select an online computer, browse its disks and directories, then press **Shu loyihani davom ettirish**. You can also paste an absolute directory path and press **Ochish**. The first online personal computer is selected automatically. The updated connector advertises `folder_path_v1` and `folder_browse_v1`; hosted Antigravity nodes and browser-only nodes are excluded. Offline status refreshes every eight seconds.

`POST /api/projects/browse-folders` is human-only and owner-isolated. The connector lists real drives, home/workspace shortcuts and still-existing linked folders. Each directory page contains at most 200 child directories; further pages are explicit. Folder paths and project marker filenames are transient response metadata, never source file contents or persisted commands. Heartbeats carry folder requests independently of a running model/terminal command so navigation does not wait for an agent task to finish.

On the new-task screen, a path on the first line (for example `D:\Dastur 1\14`) links and opens that folder. Further lines become the task to run in that project. A path by itself opens the project without using a model. Existing workspace messages never silently change the project root.

The authenticated human-only `/api/projects/link-path` request is relayed in memory to the owner's connector. The connector resolves the exact directory, checks it exists, reuses its canonical registered source or atomically updates the local `folders.json`, and publishes only source ID and label. Paths with spaces, Unicode and surrounding double quotes are supported. Relative paths, network/device paths and files are rejected. No recursive directory discovery or source upload is performed.

An existing source reopens the same project and history. Normal linked-project tools read and edit files in place. Necessary file contents still go to the selected AI provider while processing the task. The computer and connector must be online, including when controlling the project from a phone. A phone browser cannot execute PC tools on its own.

Path requests are owner-isolated, bounded, expire when the connector does not answer, and are never model tools or persisted command payloads. Missing paths and disconnected/old connectors return actionable errors instead of creating empty cloud projects.
