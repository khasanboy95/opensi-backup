# Document workspace verification — 2026-10-08

Production: https://opensi.23-252-124-21.sslip.io/#/documents

Final source package: `opensi-vps-20261008T053614Z.tar.gz`

SHA-256: `7b14951387c46879003b3fa3e5225afff1555570edc20c1be6c374a0f9f8b2e8`

- JavaScript/TypeScript checks and Vite production build passed.
- Full suite: **124 passed, 0 failed** (`.codex-documents-tests.log`).
- Real isolated server conversions passed: DOCX/PPTX/XLSX/HTML/Markdown/PNG → PDF; HTML → DOCX; DOCX → ODT/RTF/TXT; XLSX → ODS/CSV; PPTX → ODP.
- The HTML → DOCX test initially exposed a missing LibreOffice filter; explicit format filters fixed it and the rerun produced a valid DOCX. This fix is in the final document runtime image.
- PDF.js extracted text from the real outputs. The two-page HTML test retained `SECOND_PAGE_OK` on page 2.
- Authenticated dashboard conversion used the real private runner and opened a two-page PDF in the page viewer. Next-page navigation worked.
- Browser download produced `C:\Users\LAPTOP\Downloads\document-e93004b3061abd820bc93281.pdf`; local parsing confirmed both pages and the second-page marker.
- A 390×844 browser viewport completed the Creative Studio → Gemini 3.8 Flash (Low) → native source synchronization → DOCX/TXT/MD/PDF flow. Run `run_2915192586d326742299c41a`, project `prj_4e555b656ea34435c7747b6d`, completed in about 49 seconds including the project approval wait. Hosted Antigravity was used; the personal PC connector remained offline.
- The resulting PDF was `exports/document-cdd873bde585514960e17d4a.pdf`. Downloading Word produced `C:\Users\LAPTOP\Downloads\document (1).docx`; ZIP/XML inspection confirmed the title and second section.
- The app/runner were restarted only after the active-task count reached zero. No user task was deliberately cancelled.

Proof images are in `D:\Dastur 1\14\.codex\tmp\opensi-progress-qa\`, with names beginning `20261008-documents-` and `20261008-gemini-document-`.

Limits remain explicit: 1 GB uploads/downloads; 50 MB conversion/preview, 110-second conversion timeout; unsupported formats are download-only. Tests do not establish pixel-perfect fidelity for every possible Office file, all provider accounts/models, encrypted documents, OCR or arbitrary formats.
