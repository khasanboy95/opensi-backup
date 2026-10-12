from pathlib import Path
import os,json,re,zipfile,hashlib
ROOT=Path('D:/Dastur 1/14/opensi').resolve(); OUT=ROOT/'.codex/continuation/bundles';OUT.mkdir(parents=True,exist_ok=True)
C=Path('C:/Users/LAPTOP/Documents/New project');D=Path('D:/Dastur 1/14')
items=[]
def add(key,title,root,notes,mode='full',extras=[]):items.append(dict(key=key,title=title,root=root,notes=notes,mode=mode,extras=extras))
add('01a06567-474b-7392-a621-9ccbdf863b5d','IELTS reading PDF va HTML tayyorlash',C/'ielts-reading-maximizer','React/Vite IELTS Reading. Preserve question IDs and source coverage. Live reference: https://ielts-reading-maximizer.vercel.app/#full-mocks. Run package scripts and verify exam interactions.')
add('01a0656d-9164-7a20-aae0-3e3e52c4b20a','Kitobni o‘quvchilarga o‘rgatish',C/'tmp/cambridge_ielts_guide','Cambridge IELTS Uzbek teaching guides. Previous report: 498-page master PDF and 98-page teacher DOCX. Original source pages 255–258 were absent: do not invent them. Generator paths may reference Windows; adapt copied scripts to this workspace.', 'docs',[(C/'output/pdf/Cambridge_IELTS_Barcha_Mashqlar_Tartibli_UZ_MASTER.pdf','outputs/master.pdf'),(C/'output/docx/Cambridge_IELTS_Barcha_Mashqlar_Oqituvchi_Xaritasi_UZ.docx','outputs/teacher-map.docx')])
add('01a06590-9498-7950-8104-be2ddad10812','DOCX mashqlarini birlashtirish va workbook',C/'tmp/pdfs','Pre-IELTS combined workbook. Previous report: 283 pages and 570 explanations. Use pre_ielts_sources.json and compiled data; preserve source identifiers. Adapt Windows paths in copied generators.','preielts',[(C/'output/pdf/Pre_IELTS_Grammar_Paraphrasing_Master_Workbook_UZ_Enhanced.pdf','outputs/workbook.pdf')])
add('01a065a8-0987-7cf3-a69d-74e1f59c44a2','Create Uzbek 30-lesson course',C/'pre-ielts-uz','30 lessons, vocabulary, audio and saved progress. Preserve missing-audio labels. Live https://pre-ielts-uz.vercel.app. Test lesson navigation, exercise feedback and reopening progress.')
add('01a065af-37c0-75f3-b408-10a963fa2e82','Z2U kabi account marketplace yarat',C/'nexora-marketplace','React/Vite marketplace with admin CRUD and Postgres/Drizzle. Reconnect database using secure integrations; no production database or secrets copied. Existing informational offers are not verified inventory. Test ownership and admin authorization.')
add('01a06aef-da80-7bb1-be13-5b8d355d8b88','Sketch studio LLM',C/'tushuntir-ai','Source snapshot from the local Sketch/tushuntir codebase. Large local model weights, icon databases and generated media excluded; consult opensi-source-manifest.json. Connect server endpoints securely. Do not claim missing datasets are installed.','largecode')
add('01a06561-9aa8-7fc0-aab8-05f4e265f15f','34-kostyum shimini moslashtir',C/'scripts','Image editing workflow: preserve identity and exact dimensions. Editing scripts included. Original personal portrait/ID images remain on the local computer; attach only the specific image needed for the next edit. Use an image editing model from the actual media catalog.','portrait')
add('019f273a-b48a-7ad2-958e-2fcccac0851b','Twins dictionary saytini clone qil',C/'twins-dictionary-clone','Dictionary application. Database excluded; seed from data/words.json using the existing seed script. Preserve translations, saved practice and service-worker update behavior. External database/account keys must be reconnected.')
add('019f7074-43c4-78c3-9a56-f3188e3ed094','Twins voice chat',D/'twins-voice','Next.js realtime voice application. Reconnect Gemini and Supabase through secure settings. Test Start→immediate Stop→Start, Pause/Resume, transcript order and mobile microphone. Live https://twins-voice.vercel.app.')
add('019eb9c1-6bbe-7952-8cae-9d066e6d98cc','laptope store uz',C/'laptopstore-web-20261009','Snapshot of an actively edited checkout; original untouched. Reconcile newer changes before deploying. Next.js/Prisma store; regenerate Prisma client after registry installation and reconnect database/auth/storage secrets. Build and test checkout/admin flows.')
add('01a0d151-f84a-7001-be3c-15e3e3bd8ea8','Sketch Studio JEv API ulash',D/'vercel-zip-app','Sketch Studio web frontend and worker integration. Keep uploaded images centered, uncropped and tied to narration. Preserve MP4 generation and JEV decision integration; API credentials were not copied. Live https://sketch-studio.uz.')
add('01a0e649-8c15-72a3-994d-2835bdf5e8a6','Tahlil qil va bot yaratish imkonini',D/'nft-battle-bot','Telegram NFTArena bot. Token and live user database excluded. Channel selection and two-account battle tests were not completed previously; 24/7 hosting not verified. Use actual business handler for webhook testing.')
add('01a0dba5-4b6a-7932-b530-62f87c7d6fc5','PDF bosh betini olib tashlash',C/'tmp/pdfs','Content-preserving PDF cleanup. Retain source text and images outside explicitly removed pages/ad content; compare counts and render representative pages. Original inputs may need reattachment; generator paths require adaptation.','pdfclean',[(C/'output/pdf/Multilevel_Writing_Samples_20_Sets_clean.pdf','outputs/writing-clean.pdf'),(C/'output/pdf/Multilevel_Speaking_clean.pdf','outputs/speaking-clean.pdf')])
add('01a0e680-acf6-7950-822e-84c17d7c050b','Writing tahlil usulini yaxshilash',D/'tmp/pdfs/writing-20sets','20-set writing workbooks: 590 matching sentence rows, bilingual memorization and Uzbek-only active production. Previous renders: 101 and 116 pages. Preserve identifiers; adapt copied generator source/output paths.','docs',[(D/'output/pdf/20_Sets_01_Jumlalar_UZ_EN_Yodlash_Kitobi.pdf','outputs/bilingual.pdf'),(D/'output/pdf/20_Sets_02_Faqat_UZ_Practice_Kitobi.pdf','outputs/uz-practice.pdf')])
add('01a0eb5a-7d09-76c0-8442-d526534500d8','Rejalashtir AI sog‘liq web-ilovasini',C/'salomat-ai','Salomat health web app. Preserve official medicine source provenance and missing fields. Do not fabricate medical registry values or bypass existing dosage/privacy boundaries. Test catalog and adult self-care flows.')
add('01a0eb63-5a22-7ff0-bbd8-103c27d13569','Kelajakni ko‘rish g‘oyasini o‘rgan',C/'ufq-lab','UFQ 2D/3D conditional scenario simulator. Keep measured dates, forecasts and assumptions separate; preserve source attribution, units and held-out validation. Do not claim certain predictions.')
add('01a0fc4d-c93f-7450-9cbc-744a390892da','Self-studyga writing mashqlarini qo',D/'teacher-khasan-writing','Teacher Khasan writing and Multi-Level practice. Preserve 847 writing rows and active reconstruction/retry/progress. Book Part 2 tests31–60:180 questions,29 audio tracks; Test32 has no audio and must stay ungraded. Large PDF/audio resources excluded from this source snapshot: reattach needed originals; see manifest. Live https://teacher-khasan.vercel.app.','teacher')
add('opensi-self-snapshot-20261009','Rejalashtiring OpenSI AI platformasi',ROOT,'OpenSI source snapshot including project import, task workflows, project checkpoints and dependency installers. Runtime uses cloud Docker or a paired connector. No production database, provider keys or user files included. Changes here do not automatically change the live service; run tests and deploy deliberately.','opensi')
skipdirs={'node_modules','__pycache__','venv','env','coverage','backups','qa','artifacts','dist','build','output','outputs','captures','releases','tmp','renders','render','target'}
secret=re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|AIza[\w-]{30,}|gh[pousr]_[A-Za-z0-9]{25,}|\d{8,12}:AA[\w-]{28,})\b|(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[=:]\s*["\'][^"\'\s]{16,}["\']',re.I)
private=re.compile(r'\.(?:pem|key|pfx|p12|db(?:-wal|-shm)?|sqlite3?(?:-wal|-shm)?|log|apk|exe|msi|safetensors|bin|tar|tgz|zip|tsbuildinfo)$',re.I)
text_ext={'.js','.mjs','.cjs','.jsx','.ts','.tsx','.py','.json','.yaml','.yml','.toml','.ini','.txt','.md','.html','.css','.sh','.ps1','.cmd','.sql'}
report=[]
for item in items:
 if os.environ.get('ONLY') and item['mode']!=os.environ['ONLY']:continue
 root=item['root']; mode=item['mode']; entries=[]; omitted=[]; total=0
 for current,dirs,files in os.walk(root):
  rel=Path(current).relative_to(root)
  dirs[:]=sorted(d for d in dirs if not d.startswith('.') and d not in skipdirs and not Path(current,d).is_symlink())
  if mode in ('preielts','portrait','pdfclean','docs'):dirs[:]=[]
  if mode=='largecode' and rel==Path('.'):dirs[:]=[d for d in dirs if d in {'src','server','scripts','tests','docs','public'}];omitted.extend([{'path':'data/','reason':'large models/database corpus left local'},{'path':'renders/','reason':'generated media left local'}])
  for name in sorted(files):
   p=Path(current,name); n=p.relative_to(root).as_posix()
   if mode=='preielts' and 'pre_ielts' not in name:continue
   if mode=='portrait' and name not in ['combine_id_images.ps1','crop_exact_3x4.ps1','rotate_crop_image.ps1']:continue
   if mode=='pdfclean' and name not in ['clean_multilevel_pair.py','clean_recent_speaking.py','clean_successors.py','clean_record_writing.py']:continue
   if name.startswith('.') or p.is_symlink() or private.search(name) or re.search(r'^(credentials|auth|service-account).*\.json$',name,re.I):omitted.append({'path':n,'reason':'private/config/generated'});continue
   size=p.stat().st_size
   if size>50_000_000 or total+size>200_000_000 or len(entries)>=2900 or (mode=='largecode' and size>2_000_000 and p.suffix.lower() not in text_ext) or (mode=='teacher' and size>128_000 and p.suffix.lower() not in text_ext):omitted.append({'path':n,'reason':'large resource retained locally','bytes':size});continue
   if p.suffix.lower() in text_ext and secret.search(p.read_text('utf8',errors='replace')):omitted.append({'path':n,'reason':'possible embedded credential'});continue
   entries.append((p,n));total+=size
 for p,n in item['extras']:
  if p.exists() and p.stat().st_size<50_000_000:entries.append((p,n));total+=p.stat().st_size
  else:omitted.append({'path':n,'reason':'source not found or larger than file limit'})
 if not entries:raise RuntimeError('No source files: '+item['title'])
 archive=OUT/(item['key']+'.zip');manifest={'title':item['title'],'snapshotSource':str(root),'notes':item['notes'],'files':[],'omitted':omitted,'checks':'Snapshot only; project build and integrations not reverified.'}
 with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3) as z:
  for p,n in entries:
   data=p.read_bytes();z.writestr(n,data);manifest['files'].append({'path':n,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
  z.writestr('opensi-source-manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2).encode())
 report.append({'sourceKey':item['key'],'title':item['title'],'notes':item['notes'],'archive':archive.name,'files':len(entries),'omitted':len(omitted),'bytes':total})
 print(json.dumps({'title':item['title'],'files':len(entries),'MB':round(total/1e6,2),'omitted':len(omitted)},ensure_ascii=False),flush=True)
if os.environ.get('ONLY'):
 old=json.loads((OUT/'batch.json').read_text('utf8'));bykey={x['sourceKey']:x for x in report};report=[bykey.get(x['sourceKey'],x) for x in old]
(OUT/'batch.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
