import importlib.metadata as metadata
import json,shutil,subprocess

commands={'node':['node','--version'],'python':['python3','--version'],'blender':['blender','--version'],'ffmpeg':['ffmpeg','-version'],'ffprobe':['ffprobe','-version'],'gcc':['gcc','--version'],'go':['go','version'],'java':['java','-version'],'php':['php','--version'],'ruby':['ruby','--version'],'lua':['lua5.4','-v'],'sqlite':['sqlite3','--version']}
versions={}
for name,args in commands.items():
    if not shutil.which(args[0]): versions[name]=None;continue
    try:
        p=subprocess.run(args,capture_output=True,text=True,timeout=8)
        versions[name]=(p.stdout or p.stderr).splitlines()[0]
    except Exception: versions[name]='version check failed'
packages={}
for name in ['requests','flask','fastapi','pandas','numpy','scipy','matplotlib','scikit-learn','opencv-python-headless','moviepy','pygame-ce','trimesh','pygltflib','librosa','reportlab','python-docx','python-pptx','openpyxl','PyMuPDF','yt-dlp','pytest','ruff']:
    try: packages[name]=metadata.version(name)
    except metadata.PackageNotFoundError: packages[name]=None
print(json.dumps({'commands':versions,'pythonPackages':packages,'mode':'CPU headless','network':'Use http_get, youtube_analyze, computer tools or webhook HTTPS bridge. Direct terminal network is disabled.','blender':'blender -b -t 1 --python scene.py','video':'ffmpeg -threads 1 ...; inspect output with ffprobe','limits':'Per command 110 seconds, 768 MB RAM; split long renders into frame batches. No GPU.'},ensure_ascii=False))
