import path from 'node:path';
import {existsSync} from 'node:fs';
export function chromeExecutable({platform=process.platform,env=process.env,exists=existsSync}={}) {
  const candidates=platform==='win32'?[
    env.PROGRAMFILES&&path.join(env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),
    env['PROGRAMFILES(X86)']&&path.join(env['PROGRAMFILES(X86)'],'Google/Chrome/Application/chrome.exe'),
    env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe'),
  ]:platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']:['/usr/bin/google-chrome','/usr/bin/google-chrome-stable'];
  const executable=candidates.find(p=>p&&exists(p));
  if(!executable)throw Error('Google Chrome topilmadi. Kompyuterga Chrome o‘rnating yoki Bulut brauzerini tanlang.');
  return executable;
}
