import os,json,pathlib
base=pathlib.Path(r'C:\Users\LAPTOP\Documents\New project')
other=pathlib.Path(r'D:\Dastur 1\14')
roots=[base/x for x in ['ielts-reading-maximizer','pre-ielts-uz','nexora-marketplace','twins-dictionary-clone','laptopstore-web-20261009','tushuntir-ai','salomat-ai','ufq-lab']]+[other/x for x in ['twins-voice','nft-battle-bot','teacher-khasan-writing','vercel-zip-app','opensi']]
skip={'node_modules','venv','env','__pycache__','backups','coverage','qa','artifacts','dist','build','output','outputs','captures','releases','tmp'}
reports=[]
for root in roots:
 files=[]
 for folder,dirs,names in os.walk(root):
  dirs[:]=[d for d in dirs if not d.startswith('.') and d not in skip and not pathlib.Path(folder,d).is_symlink()]
  for name in names:
   p=pathlib.Path(folder,name)
   if name.startswith('.') or p.is_symlink():continue
   files.append((p.relative_to(root).as_posix(),p.stat().st_size))
 package={}
 try:package=json.loads((root/'package.json').read_text(encoding='utf-8-sig'))
 except:pass
 reports.append({'root':str(root),'files':len(files),'MB':round(sum(s for _,s in files)/1e6,2),'largest':sorted(files,key=lambda x:x[1],reverse=True)[:3],'scripts':list(package.get('scripts',{})),'dependencies':list(package.get('dependencies',{}))})
pathlib.Path('.codex/continuation').mkdir(parents=True,exist_ok=True)
pathlib.Path('.codex/continuation/inventory.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(reports,ensure_ascii=False,indent=2))
