export function Brand({ size = 32 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true" className="brand-mark"><path d="M5 16 24 3v15L5 31zm13 10 12-9 7 6-19 14z" fill="currentColor" /></svg>;
}
export function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.23c1.89-1.74 2.99-4.3 2.99-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.41l-3.23-2.51c-.9.6-2.04.96-3.38.96-2.6 0-4.81-1.76-5.6-4.13H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.91a6 6 0 0 1 0-3.82V7.5H3.07a10 10 0 0 0 0 9l3.33-2.59Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.83 1.51l2.87-2.87A9.59 9.59 0 0 0 12 2a10 10 0 0 0-8.93 5.5l3.33 2.59C7.19 7.72 9.4 5.96 12 5.96Z"/></svg>;
}
