# OpenSI 0.6.0 imkoniyatlari

Amaldagi imkoniyatlar:

- Kompyuter: loyiha uchun vaqtinchalik alohida Chromium, jonli ekran, label/required/checked/option bilan forma maydonlarini ko‘rish, navigate/click/fill/check/uncheck/select/submit/press/scroll/back/reload, foydalanuvchi-agent boshqaruvi va tarmoq yuborish so‘rovlarini ko‘rib chiqish. Aniq yuborish topshirig‘ida submit amali joriy saytga bitta oddiy so‘rovga qisqa ruxsat beradi; boshqa manzil va himoyalangan amallar tasdiq kutadi. Windows ish stolini boshqarmaydi. WebSocket, upload/download va saqlanadigan parol ombori yo‘q.
- Panellar: saqlanadigan tezkor topshiriqlar va model tanlovi; haqiqiy vazifani boshlash; mavjud loyiha mini-ilovalarini sandbox preview bilan pin qilish. Hark qiyoslash va texnik chegaralar: docs/hark-comparison.md.


- Kutubxona: shaxsiy matn, kod, hujjat, rasm, audio va video fayllarni yuklash, nom/to‘plam bo‘yicha qidirish, preview, yuklab olish, chiqindi qutisi va tiklash. Bulut loyihalariga nusxalash, loyiha natijasini kutubxonaga saqlash, matn/rasmni suhbatga qayta biriktirish.
- Ish oqimlari: 1–12 ta tartiblangan bosqich, har bosqichga model va agent, {{input}} parametri, bosqichlar orasida qo‘lda tekshirish tanaffusi, saqlash/tahrirlash/nusxalash/arxivlash, alohida bajarilish tarixi. Barcha bosqichlar bitta bulut loyihasidan foydalanadi; xato keyingi bosqichni to‘xtatadi. Davom ettirish yoki xato bosqichni qayta bajarish foydalanuvchi amali. Qayta ishga tushish avtomatik takroriy model sarfini keltirmaydi.
- Loyiha nomi, doimiy ko‘rsatmalari va qo‘lda boshqariladigan xotirasi; keyingi agent chaqiruvlariga uzatiladi.
- Media studiya: katalogda mavjud Mimo TTS, VoiceDesign, rozilik belgisi bilan VoiceClone va ASR uchun native chat/completions adapteri. Natija haqiqiy WAV yoki transkript bo‘lib kutubxonaga saqlanadi. Bekor qilish, vaqt chegarasi, idempotency, egaga bog‘langan tarix va API bergan token sarfi. ASR ingliz/xitoy tillari uchun; boshqa til aniqligi va mavjud tarifda model ishlashi kafolatlanmaydi.
- Agentlar library_search, library_import, library_save, media_catalog va create_media orqali shu imkoniyatlardan foydalanadi. Ovoz klonlash faqat Media studiya orqali foydalanuvchining rozilik belgisi bilan; agent vositasida yo‘q.
- Suhbatdagi binary upload fayli 50 MB gacha; kutubxonaning eski JSON/base64 upload yo‘li kichik fayllar uchun. Jami har foydalanuvchiga 200 MB/1000 fayl, server bo‘yicha 1 GB; chiqindi ham hajmga kiradi. Media manba audio 7 MB, matn 4000 belgi, so‘rov 180 soniya, serverda 2 ta va foydalanuvchida 1 ta media vazifasi bir vaqtda.
- Magica Flow bilan to‘liq tenglik da’vo qilinmaydi: ushbu oqim ketma-ket agent bosqichlari uchun; branch/loop visual graph, scheduler, tashqi app OAuth va jamoaviy loyiha huquqlari mavjud emas. Magica kod/aktivlari ko‘chirilmagan.
- Mavjud API’larda rasm/video generatori ulanmagan; Mimo TTS qo‘shiq uslubini qabul qilishi to‘liq musiqa/video generatori degani emas. Bularni ishlatish uchun tegishli media provider kerak.

- Gmail orqali kirish; admin panelda hisoblar, loginlar, model va token sarfi.
- OpenAI-compatible Chat Completions va Responses provayderlari; model tanlash, foydalanuvchi limiti.
- ChatGPT plan OAuth ulanishi: kompyuterda bir martalik loopback kirish, shaxsiy serverda shifrlangan hisoblar, avtomatik token yangilash, haqiqiy /models katalogi, Responses va OpenSI agent vositalari. Ulanishlar bo‘limidan boshlanadi; Node.js 24+ kerak.
- Har ChatGPT ro‘yxati alohida foydalanuvchi/klient/identifikatorga bog‘lanadi; standart holatda shaxsiy. Administrator o‘z ulanishini barcha faol Google foydalanuvchilariga ochishi mumkin. Ularga faqat modelda so‘rov bajarish huquqi beriladi; OAuth tokenlari, hisobni boshqarish va boshqa foydalanuvchining loyiha/chatlari ochilmaydi. Umumiy model sarfi so‘rov yuborgan foydalanuvchiga yoziladi; hisobning haqiqiy ChatGPT limiti umumiy bo‘ladi. Google orqali mavjud OpenSI hisobiga kirib keyin ChatGPT hisobini bog‘lash talab qilinadi.
- Agentlar, bir darajali delegatsiya, MCP ulanishlari va tasdiqlanadigan amallar.
- Bulut va juftlangan lokal connector; matn fayllari, terminal, to‘xtatish, davom ettirish.
- Jonli amallar, kod, terminal chiqishi, reja, SSE qayta ulanishi va qoralamani tiklash.
- Fayl qidirish, qismlab o‘qish, yozish, aniq tahrirlash, nusxalash; bulutda ko‘chirish/o‘chirish.
- React/Vite build, Node, Python va Git buyruqlari alohida cheklangan konteynerda.
- Chromium bilan desktop/mobile tekshiruvi: click/fill/press/visible, konsol, overflow, screenshot.
- HTML yoki dist preview, qo‘lda kod tahriri, versiyalar farqi va tiklash, ZIP eksport.
- AGENTS.md loyiha ko‘rsatmalarini o‘qish uchun agent ko‘rsatmasi.

Aniq chegaralar:

- ChatGPT tarif/ilova limitlari saqlanadi; OpenSI cheksiz kvotasi ularni bekor qilmaydi. Model katalogi inference ishlashiga kafolat emas; faqat tugallangan haqiqiy javob tekshiruvni tasdiqlaydi. Ruxsat, tarif yoki hududga bog‘liq rad javobi ochiq ko‘rsatiladi.
- To‘g‘ridan-to‘g‘ri saytdagi ChatGPT identity login alohida OpenAI tomonidan tasdiqlangan web klient talab qiladi. Ushbu shaxsiy VM ulanishi rasmiy lokal OAuth + himoyalangan credential transfer oqimidir; birinchi kirish telefondagi loopback orqali amalga oshirilmaydi.
- ChatGPT plan preview orqali hosted image generation, audio/transcription, file search, native computer use va hosted MCP berilmaydi. OpenSI o‘z fayl/terminal/browser/MCP vositalarini function namespace orqali bajaradi. Bu Codex dasturining barcha imkoniyatlarini avtomatik bermaydi.

ChatGPT ulanishi: Ulanishlar → Continue with ChatGPT → yordamchini yuklash → ko‘rsatilgan buyruq → terminaldagi lokal havola → OpenAI tasdig‘i. OAuth access/refresh/ID tokenlari brauzer saqlagichiga yoki terminalga yozilmaydi. Serverga HTTPS orqali bir martalik ticket bilan uzatiladi; VPS shifrlangan SQLite ombori keyingi refreshlarni boshqaradi. Ulanishni uzish refresh sessiyani bekor qilishga urinadi va mahalliy tokenlarni o‘chiradi; remote bekor qilish tasdiqlanmasa UI xabar beradi. OAuth klient mappingi qayta kirish uchun saqlanadi.

Rasmiy shartnoma: https://developers.openai.com/siwc/token-sharing-open-source/sign-in va https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms (2026-10-07 tekshirildi).

- Codex/v0 bilan barcha funksiyalar tengligi da’vo qilinmaydi. Xususiy GitHub OAuth, PR/worktree UI, Vercel deploy, ma’lumotlar bazasi provisioning, real-time jamoaviy tahrir, rejalashtirilgan avtomatlar, visual element editing va native ilova bu versiyada yo‘q.
- Bulut terminali internetga chiqmaydi; React 19, Vite 7, TypeScript, Lucide oldindan o‘rnatilgan. Boshqa paketlar o‘rnatish yoki internet talab qiladigan backend ishlari uchun lokal connector yoki qo‘shimcha runner sozlash kerak.
- Har buyruq 110 soniya, 1 CPU, 768 MB RAM bilan cheklangan; bir vaqtda ko‘pi bilan 2 sandbox. Doimiy server jarayoni keyingi buyruqqa saqlanmaydi, fayllar saqlanadi.
- Brauzer testi loyiha statik natijasini tekshiradi. Tashqi API va resurslar bloklanadi va hisobotda ko‘rsatiladi. Bu barcha foydalanuvchi oqimlari yoki real tashqi integratsiya ishlashini isbotlamaydi.
- Versiyalar har fayl uchun 12 nusxa va loyiha uchun jami 20 MB; matn fayli 500 KB, bir capture 5 MB gacha. Katta/ikkilik fayllar tarixga kirmaydi. Tiklash bulut uchun; lokal tarix cached nusxalardir.
- ZIP ko‘rinadigan loyiha fayllari, inputs, drafts va artifacts papkalarini oladi; node_modules va yashirin fayllar chiqarilmaydi. 2000 fayl/200 MB jami va 50 MB bitta fayl chegarasi bor; chegaradan oshsa, to‘liq bo‘lmagan arxiv o‘rniga xato ko‘rsatiladi.
- API limit tugasa yangi model so‘rovi yuborilmaydi. Runner, qo‘lda tekshirish va kod ko‘rish token sarflamaydi.

## Runner deploy

1. `docker build -t opensi-runtime:0.3.0 -f deploy/runner/Runtime.Dockerfile .`
2. `.env.production` ichida 64 hex belgili tasodifiy `OPENSI_RUNNER_TOKEN` va Docker hostdagi `OPENSI_WORKSPACES_HOST` absolut yo‘lini belgilang. Tokenni log yoki brauzerga chiqarmang.
3. `docker compose --env-file .env.production -f compose.yaml -f compose.vps.yaml -f compose.runner.yaml up -d --build`

Runner ommaviy port ochmaydi. Faqat broker Docker socketga ega; veb-ilova va vazifa konteynerlari socketga ega emas. Broker tasdiqlangan loyiha yo‘lini birgina mount bilan uzatadi; tarmoq yo‘q, host muhit o‘zgaruvchilari uzatilmaydi. Runtime Node foydalanuvchisi UID 1000 bo‘lgani uchun workspace shu foydalanuvchiga tegishli bo‘lishi kerak.


## 0.7: agent, uploads and delivery

- New task UI defaults to Automatic; existing projects retain their policy. Cloud sandbox commands and ordinary browser actions do not wait on per-action approval. Aniq yuborish topshirig‘i bo‘lmasa submit tasdiq kutadi; explicit submit bitta joriy sayt so‘rovini yuboradi. Cross-origin, himoyalangan va qolgan browser network writes hali alohida tasdiq yoki qo‘lda boshqaruv talab qiladi. Local terminal va external MCP amallari o‘z ruxsat qoidalariga bo‘ysunadi. Manual browser takeover/close prevents auto-reopening.
- Any file extension may be uploaded as exact bytes: 100 files per task, 50 MB each, 200 MB per task/library user quota, 1 GB total library. Empty files are accepted. Drop and screenshot paste are supported. ZIP bundles can carry many files.
- PDF text extraction (100 pages/120k text), DOCX/PPTX/XLSX XML text and bounded ZIP extraction run in a 256 MB heap child with 25-second deadline and no inherited provider credentials. Scanned PDFs need separate OCR; unknown formats remain available as original bytes. ZIP rejects traversal, symlinks, encryption, hidden/system workspace paths and excessive expansion (100 MB, 500 entries).
- Up to four images enter initial model context. The agent can inspect more PNG/JPEG/WebP files with inspect_image. Actual image understanding depends on the selected model.
- Output choices: cloud; paired local connector workspace; browser-selected directory on supported browsers; ZIP download on phones/other browsers. A cloud folder export writes OpenSI/project/run snapshots, never overwrites unrelated files. Browser must remain open for automatic export; permissions may need regrant. Native OS apps are not controlled by the cloud browser.
- Connector ZIP bundles Node dependencies. Node.js 24+ is required. Windows launcher opens a folder picker. Local uploads preserve binary chunks. Local ZIP inputs are copied intact; automatic unpacked copies are in the cloud cache.
- TypeSafe JEV is a server-side decision tool (TYPESAFE_API_KEY), not a generative model or an authorization engine. It is shared with signed-in users; only admins may run the connection test. Credentials never reach the frontend.

## 0.8: source capture and cloning

- Sayt klonlovchi agent and computer_capture collect desktop (1280x800) or mobile (390x844) source evidence with overlapping scroll steps. Dominant inner scrolling containers are supported when the document itself does not scroll.
- Each batch saves screenshots, visible text, element rectangles, computed colors/fonts/spacing, visible links, image/background URLs and font metadata under inputs/att_capture_*/. The manifest maps downloaded assets to local paths. PNG/JPEG/WebP/GIF and WOFF/WOFF2 bytes are validated; active SVG, videos, embedded frames and unsupported font formats are not automatically copied and remain explicit missing assets.
- Only resources actually loaded through the isolated browser gateway are collected; existing network and owner boundaries remain. Desktop and mobile should be captured separately. Login walls, CAPTCHA and access controls are not bypassed.
- A batch captures up to 12 screens; truncated/continuation tells the agent to resume with reset=false. Each project has a 100 MB/30 capture bundle limit. Files also transfer to paired local connectors.
- Live browser images and up to three representative capture screenshots are supplied to the next model call; remaining screenshots can be inspected with inspect_image. Visual fidelity depends on the selected model's image support and capability, and on actual source-vs-output review. It is not a model-weight upgrade or guaranteed pixel identity.
- Automatic browser allocation reclaims idle completed agent sessions, supports two concurrent sessions per server without a per-account one-session limit, queues active contention and reconciles orphaned browser processes after an app restart. Manual takeover/close and network-write approvals remain.
- `computer_action` can now use the screenshot directly: `click_at`, `type_text`, `key`, `wheel` at a coordinate, `drag`, and `new_tab`/`close_tab`/`switch_tab`. Coordinates and keyboard actions require the latest screen revision; observations report each element's rectangle and viewport visibility. The manual Computer panel can create/close tabs and type at the cursor. Browser upload/download and WebSocket remain unsupported.
- Ctrl+V supports clipboard items and files, even while a run is active, with image thumbnails. Attachments prepared during an active run are sent with the next message after completion.

## 0.9: creative workspace (2026-10-07)

- Ijod studiyasi has 71 task presets in nine categories: slides, graphic design, documents, sheets, web apps, research agents, images, audio and video/music. These are task starting points sharing engines, not 71 new model integrations.
- Text/code models use the existing owned agent run, progress, file and approval pipeline. ChatGPT-plan and native Antigravity use their existing authentication; native source stays on the PC. Text-only/media-inappropriate selections are rejected before task creation.
- Slides and graphic designs export editable PPTX; designs also export SVG. Documents export DOCX and sheets export XLSX. Every artifact gets responsive HTML preview and editable opensi-artifact.json. The cloud project editor supports title/body/bullets/notes, order, duplicate/remove and theme changes, then regenerates exports. Native edits continue through the agent. Binary exports are available in OpenSI project downloads and library, not automatically mirrored to the PC.
- Four themes, seven layout options, local PNG/JPEG references, charts, tables, speaker notes, cell type preservation and owner-scoped downloads. JSON sources are capped at 500 KB, image references at 4 MB each/12 MB combined. Missing or invalid manifests fail explicitly rather than marking an unexported artifact complete.
- Google native image API adapter supports Nano Banana 2.1, 2, 2 Lite, Pro and legacy 2.5 Flash Image with text generation, one library reference image for editing, and aspect selection. Select the Google image protocol and enter your own Gemini API key in Connections. The key stays encrypted on the server. Existing Google/Antigravity login does not grant this API. No Google image key was present during this implementation: wire tests use a mock; funded live image generation is not verified.
- Existing Hark-like browser, panels, project instructions/memory, action buttons and checkpoint workflows are linked from the studio. Email/phone/calendar service connectors, office add-ins, model-trained image generation, video/music generation and a pixel-perfect copy of proprietary apps are not implemented by these presets. Video/music tiles explain the missing service and never simulate generation.
- Reference inventory: https://magica.com/features ; https://hark.com/ ; https://www.genspark.ai/agents ; https://ai.google.dev/gemini-api/docs/generate-content/image-generation . Checked 2026-10-07. Category similarities do not imply equivalent proprietary backends or all-provider quality guarantees.


## 2026-10-08: automatic team, mobile native bridge and large files

- Auto selects an enabled account model for planning, implementation, repair and final review. Preferences are transparent name-based rules, not benchmark claims. Actual model/provider usage and transitions are recorded. Only transient overload/transport errors trigger fallback; denials, cancellation and insufficient balance do not.
- `consult_model` shares one project with a selected available specialist. Native Antigravity is restricted to an owned online connector and requires scoped approval. Cloud projects can use a temporary PC copy; text sync is bounded to 150 files / 500 KB each / 5 MB total. Skipped binary/large files are reported. Source project remains cloud-owned. No Google credentials leave the PC.
- Mobile fresh native requests infer the paired PC server-side. Catalog refresh runs periodically and on foreground; offline models are labelled. A powered-off PC cannot execute Antigravity.
- `create_agent` makes an owned agent with a subset of the parent tools, up to 50 agents. Bot/API and agent-builder profiles are included.
- `computer_explore` follows observed same-origin public category links, captures each page, and reports remaining/truncated pages. Query/action/login/download URLs are excluded. Menus and tabs remain available through observed `computer_action` targets. Eight pages per call is a resource bound, not an assertion that an entire site was captured.
- Upload and individual download limit: 1,000,000,000 bytes (1 GB decimal). Large originals are streamed to disk, not SQLite BLOBs or JS memory. Per-run inputs and ZIP export: 2 GB, account library: 5 GB, server library: 20 GB, two concurrent uploads. Aborted temporary uploads are removed. Large documents above 50 MB are preserved for chunked terminal processing instead of fully extracting them into model context. ZIP uses streamed data descriptors. Request timeout is 30 minutes; interrupted uploads must be retried.
- Runtime image 0.10 adds C/C++, Go, Java, PHP, Ruby, Perl, Lua, SQLite plus Python data/bot packages and Node bot/API packages. Jobs remain isolated, networkless and time bounded. This supports building/testing bot and API code. Continuous public deployment and a live Telegram/Discord connection still need the destination credentials, explicit deploy configuration, and a persistent service; the sandbox does not pretend to provide these.
- Ordinary cloud models can operate from a phone with the PC off. Browser access does not turn the phone into a desktop OS or remove provider quotas. No claim of arbitrary-language execution or every possible task is made.
