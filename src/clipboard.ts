// Some screenshot tools expose clipboard items but leave DataTransfer.files empty.
export function clipboardFiles(data: Pick<DataTransfer, 'files' | 'items'>): File[] {
  const files = Array.from(data.files || []);
  if (files.length) return files;
  return Array.from(data.items || []).flatMap(item => {
    if (item.kind !== 'file') return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}
