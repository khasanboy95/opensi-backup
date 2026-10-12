# OpenSI tizim yangilanishi — 2026-10-08

## O‘rnatilgan versiya

- Manzil: https://opensi.23-252-124-21.sslip.io/
- Release: `opensi-vps-20261008T031709Z.tar.gz`
- SHA-256: `d7a1b57487b5a59846c1aff9729ad45d9b80d835a4dd3fe940285680fd439426`
- Brauzer bundle: `index-BO5pxBWR.js`
- Runner muhiti: `opensi-runtime:0.10.0`.
- Server va runner qayta ishga tushishidan oldin faol vazifa, media ishi va connector buyrug‘i yo‘qligi tekshirildi. Provider kalitlari va loginlar almashtirilmadi.

## Tekshirilgan natijalar

- `npm run check` va production build o‘tdi.
- To‘liq avtomatlashtirilgan sinovlar: **114 / 114** o‘tdi.
- Alohida katta fayl sinovi: **1,000,000,000 bayt** haqiqiy HTTP oqimi bilan yuklandi va qaytarib olindi. Fayl diskda saqlandi, SQLite BLOBga joylanmadi. Bu lokal integratsion sinov; VPSga internet orqali 1 GB transfer bajarilmadi.
- ZIP: haqiqiy production loyiha brauzer orqali yuklab olindi; barcha fayllarning CRCsi tekshirildi, HTML va Python mazmuni saqlandi.
- Yangi production runtime ichida C, C++, Go, Java, Python, JavaScript, PHP, Ruby, Lua va SQLite misollari bajarildi. Go vaqtinchalik bajariladigan fayllari loyiha papkasida yaratiladi; `/tmp` bajarish cheklovi o‘chirilmagan.
- Avtomatik jamoa haqiqiy hisobda vazifa bajardi: **Mimo → GPT-5.6-Sol → GPT-6-Astra**. Python assert testi, HTML, desktop/mobil screenshot va yakuniy tekshiruv bajarildi.
- Mobil **390 × 844** brauzer oynasidan **Gemini 3.8 Flash (Low)** topshirig‘i yuborildi. Ulangan kompyuter HTML fayl yaratdi, natija OpenSI preview oynasida ko‘rindi. Bu haqiqiy telefon apparatidagi sinov emas.
- Xuddi shu bulut loyihasi keyingi xabarda Gemini orqali davom ettirildi. Matn fayllari tasdiqdan keyin kompyuterga uzatildi, HTML o‘zgarishi bulutga qaytdi, Python fayli saqlandi.
- `computer_explore` haqiqiy python.org saytining ko‘ringan havolasini kuzatib ikki sahifaga kirdi; har birining screenshot va manifesti hamda umumiy indeks saqlandi.
- Mobil previewdagi konsol xatolari Chrome kengaytmasining sandbox storage urinishlariga tegishli edi; ilova xatosi kuzatilmadi.

## Qo‘shilgan imkoniyatlar

- Avtomatik model tanlash, bosqichlar bo‘yicha almashish, vaqtinchalik overload/tarmoq xatosida boshqa modelga o‘tish va amaldagi modelni jarayonda ko‘rsatish.
- `consult_model` bilan mutaxassis modelga topshiriq berish; `create_agent` bilan o‘z hisobida ota-agent vositalari doirasida agent yaratish.
- Bot/API va agent yaratuvchi profillar; yangi dasturlash tillari va Python/Node bot, ma’lumot va ofis kutubxonalari.
- Ichki sahifalarni avtomatik ko‘rish, screenshot va sahifa tuzilmasini yig‘ish.
- Telefonda native model tanlanganda to‘g‘ri PC connectorini server tomonidan aniqlash, online/offline holatini yangilash.
- 1 GB fayl qabul qilish, oqim bilan diskka yozish va yuklab olish. ZIP loyiha eksporti 2 GBgacha. Papkaga saqlash ham qismlarga bo‘lib yozadi.

## Aniq chegaralar va tugallanmagan qism

- Antigravity uchun tegishli kompyuter va connector online bo‘lishi kerak. Bulut modellari kompyutersiz ishlaydi. Provider limitlari saqlanadi.
- Barcha modellar barcha format yoki amallarni bir xil sifatda bajarmaydi. Avtomatik tanlov nomga asoslangan ochiq qoidalardan foydalanadi, mustaqil benchmark natijasi emas.
- Native bulut ko‘prigi matn fayllari bilan chegaralangan: 150 fayl, har biri 500 KB, jami 5 MB. O‘tkazilmagan fayllar ogohlantirishda ko‘rsatiladi.
- Fayl: 1 GB; bitta vazifa jami: 2 GB; hisob kutubxonasi: 5 GB; server kutubxonasi: 20 GB. Diskda yetarli bo‘sh joy bo‘lishi kerak. 50 MBdan katta hujjatlar avtomatik to‘liq model kontekstiga ochilmaydi; asl fayl saqlanadi.
- Cloud terminal ishlari ajratilgan, tarmoqsiz va vaqt chegarasi bilan bajariladi. Telegram/Discord botini 24/7 ishlatish yoki tashqi API xizmatini deploy qilish uchun tegishli credential va alohida doimiy xizmat sozlamasi kerak. Bu yangilanish doimiy bot hostingini yaratmagan.
- Yangilangan connector ZIP serverga joylandi. **Ushbu kompyuterda ishlayotgan eski connectorni avtomatik yangilab qayta boshlash xavfsizlik tekshiruvida bloklandi** (`blocked by policy`; aniqroq sabab berilmadi). Eski jarayon o‘zgarmadi va yuqoridagi Gemini sinovlari shu ulanishda o‘tdi. Lokal connector orqali 50 MBdan katta fayl uzatish uchun yangi ZIPdagi connectorni foydalanuvchi yangilashi kerak. Bulutdagi 1 GB imkoniyati bundan mustaqil.

Dalillar: `D:\Dastur 1\14\.codex\tmp\opensi-progress-qa\20261008-mobile-gemini.png` va `20261008-auto-team.png`.
