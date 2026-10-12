const key = (userId: string) => `opensi.montage.pending.${userId}`;
const fallback = new Map<string, string[]>();

export function queueMontageAsset(userId: string, assetId: string) {
  if (!userId || !assetId) return;
  const storageKey = key(userId);
  try {
    const existing = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
    const pending = Array.isArray(existing) ? existing.filter((id): id is string => typeof id === 'string').slice(-47) : [];
    pending.push(assetId);
    sessionStorage.setItem(storageKey, JSON.stringify(pending));
  } catch {
    fallback.set(userId, [...(fallback.get(userId) || []).slice(-47), assetId]);
  }
}

export function takeMontageAssets(userId: string): string[] {
  if (!userId) return [];
  const memory = fallback.get(userId) || [];
  fallback.delete(userId);
  try {
    const pending = JSON.parse(sessionStorage.getItem(key(userId)) || '[]');
    sessionStorage.removeItem(key(userId));
    return [...(Array.isArray(pending) ? pending.filter((id): id is string => typeof id === 'string') : []), ...memory].slice(0, 48);
  } catch {
    return memory;
  }
}
