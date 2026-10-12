# OpenSI design contract

Primary source: `home.png`. Supporting states: `workspace.png`, `admin.png`.
Generated with the built-in ImageGen tool. The prompt requested an Uzbek coding
workspace inspired by v0's composer and Codex's task rail, not a marketing page.

Canvas #0c0c0d; sidebar #111112; composer #171719; border #252528; text #f1f1f3;
muted #929297; accent #c9f99c. No gradients, illustrations, fabricated metrics,
or seeded tasks. UI type is Inter-compatible system sans; body 14px, controls
13px, page title 28px, home title 38px. Spacing 4/8/12/16/24/32/40.

Sidebar 244px at 1280px; scales to 296px on the 1536px reference. Header 62px.
Home composer max 980px at native reference, 740px on ordinary laptops.
Radii: controls 8px, composer 16px. Outline icons: Lucide, 1.6px strokes.
Brand: the primary two angular lime polygons, implemented as reusable SVG.

Home copy: OpenSI; Yangi vazifa; Ish maydoni; Vazifalar; Agentlar; Ulanishlar;
LOYIHALAR; Hali loyiha yo‘q; Admin panel; Sozlamalar; Lokal workspace; Shaxsiy;
Shaxsiy workspace; Google bilan kirish; Bugun nima yaratamiz?;
G‘oyadan tayyor dasturgacha. Agentlaringiz bilan birga.;
Vazifani yozing yoki fayl biriktiring...; Modelni tanlang; Bulut; Dasturchi;
Veb-sayt yaratish; Kodni yaxshilash; Ma’lumot tahlili;
Boshlash uchun API ulang; Barcha ishlar bitta maydonda. Har qanday qurilmadan.

Required operational additions: permission dialogs, authentication gate, real
connection forms, task states, file editor, token usage, connector pairing,
custom agents. Extend using the same tokens. Never invent successful task output.
The sample workspace content in the supporting image is a visual example only.
Admin dates and metrics use current data, not the illustrative image's dates.

Mobile: off-canvas sidebar, 56px header, stacked work/preview tabs, controls wrap
inside composer, tables scroll inside their regions. Primary actions remain
reachable at 390px and with the phone keyboard open. Reduced motion respected.
