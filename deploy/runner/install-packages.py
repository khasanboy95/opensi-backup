import base64,json,os,pathlib,re,subprocess,sys,shutil

packages=json.loads(base64.urlsafe_b64decode(sys.argv[1]+'==='))
pattern=r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}(==[A-Za-z0-9_.+!-]{1,40})?'
if not isinstance(packages,list) or not 1<=len(packages)<=8 or any(not isinstance(p,str) or not re.fullmatch(pattern,p) for p in packages):
    raise ValueError('Use up to 8 PyPI package names, optionally with ==version')
root=pathlib.Path('/workspace/.opensi-python')
if root.is_symlink(): raise ValueError('Invalid package directory')
root.mkdir(exist_ok=True)
if shutil.disk_usage(root).free<1_000_000_000: raise RuntimeError('Less than 1 GB free disk; package installation postponed')
result=subprocess.run([sys.executable,'-I','-m','pip','--isolated','--disable-pip-version-check','--proxy',os.environ['OPENSI_PACKAGE_PROXY'],'install','--index-url','https://pypi.org/simple','--only-binary=:all:','--no-cache-dir','--no-compile','--upgrade','--target',str(root),*packages],timeout=95)
if result.returncode: sys.exit(result.returncode)
installed={}
for entry in root.glob('*.dist-info/METADATA'):
    name=version=None
    for line in entry.read_text(errors='replace').splitlines():
        if line.startswith('Name: '): name=line[6:]
        if line.startswith('Version: '): version=line[9:]
        if name and version: break
    if name and version: installed[name]=version
pathlib.Path('/workspace/python-packages.lock.json').write_text(json.dumps(installed,indent=2))
print(json.dumps({'installed':installed,'scope':'this project','importPath':str(root)}))
