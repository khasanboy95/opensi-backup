import {readFile,stat} from 'node:fs/promises';
import {listFiles,safePath} from './files.mjs';
import {matchProfiles} from './project-profiles.mjs';
export async function inspectProject(root,title=''){
 const files=await listFiles(root,{maxFiles:3000});
 const read=async name=>{try{const p=await safePath(root,name);return (await stat(p)).size<=500000?await readFile(p,'utf8'):'';}catch{return '';}};
 let pkg={};try{pkg=JSON.parse(await read('package.json')||'{}');}catch{}
 const requirements=await read('requirements.txt'),pyproject=await read('pyproject.toml');
 const stack=[...(pkg.dependencies?.next?['Next.js']:[]),...(pkg.dependencies?.react?['React']:[]),...(pkg.devDependencies?.vite||pkg.dependencies?.vite?['Vite']:[]),...(requirements||pyproject||files.some(f=>f.path.endsWith('.py'))?['Python']:[])];
 const profileText=title+' '+(pkg.name||'')+' '+files.slice(0,100).map(f=>f.path).join(' ');
 return {files:files.length,bytes:files.reduce((n,f)=>n+f.size,0),stack,profiles:matchProfiles(profileText).map(p=>({id:p.id,name:p.name,steps:p.steps})),scripts:pkg.scripts||{},dependencies:Object.keys({...pkg.dependencies,...pkg.devDependencies}),pythonRequirements:requirements.slice(0,8000),entrypoints:files.filter(f=>/(^|\/)(README[^/]*|AGENTS\.md|package\.json|requirements\.txt|pyproject\.toml|index\.html|main\.py|app\.py|server\.[cm]?js|opensi-handoff\.md|opensi-import\.json)$/.test(f.path)).map(f=>f.path).slice(0,60),documents:files.filter(f=>/\.(pdf|docx|xlsx|pptx|mp3|mp4|wav)$/i.test(f.path)).map(f=>({path:f.path,bytes:f.size})).slice(0,60),checks:'Inventory only. Dependencies, external services and test results require actual verification.'};
}
