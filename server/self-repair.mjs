import {packageName} from './packages.mjs';

// Only install a package when a failed command identifies the missing import.
// Terminal output is untrusted; never execute commands copied from it.
const pythonDistributions = new Map(Object.entries({
  PIL:'Pillow',cv2:'opencv-python-headless',bs4:'beautifulsoup4',yaml:'PyYAML',
  sklearn:'scikit-learn',docx:'python-docx',pptx:'python-pptx',fitz:'PyMuPDF',
  dateutil:'python-dateutil',dotenv:'python-dotenv',telegram:'python-telegram-bot',
  jwt:'PyJWT',serial:'pyserial',Crypto:'pycryptodome',
}));
const normalized = value => value.toLowerCase().replace(/[-_.]+/g,'-');

// Repeating a broad shell command can duplicate side effects. Only replay
// isolated import checks and conventional test/build commands after install.
export function retryableDependencyCheck(command=''){
 const value=String(command).trim();
 if(!value||/[;&|><`\r\n]/.test(value))return false;
 return /^(?:python(?:3)?\s+-c\s+['"](?:import|from)\s+[A-Za-z][A-Za-z0-9_.]*(?:\s|['"]|$)|python(?:3)?\s+-m\s+(?:pytest|unittest|compileall)(?:\s|$)|pytest(?:\s|$)|npm\s+(?:test|run\s+(?:build|test|check|lint))(?:\s|$)|npx\s+(?:tsc|vite\s+build)(?:\s|$)|node\s+--check\s+)/i.test(value);
}

export function dependencyRepairPlan({command='',result,requirements='',packageJson=null,canPython=false,canNode=false}={}){
  if(!result || result.exitCode===0 || result.timedOut || result.denied || !Number.isInteger(result.exitCode))return null;
  if(/(?:^|\s)(?:pip\s+install|npm\s+(?:install|ci))(?:\s|$)/i.test(command))return null;
  const output=String(result.output||'').slice(-16000);
  if(canPython){
    const found=output.match(/(?:ModuleNotFoundError|ImportError):\s+No module named ['"]([A-Za-z][A-Za-z0-9_.]*)['"]/);
    if(found){
      const module=found[1].split('.')[0];
      const declared=requirements.split(/\r?\n/).map(line=>line.replace(/\s+#.*$/,'').trim()).filter(line=>packageName.test(line));
      const distribution=pythonDistributions.get(module)||declared.find(item=>normalized(item.split('==')[0])===normalized(module));
      if(distribution&&packageName.test(distribution))return {kind:'python',module,packages:[distribution],key:`python:${normalized(distribution)}`};
    }
  }
  if(canNode&&packageJson){
    const found=output.match(/(?:Cannot find (?:package|module)|TS2307: Cannot find module)\s+['"]([^'"\s]+)['"]/);
    if(found){
      const missing=found[1];
      const name=missing.startsWith('@')?missing.split('/').slice(0,2).join('/'):missing.split('/')[0];
      const declared={...packageJson.dependencies,...packageJson.devDependencies};
      if(!missing.startsWith('.')&&!missing.startsWith('/')&&!missing.startsWith('node:')&&Object.hasOwn(declared,name))return {kind:'node',module:name,packages:[name],key:`node:${name}`};
    }
  }
  return null;
}
