import path from 'node:path';
import { mkdir, readdir, readFile, writeFile, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { HttpError } from './security.mjs';

export function validFileName(name) {
  if (typeof name !== 'string' || !name || name.length > 240 || /[\x00-\x1f\\:<>"|?*]/.test(name) || path.posix.isAbsolute(name)) throw new HttpError(400, 'Fayl yo‘li noto‘g‘ri.');
  const parts = name.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.') || /^(nul|con|prn|aux|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new HttpError(400, 'Yashirin, tizim yoki workspace tashqarisidagi faylga ruxsat yo‘q.');
  if (parts.some(part => ['node_modules', '.git'].includes(part))) throw new HttpError(400, 'Bu katalogga ruxsat yo‘q.');
  return name;
}

export async function safePath(root, name) {
  validFileName(name);
  await mkdir(root, { recursive: true });
  const actualRoot = await realpath(root);
  const target = path.resolve(actualRoot, ...name.split('/'));
  const relative = path.relative(actualRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new HttpError(403, 'Workspace tashqarisidagi yo‘l.');
  let current = actualRoot;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new HttpError(403, 'Symlink fayllar ochilmaydi.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}

export function projectRoot(config, project) {
  return path.join(config.dataDir, 'workspaces', project.user_id, project.id);
}

export async function listFiles(root, {maxFiles=5000,strict=false}={}) {
  await mkdir(root, { recursive: true });
  const files = [];
  async function walk(dir, prefix = '', depth = 0) {
    if (depth > 16 || files.length >= maxFiles) {if(strict)throw new HttpError(413,'Loyiha fayllari soni yoki katalog chuqurligi eksport chegarasidan oshdi.');return;}
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'nul'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${name}/`, depth + 1);
      else if (entry.isFile()) {
        const stat = await lstat(path.join(dir, entry.name));
        files.push({ path: name, size: stat.size, updated_at: stat.mtime.toISOString() });
      }
      if (files.length >= maxFiles) {if(strict)throw new HttpError(413,'Eksportda fayllar soni chegaradan oshdi.');break;}
    }
  }
  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function fileTool(root, tool, args) {
  if (tool === 'list_files') {const all=(await listFiles(root)).filter(f=>!args.path||f.path.startsWith(args.path));const offset=Math.max(0,args.offset||0),limit=Math.min(500,Math.max(1,args.limit||200));return {files:all.slice(offset,offset+limit),total:all.length,nextOffset:offset+limit<all.length?offset+limit:null,truncated:offset+limit<all.length};}
  if (tool === 'search_files') {
    if (typeof args.query !== 'string' || !args.query || args.query.length > 500) throw new HttpError(400,'Qidiruv matni noto‘g‘ri.');
    const matches=[];
    for (const file of await listFiles(root)) {
      if (args.path && !file.path.startsWith(args.path)) continue;
      let content; try { content=(await fileTool(root,'read_file',{path:file.path})).content; } catch { continue; }
      for (const [index,line] of content.split('\n').entries()) if(line.toLowerCase().includes(args.query.toLowerCase())) {
        matches.push({path:file.path,line:index+1,text:line.slice(0,500)});
        if(matches.length>=80)return {matches,truncated:true};
      }
    }
    return {matches,truncated:false};
  }
  if (tool === 'rename_file') {
    const from=await safePath(root,args.from), target=await safePath(root,args.path);
    if(!(await lstat(from)).isFile()) throw new HttpError(400,'Faqat faylni ko‘chirish mumkin.');
    try{await lstat(target);throw new HttpError(409,'Bu nomdagi fayl mavjud.');}catch(error){if(error.code!=='ENOENT')throw error;}
    await mkdir(path.dirname(target),{recursive:true});await rename(from,target);return {from:args.from,path:args.path,renamed:true};
  }
  if (tool === 'copy_file') {
    const source = await fileTool(root, 'read_file', { path: args.from });
    return { ...(await fileTool(root, 'write_file', { path: args.path, content: source.content })), from: args.from };
  }
  const target = await safePath(root, args.path);
  if (tool === 'delete_file') {if(!(await lstat(target)).isFile()) throw new HttpError(400,'Faqat faylni o‘chirish mumkin.');await unlink(target);return {path:args.path,deleted:true};}
  if (tool === 'read_file') {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.size > 500_000) throw new HttpError(400, 'Matn fayli 500 KB dan kichik bo‘lishi kerak.');
    const data = await readFile(target);
    if (data.includes(0)) throw new HttpError(400, 'Bu ikkilik fayl. Matn faylini tanlang.');
    const content = data.toString('utf8');
    if (args.offset !== undefined || args.limit !== undefined) {
      const offset = Math.min(Math.max(0, Number(args.offset || 0)), content.length);
      const end = Math.min(offset + Math.min(Math.max(1, Number(args.limit || 12000)), 20000), content.length);
      return { path: args.path, content: content.slice(offset, end), offset, nextOffset: end, total: content.length, truncated: end < content.length };
    }
    return { path: args.path, content };
  }
  if (tool === 'write_file') {
    if (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 500_000) throw new HttpError(400, 'Fayl tarkibi 500 KB dan oshmasligi kerak.');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, args.content, 'utf8');
    return { path: args.path, bytes: Buffer.byteLength(args.content), saved: true };
  }
  if (['append_file', 'edit_file'].includes(tool)) {
    const previous = await fileTool(root, 'read_file', { path: args.path });
    let content;
    if (tool === 'append_file') {
      if (typeof args.content !== 'string') throw new HttpError(400, 'Qo‘shiladigan kod matn bo‘lishi kerak.');
      content = previous.content + args.content;
    } else {
      if (typeof args.search !== 'string' || !args.search || typeof args.replace !== 'string') throw new HttpError(400, 'Qidirish va almashtirish matnlarini kiriting.');
      const first = previous.content.indexOf(args.search);
      if (first < 0) throw new HttpError(409, 'Qidirilgan kod topilmadi. Faylni qayta o‘qing.');
      if (previous.content.indexOf(args.search, first + 1) >= 0) throw new HttpError(409, 'Qidirilgan kod bir necha joyda bor. Aniqroq parcha tanlang.');
      content = previous.content.slice(0, first) + args.replace + previous.content.slice(first + args.search.length);
    }
    return fileTool(root, 'write_file', { path: args.path, content });
  }
  throw new HttpError(400, 'Noma’lum fayl vositasi.');
}
