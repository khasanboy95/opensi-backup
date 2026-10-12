# OpenSI Google login

Administrator Gmail manzili production ADMIN_EMAILSga kiritildi va containerda tekshirildi.
Google Cloud loyihasi: **OpenSI**, project ID **opensi-510805**.
Google hisob: **khasandjemilov@gmail.com**.

Branding App name OpenSI, hisob egasining support/contact emaili va External testing
rejimi bilan yaratildi. Hisob egasi tasdig‘i bilan OpenSI Web klienti yaratildi va
Google JSON fayli kompyuterga yuklandi. Credential faylining Windows ruxsatlari
egasi/SYSTEM/Administrators bilan cheklangan; fayl release ichiga kiritilmaydi.
Client ID va Secret shifrlangan SSH stdin orqali serverning 0600 env fayliga ulandi.
Master shifrlash kaliti va admin emaili saqlandi; OpenSI containeri healthy holatida.

2026-10-06 HTTPS sayt orqali haqiqiy Google login bajarildi. Google qaytishi, admin
roli, faol hisob va “Muvaffaqiyatli” Google kirish eventi UI orqali tasdiqlandi.
390×844 telefon o‘lchamida documentWidth=390, shu login eventi ko‘rinadi va konsolda
error/warn yo‘q. Tasdiq suratlari: `docs/screenshots/google-admin-live.png` va
`docs/screenshots/google-admin-live-mobile.png`. Google scopes faqat openid/email/profile.
Hali model API provideri ulanmagan: API ulanishlari, vazifalar va tokenlar 0.

## Google formalaridagi qiymatlar

Yaratilgan Clients → OpenSI Web qiymatlari:

- Application type: Web application
- Name: OpenSI Web
- Authorised JavaScript origin: `https://opensi.23-252-124-21.sslip.io`
- Authorised redirect URI: `https://opensi.23-252-124-21.sslip.io/api/auth/google/callback`

OpenSI so‘rovlari faqat `openid email profile` scope ishlatadi. Hozirgi testing
rejimida hisob egasining login oqimi test user qo‘shmasdan ishladi. Kelajakda boshqa
scope yoki foydalanuvchilar uchun Google Audience/publishing qoidalarini tekshiring.
Client Secretni chatga yoki screenshotga qo‘ymang.

## Birinchi loginni ulash

SSH public key bilan kirish allaqachon ishlaydi. Kompyuterda
`OpenSI-Google-Ulash.cmd`ni ikki marta bosib oching va Google Clouddan yuklangan
OAuth JSON faylining to‘liq yo‘lini kiriting. JSON fayl boshqa dastur/projectga
tegishli bo‘lsa yoki callback mos kelmasa, ulash to‘xtaydi.

Helper faqat OpenSI uchun kerakli client ID/secretni SSHning shifrlangan stdin
kanalidan shu VPSga yuboradi. Google JSONning nusxasini yaratmaydi va secretni logga
chiqarmaydi. Serverning 0600 env fayli atomik yangilanadi; shifrlash kaliti va
admin emailingiz saqlanadi. OpenSI qayta ishga tushiriladi va HTTPS auth config
tekshiriladi. Keyin Google bilan haqiqiy login → admin roli → admin login eventi
tekshiriladi; helperning `configured=true` natijasi haqiqiy Google loginni isbotlamaydi.

Model API ulanishi uchun base URL va provider API kaliti ham kerak. API kaliti Google
Client Secretdan alohida va OpenSI adminidagi Ulanishlar orqali kiritiladi.

Sinov: remote import kodi haqiqiy VPSning vaqtinchalik papkasida test credentials
bilan bajarildi. Valid import, master kalit/admin/local-authni saqlash, 0600 ruxsat,
noto‘g‘ri client ID va env injectionni rad etish tekshirildi; vaqtinchalik fayllar tozalandi.
QA vaqtinchalik test credentials bilan bajarildi. Keyin haqiqiy OpenSI credentials
import qilindi va haqiqiy Google login tekshirildi. Agent/model API va Windows lokal
connectorining haqiqiy end-to-end ishlashi API ulanishidan keyin tekshiriladi.
