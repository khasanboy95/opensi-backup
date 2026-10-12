# Dizayn va ishlash tekshiruvi — 2026-10-05

Asosiy konsept: [home.png](home.png). Yordamchi holatlar:
[workspace.png](workspace.png), [admin.png](admin.png).
[Dizayn shartnomasi](contract.md) barcha holatlar uchun umumiy.

## Dalil va usul

Codex In-app Browser (IAB) orqali bosh sahifa, provider sozlash, vazifa, kod,
preview, agent yaratish, admin va Google sozlamalari tekshirildi. Tashqi Playwright
browseriga o‘tilmadi. Screenshotlar IAB `tab.screenshot({fullPage:false})` orqali
saqlandi. Konsept va oxirgi screenshotlar `view_image` orqali bevosita solishtirildi.
Asl konsept o‘lchami **1536 × 1024**, odatiy laptop **1280 × 720**, telefon
**390 × 844** va balandligi qisqargan **390 × 520** oynalar tekshirildi.
Vaqtinchalik viewport override yakunda qaytarildi.

Saqlangan handoff tasvirlari:

- [Bosh sahifa, desktop](../screenshots/home-desktop.jpg)
- [Bosh sahifa, mobile](../screenshots/home-mobile.jpg)
- [Admin, desktop](../screenshots/admin-desktop.jpg)

Nazoratli API’li browser QA alohida vaqtinchalik bazada ishladi. Uning screenshotlari
taqqoslashdan keyin tozalandi. Asosiy bazada test provider, model, vazifa yoki Google
foydalanuvchisi yaratilmagan.

## Fidelity ledger

| Nuqta | Konsept dalili | Browser dalili | Tuzatish yoki asos |
| --- | --- | --- | --- |
| Asosiy layout | 296px chap rail, 62px header, markaziy composer | 1536pxda rail 296px; composer 980px; header 62px | Asosiy uy konsepti barcha holatlar uchun tayanch. Yordamchi tasvirlardagi turlicha rail kengliklari umumiy tizimga birlashtirildi. |
| Matn va tartib | Sarlavha, subtitle, model/muhit/agent, uch CTA, API hint, footer | Xuddi shu matnlar va tartib; yaratishga tegishli bo‘lmagan qo‘shimcha section yo‘q | Above-the-fold copy diff: ko‘rinadigan uy matnlarida qo‘shish/o‘chirish/nom almashtirish yo‘q. Yopiq select menyusidagi model va connector variantlari funksional ma’lumot. |
| Tipografiya | Oq sans sarlavha, 48px native title; ravshan nav va control matni | Lokal Inter; native sarlavha 48px, nav 18px, composer tanlovlari 16px | Dastlab kichik chiqqan native nav/control matni va suggestion tugmalari kattalashtirildi. Laptop/mobil o‘lchamlari alohida moslashtirilgan. |
| Rang va kontur | Qora canvas, yumshoq qora rail, lime geometrik mark, outline tugmalar | #0c0c0d, #111112, #171719, #c9f99c; 16px composer radius | Kodga asoslangan tekis ranglar ishlatildi. ImageGen tasviridagi raster shovqin/yorug‘lik teksturasi takrorlanmadi; dizayn shartnomasida gradient yo‘q. |
| Ikonkalar va brend | Home/list/users/link, gear, ikki chevron, brain/cloud/code; ikki burchakli mark | Mos Lucide outline ikonkalari va umumiy SVG brand | Dastlabki checkbox-list, slider-settings va panel-collapse ikonkalari list/gear/chevronga almashtirildi. Bosh konseptdagi brend barcha holatlarda qo‘llandi. |
| Oraliqlar | Havodor markaz, uch bir xil CTA, tekis nav satrlari | Native CTA min 214px; nav label x78; controls 48px | Nav satrlari va tekst boshlanishi, muhit/agent control kengligi va CTA oraliqlari tuzatildi. |
| Admin zichligi | To‘rt metric, tabs, 7 kunlik chart, kirish jadvali, OAuth row | Xuddi shu tartib; metrics 0; chart empty; OAuth row birinchi viewportda ko‘rinadi | Grafik 168pxga, section/jadval oraliqlari konseptga yaqinlashtirildi. May sanalari o‘rniga hozirgi yetti kun; bo‘sh chartda uydirma 100 token o‘qi yo‘q. |
| Ish maydoni | Chap suhbat, o‘ng preview, natija tabs, past composer | Haqiqiy HTML/CSS fayllari va interaktiv iframe; code/save/activity/terminal | Yordamchi konseptdagi namunaviy portfolio va checklist statik seed sifatida kiritilmadi. Faqat bajarilgan vositalar va haqiqiy holat ko‘rsatiladi. |
| Mobil | Yopiladigan rail, wrap controls, suhbat/natija almashishi | 390px parent scrollWidth=390; API modal CTA ko‘rinadi; mobil preview ochiladi | Jadvallar o‘z hududida scroll; 520px balandlikda send tugmasi y410–446 ichida. Bu browser o‘lchami sinovi; haqiqiy telefon klaviaturasi/hardware tekshiruvi emas. |
| Amaldagi holatlar | Uydirma metric yoki completed vazifa yo‘q | API konfiguratsiyasi, model discovery va actual test alohida; noma’lum usage aniq | Bo‘sh composerda send disabled. Google sozlanmagan bo‘lsa sozlash sahifasi ochiladi. Bu holatlar konseptdagi faol ko‘rinadigan control o‘rniga haqiqiy ruxsat/holatni aks ettiradi. |

Asosiy ekran dizayn shartnomasiga sodiq ravishda bevosita tekshirildi. Yuqorida
ko‘rsatilgan funksional va umumiy tizim qarorlari intentional deviationsdir.
Ko‘rinadigan asosiy matn/tugmalar kesilishi yoki mobil horizontal overflow qolmadi.
Chrome console’da tekshirilgan oqimlar yakunida error/warn **0** edi.

## Funksional browser oqimi

1. Ulanishlar formasidan nazoratli provider qo‘shildi; `/models`dagi `qa-model`
   composerga tushdi; API testdan `OPENSI_CONNECTED` qaytdi.
2. Model `write_file` vositalari orqali haqiqiy `index.html` va `style.css` yozdi.
   Ikki model chaqiruvida provider bergan 46 input + 22 output = 68 token saqlandi.
3. Preview CSS bilan yuklandi; iframe ichidagi tugma `CLICK_OK` chiqardi.
4. Browser code editorida sarlavha tahrirlandi; Save bosildi; preview va reload
   qilingan vazifada `Brauzerda tahrir qilindi.` ko‘rindi.
5. Shu loyihada follow-up topshiriq berildi, model ask_user savoli foydalanuvchi
   javobidan so‘ng davom etdi. Keyingi sekin oqim Stop orqali bekor qilindi.
6. Maxsus agent yaratildi; file-write ruxsati o‘chirildi. Admin jadvali aynan test
   provider qaytargan usage va usage bermagan bekor qilingan chaqiruvni ko‘rsatdi.
7. Mobil menu → loyiha → Suhbat/Natija, admin tabs va API modal ishladi.
8. Asosiy ilovada Google tugmasi haqiqiy konfiguratsiya formasiga olib bordi;
   callback va credentials formasi ko‘rindi. Credentials kiritilmadi.

Mock model natijalari UI/transport/vosita oqimini sinaydi, real AI sifati yoki
foydalanuvchi provider balansi/tezligini isbotlamaydi.

## Kod va server tekshiruvi

`npm run check` — PASS. `npm run build` — PASS. `npm test` — **25/25 PASS**.

Testlar: shifrlangan secret/tamper, session expiry va disabled hisob, CSRF,
fayl traversal/symlink/Windows reserved paths, ulanish paytidagi DNS/private-IP
tekshiruvi, Chat/Responses tool loop va usage, 402/uzilgan oqim, savol/tasdiq/rad/
cancel, delegatsiya, boshqa hisobning loyihasini rad etish, token limit,
MCP SDK bilan haqiqiy protokol va egalar ajratilishi.

Lokal connector temp workspace ichida haqiqiy fayl yozdi; terminal ruxsatdan keyin
Windowsda Node buyrug‘i bilan `LOCAL_COMMAND_OK` qaytardi. Pair code bir marta
ishlashi va token bekor qilinishi tekshirildi.

**Hali jonli tekshirilmagan:** foydalanuvchining compatible API’si, Google consent
va login redirecti, haqiqiy tashqi MCP xizmatlari, public HTTPS hosting, boshqa
qurilmadan cloud-to-local boshqarish va Docker cloud terminal. Docker daemon bu
kompyuterda ishlamadi. Bularni tayyor deb belgilamaymiz.
