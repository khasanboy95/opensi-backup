# OpenSI

O‘zbek tilidagi agentlar, API modellar va loyihalar uchun ish maydoni.
React + Vite interfeysi, doimiy Node.js serveri va SQLite bazasi.

## Kompyuterda ochish

Node.js **24+** kerak. PowerShell:

```powershell
Set-Location 'D:\Dastur 1\14\opensi'
npm ci
npm run dev
```

Brauzer: **http://127.0.0.1:4581**. API: 4580.
`OpenSI.cmd` loyiha papkasida shu rejimni ishga tushiradi.
Hozir development serveri ishga tushirilgan.

Lokal rejimdagi `Lokal workspace` — faqat loopbackda ishlaydigan development
administratoridir. U Google foydalanuvchisi sifatida hisoblanmaydi.
Bu rejimni tarmoqqa chiqarib bo‘lmaydi: server konfiguratsiyasi rad etadi.

## O‘zingizdagi API’ni ulash

1. **Ulanishlar → API ulash**: nom, Base URL va API kalitini kiriting.
2. Protokolni tanlang: `/chat/completions`, `/responses` yoki Claude uchun `/messages`.
3. `/models` orqali model nomlari olinadi. Bu endpoint mavjud bo‘lmasa,
   **Model nomlarini qo‘lda kiritish** bo‘limidan aniq nomlarni kiriting.
4. **API test** modelga kichik haqiqiy so‘rov yuboradi. Provider token to‘lovi
   bo‘lishi mumkin. Model ro‘yxati olinishi generatsiya ishlashini isbotlamaydi.
5. Bosh sahifa pastida model, agent va ish muhitini tanlang; topshiriq yuboring.

Base URL odatda `https://provider.example/v1` shaklida bo‘ladi; protokol endpointi
avtomatik qo‘shiladi. HTTPS talab qilinadi. Lokal developmentda loopback HTTP
provideriga ham ulanish mumkin. Kalit browser storage yoki frontend bundle ichiga
yozilmaydi; server uni AES-256-GCM bilan shifrlaydi va qayta ochiq qaytarmaydi.
API 402, uzilgan oqim, model xatosi haqiqiy xato sifatida ko‘rsatiladi.
`usage` qaytarmagan providerning token sarfi **noma’lum** belgilanadi.

### Claude modellari

**Ulanishlar → API ulash → Claude API** tugmasi `https://api.anthropic.com/v1`
va Messages protokolini tanlaydi. Anthropic Console’da yaratilgan API kalitini
admin paneldagi maxfiy maydonga kiriting. Model ro‘yxati Anthropic `/models`
endpointidan sahifalab olinadi; faol modellar tanlovda paydo bo‘ladi. **API test**
haqiqiy kichik so‘rov yuboradi. Oqimli matn, rasmli xabar, vosita chaqiruvi,
vosita natijasi va token sarfi Claude formatidan OpenSI formatiga o‘giriladi.

Vercel AI Gateway orqali Claude ishlatish uchun **Claude · Vercel AI Gateway**
tugmasi OpenAI-compatible endpointni tanlaydi. Bu yo‘lga Vercel **AI Gateway API
key** kerak. `vcp_` bilan boshlanadigan Vercel shaxsiy access tokeni model API
kaliti emas va OpenSI uni qabul qilmaydi. Kalitni kodga, `.env.example`ga yoki
chatga joylashtirmang; admin paneldagi maxfiy maydondan foydalaning.

## Agentlar va vazifalar

- Dasturchi, Dizayner, Tadqiqotchi va Tahlilchi; maxsus ko‘rsatma, model va
  ruxsatlar bilan o‘z agentingizni yaratish.
- API orqali vositalarni tanlash, haqiqiy fayl o‘qish/yozish, terminal natijasi,
  ochiq URL o‘qish, savol/javob, vazifaning qismini boshqa agentga berish.
- SSE orqali javob va faoliyat; tasdiqlash/kutish/to‘xtatish; bazada tarix.
  Brauzerni yopish serverdagi ishni bekor qilmaydi. Server qayta ishga tushsa,
  bajarilayotgan ish `Uzilgan` deb belgilanadi; undan keyin yangi davomiy vazifa
  berish mumkin. Navbatdagi ishlar tiklanadi.
- Fayl muharriri, saqlash/yuklab olish; `index.html` yoki `dist/index.html`
  uchun sandbox preview; kompyuter/telefon preview o‘lchami.
- Matn, kod, CSV va PNG/JPEG/WebP fayllarni topshiriqqa biriktirish.
  PDF/DOCX/video/audio parser bu versiyada qo‘shilmagan.
- Terminal va barcha MCP chaqiruvlari foydalanuvchi tasdiqlashini kutadi.
  MCP ulanishlari egasining hisobiga tegishli. Boshqa foydalanuvchi ularning
  tokenlari yoki vositalarini ishlata olmaydi.

Hozir bir serverda ikki faol vazifa, har bir loyiha uchun bir faol vazifa,
har bir foydalanuvchi uchun uchta faol/navbatdagi ish ruxsat etiladi.
Bitta agent aylanishi 18 qadam; delegatsiya bir daraja va 4 chaqiruv bilan cheklangan.

## Telefon → lokal kompyuter

Ommaviy HTTPS server telefon uchun kirish nuqtasi bo‘ladi. Ishlaydigan kompyuter
serverga o‘zi tashqariga ulanadi; kompyuterda kiruvchi port ochilmaydi.

1. **Ulanishlar → Lokal connectorlar → Ulash kodi olish**.
2. Kompyuterda OpenSI papkasidan quyidagi buyruqni bajaring:

```powershell
node connector/index.mjs --server "https://YOUR_DOMAIN" --code "ULANISH_KODI" --workspace "D:\OpenSI Projects"
```

Lokal sinov uchun server `http://127.0.0.1:4580` bo‘lishi mumkin. Kod bir martalik,
10 daqiqada tugaydi. Qayta ishga tushirishda `--code` qismini olib tashlang.
Ulanish ma’lumoti `%USERPROFILE%\.opensi\connection.json` da saqlanadi.
Bir nechta server uchun alohida `--state-dir` ishlating.

3. Composer ichida kompyuter nomini tanlang. Fayllar workspace ichida alohida
   loyiha papkasiga tushadi. Terminal Windowsda PowerShell orqali bajariladi.
4. **Uzish** node tokenini bekor qiladi. Connectorni to‘xtatish: `Ctrl+C`.

Connectorning fayl vositalari yo‘l chegaralarini tekshiradi. Tasdiqlangan terminal
esa kompyuteringiz foydalanuvchisi huquqlari bilan ishlaydi; u OS sandbox emas.
Ajratilgan OS hisobi yoki VM kengroq foydalanish uchun mos.
Lokal `dist` preview serverga yuklanadi; hot reload dev server proxy hozir yo‘q.

## Google/Gmail va admin

**Sozlamalar**da Google OAuth Client ID/Secret, administrator email manzillarini
va ko‘rsatilgan aniq callback URLni sozlang. Google Cloud Console’da Web application
OAuth client yarating, consent screen/audience sozlang va callbackni ruxsat etilgan
redirect URIga kiriting. Faqat `openid email profile` olinadi; Gmail xatlari o‘qilmaydi.

Server ID token imzosi, issuer, audience, nonce, state, PKCE va tasdiqlangan emailni
tekshiradi. Administrator huquqi aniq email allowlistidan beriladi.
**Admin panel**da haqiqiy kirgan foydalanuvchilar, kirishlar, vazifalar, modelning
input/output tokenlari va oylik limit mavjud. Narxlar taxmin qilinmaydi.
Sozlash formasi credentials borligini ko‘rsatadi; to‘liq Google login faqat Google
redirect oqimi muvaffaqiyatli tugagandan keyin tekshirilgan hisoblanadi.

## Internetga chiqarish

Bu loyiha doimiy ishlaydigan server, disk va SSE ulanishlarini talab qiladi.
Node.js 24+ VPS/container hostingga qo‘ying. Barcha API va frontend bir HTTPS
origin orqali xizmat qilishi kerak. Google OAuth client va domenning yakuniy
sozlamalari hali berilmagan. GreenCloud VPS (23.252.124.21) uchun
[deploy yo‘riqnomasi](docs/vps-deploy.md) va Caddy HTTPS Compose konfiguratsiyasi
tayyorlangan; serverga ommaviy deploy hali bajarilmagan.

```powershell
npm run build
# .env.production.example asosida .env.local yarating yoki hosting envlarini sozlang
npm start
```

Productionda `NODE_ENV=production`, `HOST=0.0.0.0`, `LOCAL_DEV_AUTH=false`, haqiqiy
HTTPS `APP_URL`, Google OAuth qiymatlari va 64 hex belgili
`OPENSI_ENCRYPTION_KEY` kerak. Kalitni bir marta mahalliy yaratish:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
```

Natijani hosting secretiga saqlang. Bir xil kalit va `DATA_DIR` bazasi doimiy
qolishi kerak. Kalitni almashtirishdan oldin shifrlangan ma’lumotni ko‘chirish
rejasini tuzing. Backup: serverni to‘xtatib `DATA_DIR`ning to‘liq nusxasini oling;
SQLite, workspace fayllari va master kalit birga kerak.

Docker varianti: `.env.production.example`dan `.env.production` yarating,
qiymatlarni to‘ldiring, `docker compose up -d --build`. Port 4580 faqat loopbackga
bog‘langan. HTTPS reverse proxy bilan domenni unga ulang, SSE bufferingni o‘chiring.
Faqat yopiq backend uchun `OPENSI_TRUST_PROXY=1` qo‘ying. GreenCloud uchun tayyor
`compose.vps.yaml` overlay va paket yaratish buyrug‘i: `npm run package:vps`.
Bir replica ishlating: vazifa worker holati shu server jarayonida.
VPSda Docker build, HTTPS sayt va cloud runner tekshirilgan (2026-10-06).

**Bulut terminali:** oddiy bulut fayl ishlari serverda ishlaydi. Terminal uchun
alohida izolatsiyalangan Docker runner yoqish kerak. Compose sukutda Docker socket
ulamaydi va terminalni yoqmaydi. Runner `--network none`, resurs chegaralari,
read-only root va imtiyozlarni kamaytirish bilan ishlaydi. Internetdan paket
o‘rnatish uchun alohida, nazoratli egress runner arxitekturasi kerak.

Runnerni yoqish va to‘liq imkoniyatlar/chegaralar: [OpenSI 0.3.0](docs/capabilities.md).

## Tekshiruv

### Antigravity hisobidan foydalanish

Rasmiy [Antigravity CLI](https://antigravity.google/docs/cli/install) ni o‘rnating,
`agy` dasturida Google hisobingizga kiring. OpenSI → Ulanishlar → Lokal connectorlar
orqali kod oling va connectorni ishga tushiring:

```powershell
node connector/index.mjs --server https://YOUR-OPENSI --code PAIR_CODE --workspace "D:\OpenSI Projects" --antigravity "C:\full\path\agy.exe"
```

Keyingi ishga tushirishda `--code` kerak emas; qolgan parametrlarni saqlang.
Model tanlovida shu kompyuterning Antigravity modellari chiqadi va lokal muhit
avtomatik tanlanadi. Ulanish faqat kompyuterni ulagan OpenSI hisobiga ko‘rinadi.
OAuth tokenlar CLI keyringida qoladi, serverga yuborilmaydi. Kompyuter va connector
online bo‘lsa, telefon orqali ham topshiriq yuborish mumkin.

Har vazifa oldidan lokal agentga ruxsat so‘raladi. Terminalning interaktiv tasdiq
so‘rovi OpenSI’da buyruq va papka bilan ko‘rsatiladi. Tasdiqlangandan keyin lokal
connector aynan shu buyruqni bajaradi va natijani agentga beradi. Rad etish yoki
bekor qilishda buyruq bajarilmaydi. CLI’da aniq Deny qoidasi bo‘lsa bu oqim uni
chetlab o‘tmaydi. Hisob/model kvotalari amal qiladi. Bir model bosqichi 5 daqiqa,
bir vazifada 12 tagacha bosqich. URL bilan klonlashda OpenSI bulut brauzeri desktop
va mobil screenshot, DOM/CSS va rasmlarni lokal inputs/ papkasiga tayyorlaydi.
Preview uchun 150 tagacha, har biri 500 KB dan kichik, jami 5 MB fayl serverga
nusxalanadi; kattaroq fayllar lokal papkada qoladi. API provayderlarining OpenSI
vositalari va Antigravity CLI vositalari alohida ishlaydi.

`node scripts/check-antigravity-live.mjs C:\full\path\agy.exe` vaqtinchalik loyiha
orqali haqiqiy hisobda HTML yaratish, progress, usage va fayl sinxronligini tekshiradi
(hisob kvotasidan foydalanadi).

```powershell
npm run check
npm test
npm run build
```

Testlar maxsus vaqtinchalik bazada ishlaydi. Model javoblari nazoratli test API’si
bilan; fayllar, MCP SDK protokoli, SSE, mahalliy connector va Windows terminal
haqiqatan bajariladi. Real provider billing/model sifati va Google login uchun
haqiqiy sozlamalar bilan alohida jonli tekshiruv zarur.

`npm run qa:browser` — izolyatsiyalangan 4582 test serveri; konsolda mock provider
manzili chiqadi. Bu haqiqiy AI emas. Tugatish uchun terminalga `exit` yozing.
Asosiy loyiha bazasiga test provider/vazifa qo‘shmaydi.

[Arxitektura](docs/architecture.md) · [Dizayn va brauzer tekshiruvi](docs/design/qa.md)

## Hozirgi chegaralar

OpenSI 0.8.0 ishlaydigan agent workspace. `Kompyuter` panelida alohida bulut Chromium
yoki lokal connector brauzerini agent va foydalanuvchi bir sessiyada boshqaradi:
screenshot/DOM kuzatish, koordinata bo‘yicha kursor, klaviatura, scroll, drag, tablar,
forma maydonlarini label va holati bilan ko‘rish, check/select/submit, login uchun
boshqaruvni topshirish va boshqa tarmoq yozuvlarini tasdiqlash mavjud.
[Hark bilan funksional taqqoslash](docs/hark-comparison.md) imkoniyat va chegaralarni
aniq ko‘rsatadi. Codex yoki Hark modelining kuchi/tezligiga tenglik o‘lchanmagan;
natija tanlangan modelga, saytga va mavjud integratsiyalarga bog‘liq. Brauzer
Windows ilovalari yoki butun ekranni boshqarmaydi; brauzer upload/download va
WebSocket hozir qo‘llanmaydi.
