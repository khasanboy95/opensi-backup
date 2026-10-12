export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { method: options.method || 'GET', credentials: 'same-origin', signal: options.signal,
    headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'x-opensi-client': 'web' },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
  const value = await response.json().catch(() => { throw new ApiError('Server javobi o‘qilmadi.', response.ok ? 502 : response.status); });
  if (!response.ok) throw new ApiError(value.error || `HTTP ${response.status}`, response.status);
  return value as T;
}
const monthNames = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
export function dateLabel(value: string | Date, withTime = false) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${get('day')}-${monthNames[Number(get('month')) - 1]}${withTime ? ` ${get('hour')}:${get('minute')}` : ''}`;
}
export const dateTime = (value: string) => dateLabel(value, true);
export const number = (value: number) => new Intl.NumberFormat('uz-UZ').format(value || 0);
export function downloadText(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
