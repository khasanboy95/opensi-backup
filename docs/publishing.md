# OpenSI Publish

Workspace header → Publish (also available in Deploy). Choose an HTML entry, review the explicit file list and public-sharing checkbox, then publish. A stable `/p/<random 128-bit slug>/` link works without a login or an online local connector. Updates replace the snapshot; source edits alone do not publish. Closing a publication immediately revokes its URL; publishing again creates a new URL.

Only selected static files beneath the HTML directory are copied. `dist/index.html` is preferred. Native and browser-folder projects use the existing paginated list_files and preview_file connector commands. Original projects remain in place. An offline connector prevents updates, but existing publication management stays available.

Limits: 1,000 files, 5 MB/file, 25 MB/publication, 100 MB/account; four concurrent publications and a disk free-space reserve. Failed updates retain the old snapshot. Successful updates remove its previous files. Publishing is serialized per account. Snapshot metadata is in publications SQLite table; content in data/publications/<revision> (include both in backups). A process crash during copy can leave an unreferenced revision directory; operators can identify it by comparing revisions to the database before cleanup.

Every published active document gets CSP sandbox without allow-same-origin, including direct top-level navigation. Script/style/connect sources are confined to the publication path; no authenticated OpenSI API access or forms. CORS is public and never credentialed. Source code, dotfiles, config, credentials, server/API directories and source maps are excluded; known credential patterns are rejected. Users still review the public file list: automated filtering cannot identify every private datum.

This is static hosting. No server processes, external API calls, CDN scripts, persistent browser storage, service workers or authentication. Images may load from HTTPS. Bundle dependencies into the published output. Use Vercel deployment for full-stack applications. HTML nested pages and root-relative bundle assets are rebased into the publication URL; hash-based client routing is supported, arbitrary SPA server rewrites are not.

Tests: node --test tests/publishing.test.mjs. Verify actual browser CSS, module JavaScript, local JSON fetch, nested navigation and sandbox behavior after deployment.
