# Mavjud loyihani davom ettirish

Loyihalar → Mavjud loyihani import qilish → ZIP va oldingi holat izohi.
Import alohida bulut nusxasini yaratadi. Asl loyiha o‘zgarmaydi. Loyihani tanlang → Loyihani tekshirish → Loyihani ochish → keyingi vazifani yozing.

- `opensi-source-manifest.json`: ko‘chirilgan manbalar, hashlar va tashqarida qolgan resurslar (tayyor ko‘chirilgan loyihalarda).
- `opensi-import.json`: import inventari va o‘tkazib yuborilgan fayllar.
- `opensi-handoff.md`: oldingi holat, asosiy qarorlar va davom ettirish izohi.
- `opensi-status.md`: agentning keyingi ish uchun saqlagan holati (`save_checkpoint`).

Agent avval `project_inspect` bilan texnologiyalar, package skriptlari, Python talablari va hujjatlarni ko‘radi. PDF/ta’lim, savdo, ovoz, media, bot va manbali tahlil uchun mos tekshiruv yo‘riqnomasi beriladi. Bu modelni qayta o‘qitish emas; modelga loyiha konteksti va ish vositalari beriladi.

Cloud: Python kutubxonalari `install_packages`; Node registry kutubxonalari `install_node_dependencies` yoki alohida `npm install`/`npm ci` buyrug‘i orqali o‘rnatiladi. Node installer yangi loyiha ichki katalogiga o‘rnatadi va natijani `opensi-node-lock.json`ga yozadi. Manifestdagi dependency versiyalari ishlatiladi; asl lockfile bilan aynan bir xil dependency daraxti kafolatlanmaydi. Lifecycle skriptlar o‘rnatish paytida bajarilmaydi. Prisma/native modul kabi generatorlarni keyin alohida offline terminal amali bilan ishlating. URL/git/private registry/workspace package talablari bu installerda qo‘llanmaydi.

Import chegara: 3000 fayl, jami 500 MB ochilgan manba, har fayl 50 MB. Bu biriktirmalarning 1 GB chegarasidan alohida. .env, yashirin kataloglar, node_modules, database, token yoki kalit topilgan fayllar tashlab ketiladi; manbada maxfiy ma’lumot bo‘lmasligi baribir tekshirilishi kerak. Import build/deploy, provayder ulanishi yoki oldingi testlarning qayta o‘tganini anglatmaydi.

Telefonda ham shu bulut loyihalari ochiladi. Kompyuterdagi nusxa bilan avtomatik ikki tomonlama sinxronlash yo‘q. Kerakli tashqi API, bazalar va katta aktivlarni qayta ulang; lokal diskda bajarish uchun online connector kerak.
