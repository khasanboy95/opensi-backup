# Hark Handoff va OpenSI brauzer agenti

Yangilangan sana: 2026-10-10. Ochiq manbalar:
- https://hark.com/articles/introducing-hark-handoff — virtual kompyuter, model amallari, SFT/RL va Harkning o‘lchovlari.
- https://hark.com/articles/introducing-hark-pro — ko‘p brauzer, xotira, xizmat integratsiyalari va maxfiy ma’lumotlar ombori haqidagi da'volar.
- https://hark.com/using-hark va https://hark.com/security — Handoff ishlatish, jonli kuzatish, to‘xtatish va ruxsatlar.
- https://onlinemind2web.com/ — mustaqil benchmark sahifasidagi inson bahosi jadvali. 2026-10-10 holatida Handoff 97.67% ko‘rsatilgan; bu OpenSI natijasi emas.

Harkning e'lon qilgan sikli: har topshiriqqa alohida virtual kompyuter → ekran holatini ko‘rish → model x/y kursor va klaviatura amallarini chiqarishi → brauzerda bajarish → natijani qayta ko‘rish → vazifa tugaguncha takrorlash. Hark post-training bosqichida SFT va RL ishlatganini aytadi. Modelning vaznlari, trening ma'lumotlari, reward dizayni va to‘liq inferens algoritmi ochiq emas. Shuning uchun ayni modelni nusxalash yoki uning benchmark sifatini OpenSIga tegishli deb ko‘rsatish mumkin emas.

| Capability | OpenSI implementation |
| --- | --- |
| Computer use | Loyiha sessiyasiga bog‘langan bulut Chromium yoki foydalanuvchining lokal connector brauzeri. Screenshot, matn, forma yorliqlari va holati, element rect/inViewport, navigate/click/fill/check/uncheck/select/submit/press, koordinata click/drag/wheel, kursor joyiga yozish, global tugmalar va 5 tagacha tab. Agent vositalari shu sessiyani ishlatadi. |
| Watch / handoff | UI ko‘rinib turganda taxminan 1.2 soniyada screenshot holati yangilanadi; foydalanuvchi boshqaruvni olishi yoki sessiyani yopishi mumkin. Automatic rejimdagi oddiy agent amallari avtomatik; guided rejim tasdiq so‘raydi. Login/OTP/CAPTCHA foydalanuvchiga topshiriladi. |
| Network submissions | Agentning explicit submit amali joriy origin uchun amal davomida bitta oddiy POST/PUT/PATCH yuboradi; maxfiy/karta/kirish oynasi, himoyalangan yo‘l, boshqa origin va DELETE bundan mustasno. Boshqa cloud so‘rovlar hamda lokal brauzerning submit paytidagi boshqa origin so‘rovlari usul va manzil bo‘yicha tasdiq kutadi; aniq Vercel deploy istisnolari saqlanadi. 90 soniyada tasdiq bo‘lmasa rad etiladi. So‘rov tanasi model, UI va auditga chiqarilmaydi. |
| Action Buttons | Persisted reusable prompts with model and optional project; explicit Run starts the existing real task engine, retaining approval and usage tracking. |
| Panels | Pin existing project mini-app previews into a personal dashboard; scripts execute only in the established sandboxed preview. |
| Projects / memory | Existing 0.5 project instructions, manual memory, library and sequential workflows. |

## Isolation and operation

The computer service has no public port, data-volume mount, host filesystem or Docker socket. It runs non-root with a read-only root filesystem, ephemeral tmpfs and an internal Docker network. Each session starts a separate Chromium process with a fresh browser context. Chromium's network requests are intercepted and relayed through the application gateway; the gateway validates public HTTPS destinations and connection-time DNS using the existing guarded dispatcher. The browser container has no direct Internet route. Tokens are available only to the service process; they are never sent to pages or the web UI.

The gateway uses a distinct SHA-256-derived service token from the runner token. Provision OPENSI_COMPUTER_TOKEN with SHA256('opensi-computer:' + OPENSI_RUNNER_TOKEN) and enable compose.computer.yaml in addition to the existing three compose files. The token must never be printed. Recreate both the app and computer service on deployment; browser sessions intentionally do not survive restart.

Limits: 2 global sessions (4 GB VPS resursiga mos), har sessiyada 5 tab, 30 minutes idle, 1280x800 browser viewport, 5 MB response resources, 20 KB outbound write bodies, 12 pending writes, 80 concurrent resource fetches. Audit retains the latest 100 metadata entries per project. Cookies remain in the temporary browser context and vanish when it closes.

## Explicit boundaries

This is a browser, not remote access to the user's entire Windows desktop. New tabs and popups are tracked within the 5-tab limit. WebSockets, upload/download, camera/microphone, arbitrary JS evaluation, OS app automation and password/card vaults are not exposed. Some login sites reject automated browsers; CAPTCHAs and protections are not bypassed. No Hark-equivalent E2E encryption, autonomous purchasing, connected payment accounts, native mobile apps, or automatic personal-memory inference is claimed. Real website data can be sent to the selected model when the user asks the agent to observe it; credentials should be entered manually and not passed to the model.

OpenSI tanlangan umumiy multimodal model va `computer_observe`/`computer_action` vositalari bilan kuzatish → amal → tekshirish siklini bajaradi. Muvaffaqiyat darajasi provider va saytga bog‘liq. Hark benchmarki OpenSI bahosi emas: solishtirish uchun bir xil jonli vazifalar, inson bahosi va saqlangan amal izlari kerak. `tests/computer-engine.test.mjs` haqiqiy Chrome boshqaruvini tekshiradi, saytlararo agent muvaffaqiyatini o‘lchamaydi.


## 2026-10-09: bo‘limlarni o‘rganish va jonli panel

Manba: https://hark.com/using-hark — Handoff bulut kompyuteri va brauzerni tasvirlaydi, ichki rejalash algoritmi yoki tezlik kafolatini e’lon qilmaydi. OpenSI implementatsiyasi mustaqil.

- `computer_explore`: bir origin ichida kenglik bo‘yicha bo‘limlar navbati, 24 sahifagacha, 5 darajagacha, umumiy 180 soniyalik tekshiruv oralig‘i. Hash SPA yo‘llari hamda `page/category/tab/view/section/lang` navigatsiya parametrlari qo‘llanadi. Tracker parametrlari olib tashlanadi; amal/login/token URLlari ochilmaydi.
- Capture ichki scroll konteynerini topadi; ko‘rinadigan rasmlar va layoutni kutadi. Standart `role=tab` va `type=button` bo‘lgan, forma tashqarisidagi uchta tabgacha holat screenshotlari olinadi. Noma’lum tugmalarni avtomatik bosmaydi; agent yangi DOM tavsifidagi role/href/expanded orqali maqsadli `computer_action` tanlaydi.
- Jonli UI 1.2 soniyada holat so‘raydi; capture ishlayotganida tayyor oxirgi kadrdan foydalanadi. Bu video stream emas; tezlik sayt va model javobiga bog‘liq.
- Reja paneli tekshirilgan/navbatdagi sahifalar, screenshotlar, xatolar va chuqurlikni ko‘rsatadi. Katta ekran va sessiyani to‘xtatish tugmalari bor.
- To‘liq tugamagan ish `partial`, `remaining`, `depthLimited`, `truncated` bilan qaytadi. Hamma sayt va dinamik menyuni tekshirildi deb aytmaydi. Login va CAPTCHA foydalanuvchiga topshiriladi.
