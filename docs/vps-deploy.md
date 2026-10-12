# OpenSI — GreenCloud VPS

Maqsadli server: **23.252.124.21**, 2 CPU, 4 GB RAM, 35 GB disk.
2026-10-06 keyingi tekshiruvida server **RUNNING**, OS o‘rnatish **COMPLETE** holatida.
Ubuntu OpenSSH banneri va tashqaridan 22-portga TCP ulanish tasdiqlandi.
Hisob egasi taqdim qilgan yangi screenshotdagi root paroli bilan SSH kirishi
tasdiqlandi. Kompyuterning OpenSI public keyi serverga qo‘shildi va alohida
kalit bilan root kirishi tekshirildi. Parol yangi faylga yoki buyruq argumentiga yozilmadi.
Server Ubuntu 24.04.5 LTS; 3.8 GB RAM, 1 GB swap. Dastlab diskda 30 GB bo‘sh joy.
Dastlab faqat SSH/DNS portlari band, UFW inactive, mavjud Docker yo‘q edi.
OpenSI `/opt/opensi`ga joylashtirildi; Docker 29.8.2, Compose 5.6.0 va Caddy 2.11.7 ishlaydi.
Vaqtinchalik live manzil: **https://opensi.23-252-124-21.sslip.io/**.
ADMIN_EMAILS hisob egasi bergan Gmail manziliga sozlandi va ishlayotgan containerda
tekshirildi. Google OAuth OpenSI Web klienti bilan ulandi; haqiqiy Gmail login, admin
roli va kirish jurnali HTTPS saytda tekshirildi. Model API provideri hali ulanmagan.
Parollar va SSH private key bu hujjatga yozilmaydi.

## Serverga kirish va domen

GreenCloud birinchi o‘rnatishda SSH public key tanlashga imkon beradi.
Public key bo‘lmasa, root parolini hisob egasining emailiga yuborishini ko‘rsatadi.
Private keyni GreenCloudga yoki chatga yubormang. OS o‘rnatilgach SSH kirishi,
server host key fingerprinti va ishlayotgan xizmatlar tekshiriladi.

Ushbu kompyuter uchun public key: `C:\Users\LAPTOP\.ssh\opensi_greencloud_ed25519.pub`.
Fingerprint: `SHA256:4RjfLOSi85nT+F3sX9NMoUsdg3Mpn0yrMrPiN44brh4`.
Private key faqat shu kompyuterda; fayldagi Windows inherited ruxsatlar olib tashlangan.
Public key ushbu VPSga ulangan. Yangi kompyuter uchun pairing kerak bo‘lsa:
kompyuterda `OpenSI-VPS-Ulash.cmd` faylini ishga tushiring. U mavjud root parolini
SSH klientining himoyalangan console promptida so‘raydi va faqat shu public keyni
`/root/.ssh/authorized_keys`ga qo‘shadi. Parol scriptga yoki chatga kelmaydi,
saqlanmaydi. Faylni tahrirlamang: parolni faqat ochilgan SSH oynasida kiriting.
Mavjud SSH kalitlari saqlanadi; qayta ishga tushirilsa dublikat qo‘shilmaydi.
Server qayta o‘rnatilmaydi. `OPENSI_SSH_READY` natijasidan keyin Codexga `tayyor` deb yozing.
SSH klienti oldin saqlangan server host keyini majburiy tekshiradi.
Ulash scripti stdin/stdoutni hisob egasining consoleiga ulaydi va SSH terminalini
so‘raydi; birinchi login parol almashtirishni talab qilsa, foydalanuvchi o‘sha oynada bajaradi.
Faqat public key remote buyruqqa qo‘shiladi va shell uchun quote qilinadi.
Script syntaxi, eski kalitlarni saqlash va takroriy ulashda dublikat qo‘shmaslik
vaqtinchalik papkada tekshirildi. Root password authentication va key authentication
haqiqiy VPSda muvaffaqiyatli tekshirildi.

OpenSI uchun alohida subdomen ishlating, masalan `opensi.YOUR_DOMAIN`.
DNS **A** yozuvi `23.252.124.21` ga yo‘naladi. Noto‘g‘ri AAAA yozuvi bo‘lmasin.
TCP 80/443 Caddy uchun ochiq va boshqa xizmat tomonidan band bo‘lmasligi kerak.
SSH portini aniqlamasdan firewallni o‘zgartirmang.
Caddy domen uchun HTTPS sertifikatini oladi va yangilaydi.
Faqat IP manzili bilan Google loginning yakuniy oqimi sozlanmagan hisoblanadi.

## Paket

Kompyuterda `npm run check`, `npm test`, `npm run build`, keyin `npm run package:vps`.
`releases/` papkasida `.tar.gz`, SHA-256 va fayl manifesti yaratiladi.
Paketga faqat dastur manbalari va deploy fayllari kiradi. `.env.production`,
lokal SQLite bazasi, boshqa loyihalar va kalit fayllari uzatilmaydi.
Ulash `.cmd` faylida parol maydoni aniqlansa paket yaratish to‘xtaydi.
Paket serverda yangi OpenSI papkasiga ochiladi; mavjud xizmatlar va Docker
loyihalari avval tekshiriladi. 35 GB diskda image/build cache o‘lchamini kuzating.

## Birinchi deploy

Quyidagi buyruqlar **VPSning Ubuntu terminalida**, paket ochilgan papkadan bajariladi:

```bash
sudo bash deploy/install-docker-ubuntu.sh
bash deploy/configure-vps.sh opensi.YOUR_DOMAIN your-admin@gmail.com
nano .env.production
```

Oxirgi qadamda `GOOGLE_CLIENT_ID` va `GOOGLE_CLIENT_SECRET`ni serverning o‘zida
kiriting. `ADMIN_EMAILS`dagi email sizniki bo‘lsin. Google Cloud Web application
OAuth clientining redirect URI: `https://opensi.YOUR_DOMAIN/api/auth/google/callback`.
API provideri login qilgandan keyin OpenSI adminidagi **Ulanishlar** orqali ulanadi.

`configure-vps.sh` 0600 ruxsatli production env yaratadi va shifrlash kalitini
serverda bir marta hosil qiladi; mavjud envni va master kalitni almashtirmaydi.
Google credentials bo‘lmasa login yopiq qoladi; ommaviy development admin yoqilmaydi.
Admin email/OAuth hali berilmaganda kirishi yopiq dastlabki deploy uchun:
`bash deploy/configure-vps.sh opensi.23-252-124-21.sslip.io --pending-auth`.
Bu vaqtinchalik DNS manzili server IPsiga yo‘naladi; shaxsiy domenga ko‘chirganda
APP_URL/OPENSI_DOMAIN va Google callback manzili birga yangilanadi.

```bash
docker compose --env-file .env.production -p opensi -f compose.yaml -f compose.vps.yaml config --quiet
docker compose --env-file .env.production -p opensi -f compose.yaml -f compose.vps.yaml up -d --build
docker compose --env-file .env.production -p opensi -f compose.yaml -f compose.vps.yaml ps
curl --fail https://opensi.YOUR_DOMAIN/api/health
```

`docker compose config`ni `--quiet`siz umumiy logga chiqarmang: to‘liq shakli env
secretsini ko‘rsatishi mumkin. `.env.production` Gitga va deploy arxiviga kirmaydi.
Lokal `.env.local` serverga ko‘chirilmaydi.

## Ishlash va backup

Frontend/API bitta HTTPS origin orqali xizmat qiladi. Backend 4580 faqat server
loopbackiga chiqariladi. Caddy alohida Compose tarmog‘idan unga ulanadi va SSE
javoblarini darhol uzatadi. `OPENSI_TRUST_PROXY=1` faqat shu yopiq backend uchun:
rate limit foydalanuvchi IPsi bo‘yicha hisoblanadi. Backendni public portga chiqarmang.
CDN/proxy qo‘shilsa, client IP zanjiri alohida qayta tekshiriladi.

OpenSI root huquqisiz, read-only containerda ishlaydi; fayllar va SQLite
`opensi-data` volumeida saqlanadi. Appga 768 MB, Caddyga 192 MB xotira chegarasi
berilgan. Loglar cheklangan, xizmatlar server qayta yonsa avtomatik qaytadi.
Bu VPS uchun API agentlari va telefon → Windows connector asosiy oqimdir.
2026-10-06: `compose.runner.yaml` bilan bulut terminali va Chromium yoqilgan. Docker host socketi faqat ichki brokerga beriladi; app yoki vazifa konteyneriga berilmaydi. [Chegaralar va sozlash](capabilities.md).

Hozirgi OpenSI VPSda runner, kompyuter va Antigravity xizmatlari birga ishlaydi.
Keyingi yangilashda quyidagi barcha overlay fayllarni qo‘shing; faqat
`compose.yaml`/`compose.vps.yaml` bilan appni qayta yaratish runner ulanishini
yo‘qotadi va PDF/terminal amallarini uzadi. `.env.production` ichida
`OPENSI_RUNNER_URL=http://runner:4590` va serverda yaratilgan
`OPENSI_RUNNER_TOKEN` saqlansin. Tokenni logga chiqarmang.

```bash
docker compose --project-directory /opt/opensi --env-file /opt/opensi/.env.production \
  -f /opt/opensi/compose.yaml -f /opt/opensi/compose.vps.yaml \
  -f /opt/opensi/compose.runner.yaml -f /opt/opensi/compose.computer.yaml \
  -f /opt/opensi/compose.antigravity.yaml up -d --build --no-deps runner opensi
curl --fail https://opensi.23-252-124-21.sslip.io/api/ready
```

`/api/health` faqat web ilova javob berayotganini bildiradi; `/api/ready`
terminal va hujjat image'lari tayyorligini ham tekshiradi. PDF yangilanishidan
keyin bitta qisqa HTMLni PDFga aylantirib, `%PDF-` sarlavhasi, sahifa soni va
o‘qiladigan matnni tekshiring.

Master kalit va named volume doimiy qoladi. Yangilashda faqat OpenSI xizmati
almashtiriladi; `down -v` ishlatmang. SQLite backupini app to‘xtagan paytda butun
data volumei bilan oling. Env/master kalit va Caddy data volumeining himoyalangan
nusxasi ham kerak; ularni umumiy log/arxivga yozmang.

## Yakuniy tekshiruv

- HTTPS sertifikati haqiqiy; `/api/health` 200; 4580 tashqaridan yopiq.
- Login qilmagan odam `/api/me` va admin APIlariga kira olmaydi.
- Google login → aynan admin emailiga admin rol → login admin panelda ko‘rinadi.
- Haqiqiy provider API test → vazifa → javob va provider qaytargan usage.
- Telefon va desktopda interfeys, SSE, tasdiqlash va qayta ulanish.
- Windows connector → fayl yaratish → tasdiqlangan terminal → haqiqiy natija.

2026-10-06 haqiqiy VPS tekshiruvi:

- Docker production build muvaffaqiyatli; OpenSI healthy, Caddy running.
- Frontend va `/api/health` HTTPS orqali 200, HTTP HTTPSga 308 redirect qiladi.
- TLSv1.3 sertifikati client tomonidan ishonchli deb tasdiqlandi, muddati 2027-01-04.
- `/api/me`, `/api/admin/overview`, `/api/providers` anonymous uchun 401.
- `/api/auth/config`: `configured=false`, `localMode=false`; Google tugmasi yopiq.
- Backend 4580 faqat 127.0.0.1ga bog‘langan; tashqaridan ulanish ishlamadi.
- App container UID/GID 1000; tekshiruvda app ~48 MiB, Caddy ~14 MiB xotira ishlatdi.
- Diskda deploydan keyin ~29 GB bo‘sh joy.
- Chrome desktop 1631 px va telefon 390x844 px: sahifa ochildi, gorizontal overflow yo‘q,
  console error/warn ro‘yxati bo‘sh. Dalillar: `screenshots/vps-live-desktop.png`
  va `screenshots/vps-live-mobile.png`.

Google login, haqiqiy provider API vazifasi va telefondan local connector bilan to‘liq
oqim credentials kiritilgandan keyin tekshiriladi.

Lokal dalillar: `npm run check`, `npm run build`, **27/27 test** muvaffaqiyatli.
Ikkala Bash script syntaxi va birlashtirilgan Compose konfiguratsiyasi tekshirildi.
Vaqtinchalik papkada env yaratish, mavjud master kalitni saqlash va yaroqsiz domenni
rad etish tekshirildi; sinov envlari o‘chirildi. `--pending-auth` holatida admin email
va Google credentials bo‘shligi, local auth o‘chiqligi va qayta urinish mavjud kalitni
saqlashi tekshirildi. Google login va haqiqiy provider API bu tekshiruvga kirmaydi.

Manbalar: [Docker Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[Compose production](https://docs.docker.com/compose/how-tos/production/),
[Caddy HTTPS](https://caddyserver.com/docs/automatic-https),
[Caddy reverse proxy/SSE](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
