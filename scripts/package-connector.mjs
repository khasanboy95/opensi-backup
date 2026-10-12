import {build} from 'esbuild';
import {mkdtemp,writeFile,readFile,rm,mkdir,cp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {projectZip} from '../server/archive.mjs';
const root=process.cwd();const temp=await mkdtemp(path.join(os.tmpdir(),'opensi-connector-'));
try {
 await build({entryPoints:[path.join(root,'connector/index.mjs')],bundle:true,external:['playwright-core'],platform:'node',target:'node24',format:'esm',outfile:path.join(temp,'opensi-connector.mjs'),banner:{js:'import {createRequire as bundleCreateRequire} from "node:module"; const require=bundleCreateRequire(import.meta.url);'}});
 await cp(path.join(root,'node_modules/playwright-core'),path.join(temp,'browser-runtime'),{recursive:true});
 await writeFile(path.join(temp,'Link-Folder.ps1'),await readFile('connector/Link-Folder.ps1'));
 await writeFile(path.join(temp,'Start-OpenSI.ps1'),await readFile('connector/Start-OpenSI.ps1'));
 await writeFile(path.join(temp,'Start-Windows.cmd'),'@echo off\r\ncd /d "%~dp0"\r\npowershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Start-Windows.ps1"\r\npause\r\n');
 await writeFile(path.join(temp,'Start-Windows.ps1'),await readFile('connector/Install-Windows.ps1'));
 await mkdir('public/downloads',{recursive:true});await writeFile('public/downloads/Install-Windows.ps1',await readFile('connector/Install-Windows.ps1'));
 await writeFile(path.join(temp,'README.txt'),'OpenSI lokal connector\n\nNode.js 24+ kerak.\nWindows: Start-Windows.cmd faylini oching va papka tanlang.\nmacOS/Linux: node opensi-connector.mjs --server https://YOUR-OPENSI --code PAIR_CODE --workspace /your/folder\n\nHar loyiha tanlangan papka ichida prj_... nomli alohida katalogda saqlanadi.\nKompyuter yoqilgan va connector ochiq bo‘lsin. Ctrl+C bilan to‘xtating.\nTerminal Guided rejimda tasdiq bilan, Avtomatik rejimda topshiriq bo‘yicha shu OS hisobining huquqlari bilan ishlaydi. Bot/API jarayonlari connector ochiq turganda ishlaydi; connector yopilishi ularni to‘xtatadi.\nTelefon brauzeridan ham shu hisobning online kompyuter connectorini masofadan boshqarish mumkin. Kompyuter o‘chsa Antigravity offline bo‘ladi. Bulut modellari kompyutersiz ham ishlaydi. Fayllar 1 GB gacha.\n');
 await mkdir('public/downloads',{recursive:true});await writeFile('public/downloads/opensi-connector.zip',await projectZip(temp));
 console.log('Connector ZIP tayyor; Node.js 24+, alohida npm install talab qilinmaydi.');
} finally {if(path.dirname(temp)!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('opensi-connector-'))throw new Error('Cleanup path rejected');await rm(temp,{recursive:true,force:true});}
