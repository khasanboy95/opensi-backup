# OpenSI: bot, API va Vercel deploy

## Ishlatish

1. Ulanishlar → **Deploy va API** → Xizmat ulash.
2. Vercel tokenini kiriting. Team hisobidan foydalanilsa `team_...` ID ham kiriting. Token loyiha yaratish, env sozlash va deploy uchun shu hisobda ruxsatga ega bo‘lishi kerak.
3. Telegram uchun BotFather bergan bot tokenini alohida ulang. Boshqa API uchun HTTPS bazaviy manzil, header va ruxsat etilgan HTTP metodlarini tanlang. Server environment qiymatini alohida “Server environment” ulanishi sifatida saqlash mumkin.
4. Ulanishdagi avtomatik ruxsatni yoqing va loyihada “Avtomatik” rejimini tanlang. Ikkalasi ham yoqilsa, agent topshiriq doirasidagi tashqi amallarni bajaradi. Aks holda OpenSI aynan amalni tasdiqlashni so‘raydi.
5. Masalan: “Telegram bot yarat, /start va /help ni yoz, test qil, Vercel’ga deploy qil, webhookni ulab tekshir.”

Agent fayllarni yozadi va mavjud terminalda test qiladi. `integration_catalog`, `deploy_vercel`, `deployment_status`, `api_request`, `telegram_bot`, `project_service` vositalari kodni tashqi xizmatga ulash imkonini beradi. Chat Completions va ChatGPT agentlari vositalarni bevosita chaqiradi; native Antigravity `opensi-actions.json` orqali so‘raydi va haqiqiy natijani keyingi bosqichda oladi. Alohida modelning vositadan to‘g‘ri foydalanishi uning qobiliyatiga bog‘liq.

Loyihadagi **Deploy** panelida build holati, HTTP natijasi, havola va build loglari ko‘rinadi. BUILDING tayyor degani emas; READY build tugaganini bildiradi. Botning haqiqiy javobini Telegram orqali alohida sinash kerak.

## Amal doirasi

- Vercel: haqiqiy source/binary fayllar SHA1 bilan yuklanadi, loyiha yaratiladi, server env sozlanadi, build boshlanadi. Node/Next/Vite va Vercel qo‘llagan serverless API’lar. `directory: "dist", framework: "static"` faqat oldindan build qilingan frontend uchun. Source deploy uchun `directory: ""` va `framework: "auto"`.
- Telegram: getMe, getWebhookInfo, setMyCommands, setWebhook va deleteWebhook. Yangi BotFather hisobini yaratmaydi, ommaviy xabar yubormaydi. Tokenni `envRefs.TELEGRAM_BOT_TOKEN` orqali bog‘lang; OpenSI `TELEGRAM_WEBHOOK_SECRET`ni yaratadi va header tekshirish uchun handlerga beradi. Webhook shu loyihaning ochiq, READY Vercel deployiga bog‘lanadi. Pending update’lar o‘chirilmaydi.
- HTTP API: saved base URL ichidagi GET/POST/PUT/PATCH/DELETE, faqat foydalanuvchi yoqqan metodlar. JSON body, javob chegarasi 1 MB va modelga 18 KB matn. Tashqi javoblar ishonchsiz ma’lumot.
- Doimiy lokal Node/Python bot yoki API: yangilangan connector va yangi lokal loyiha orqali `project_service` start/status/stop. Jarayon agent tugagach ham ishlaydi; connector yopilsa to‘xtaydi. Bu Vercel serverless oqimidan alohida. Start ishlayotgan nomni qayta ochmaydi; yangilash uchun avval stop, keyin yangi requestId bilan start. Bitta connectorda ayni Telegram tokeni bilan ikki polling jarayoni boshlanmaydi.
- Local terminal tarmoqsiz qoladi; dependency’larni Vercel remote build o‘rnatadi. Yo‘q xizmat tokeni, tugagan balans yoki provayder limiti avtomatik chetlab o‘tilmaydi.

## Kalitlar va qayta bajarish

Har bir ulanish uning egasiga tegishli. AES-GCM bilan shifrlanadi, model va frontendga token qaytarilmaydi. Ruxsat etilgan env kalitlari foydalanuvchining Vercel hisobiga uzatiladi; `NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`, `REACT_APP_` maxfiy bindinglari qabul qilinmaydi. Vercel boshqaruv tokeni app environment’iga berilmaydi. Kalitlar kodga yozilgan bo‘lsa deploy rad etiladi. `.env`, `.git`, node_modules, inputs va xususiy kalit fayllari paketga kirmaydi. Har fayl 20 MB, deploy jami 100 MB va 2000 faylgacha.

`requestId` bitta run ichida amalni takrorlamaslik uchun saqlanadi. Tugagan amal qayta so‘ralsa saqlangan natija qaytariladi. Server uzilishi/tarmoq xatosidagi noaniq natija avtomatik qayta bajarilmaydi; avval tashqi holat tekshiriladi. Vercel himoyasi avtomatik o‘chirilmaydi. Foydalanuvchi ulanishni uzsa token o‘chiriladi.

Native manifest shakli:

```json
{"version":1,"runId":"joriy run ID","actions":[{"tool":"deploy_vercel","args":{"connectionId":"int_...","requestId":"deploy1","directory":"","framework":"auto","target":"preview","envRefs":{}}}]}
```

Natijadan keyingi bosqichda qaytgan `deploymentId` bilan `deployment_status` chaqiriladi. Ish tugaganda manifestdagi `actions` bo‘sh ro‘yxatga almashtiriladi. Eski run manifesti bajarilmaydi.

## Rasmiy API manbalari

## Vercel brauzer oqimi (2026-10-09)

Kompyuter panelidagi **Brauzer muhiti** tanlovi loyiha uchun saqlanadi: bulut yoki shu foydalanuvchining online, `computer_browser_v1` imkoniyatli connectori. Lokal connector alohida Edge/Chrome oynasini ochadi; mavjud shaxsiy profil va cookie bazasini o‘qimaydi. Telefon orqali bulut yoki online kompyuter brauzerini boshqarish mumkin.

Agent sahifani kuzatadi, element bosadi, matn/variant kiritadi, scroll qiladi va ochilgan tablar orasida o‘tadi. Vercel deploy buyrug‘i foydalanuvchi topshirig‘ida aniq berilgandagina tegishli deploy API so‘rovlari avtomatik ruxsat oladi. Begona sayt matni bunday ruxsat bermaydi. Hisob huquqlari, to‘lov, o‘chirish kabi amallar bu ruxsatga kirmaydi.

Login/parol/OTP/CAPTCHA ekrani agentga berilmaydi: vazifa `waiting_input` holatida turadi, boshqaruv foydalanuvchiga beriladi. Kirishdan keyin **Kirish tugadi — agent davom etsin** bosiladi. Tugallanmagan login davom ettirilmaydi; oldingi Deploy bosilishi takrorlanmaydi. Lokal brauzer komandalaridagi kiritilgan matn va screenshot SQL command tarixida saqlanmaydi.

Vercel dashboard mavjud Git repozitoriyni import qilishga mos. Faqat lokal fayllar bo‘lsa mavjud API yoki CLI deploy yo‘li kerak. Ushbu brauzer rejimi butun Windows dasturlarini boshqarmaydi; WebSocket va download qo‘llanmaydi. Har bir uchinchi tomon login/deploy oqimi alohida jonli sinovni talab qiladi.

- [Vercel deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment)
- [SHA1 fayl yuklash](https://vercel.com/docs/rest-api/deployments/upload-deployment-files)
- [Server environment API](https://vercel.com/docs/rest-api/projects/create-one-or-more-environment-variables)
- [Telegram Bot API](https://core.telegram.org/bots/api#setwebhook)

2026-10-08: implementatsiya unit/API va model-runner sinovlarida fake tashqi transport bilan tekshirildi. Haqiqiy Vercel deploy va Telegram yozishmalari foydalanuvchi tokenlarni ulaganidan keyin tekshiriladi.

## Lokal bot va fayl havolalari (2026-10-08)

- Javobdagi mavjud fayl nomi yoki `bot.mjs:25` / `[kod](bot.mjs#L25)` bosilganda Kod paneli va aniq qator ochiladi. Saqlanmagan tahrir ustidan yozilmaydi; bir xil basename bir nechta papkada bo‘lsa to‘liq yo‘l ishlatilsin.
- Yangi vazifa matnida foydalanuvchi taqdim etgan Telegram bot tokeni `getMe` bilan tekshiriladi, shifrlangan ulanish sifatida saqlanadi va prompt/model/tarixga faqat ulanish IDsi hamda tasdiqlangan username uzatiladi. Bu avvalgi chat tarixlarini o‘zgartirmaydi. Boshqa xizmatlar tokenlari Ulanishlar → Deploy va API orqali kiritiladi.
- Lokal loyihada Avtomatik rejim terminalni takroriy tasdiqsiz bajaradi. Guided rejim va MCP tasdiqlari saqlanadi. Token ishlatadigan amallar uchun tegishli ulanish ham avtomatik ruxsatga ega bo‘lsin.
- `project_service` Node/Python entry faylini tanlangan loyihaning juftlangan kompyuterida ishga tushiradi. `envRefs` qiymatlari command SQLite yozuvida ID bo‘lib qoladi; faqat aynan shu kompyuterga poll javobida environment qiymatlari beriladi. Tokenlar jarayon loglaridan tozalanadi. Kod tokenni ataylab tarmoqqa yubormasligi agent topshirig‘i bilan boshqariladi; lokal kod OS foydalanuvchisi huquqlarida ishlaydi.
- Lokal polling uchun `getWebhookInfo`, kerak bo‘lsa `deleteWebhook` (pending update’lar saqlanadi), so‘ng start/status. Kutubxonalarni `run_command` bilan o‘rnating; kompyuter online va connector ochiq bo‘lsin. Umumiy internet manzili yoki botning Telegramda javobi faqat jarayon running bo‘lgani bilan tasdiqlanmaydi.
- Birinchi startdan keyin yana status chaqiring va xatolarni tekshiring. Botning haqiqiy muloqotini foydalanuvchi /start yuborishi bilan tekshiring.
