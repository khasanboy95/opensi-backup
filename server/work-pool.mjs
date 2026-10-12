// Cancellable, keyed FIFO admission. Rotate owners when more than one can run.
export class WorkPool {
  constructor(limit, perKey = limit) {
    if (![limit, perKey].every(n => Number.isInteger(n) && n > 0)) throw new Error('Invalid concurrency');
    this.limit = limit; this.perKey = perKey; this.active = 0; this.keys = new Map(); this.queue = []; this.lastKey = null;
  }
  acquire(key, signal) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const item = { key, signal, resolve, reject };
      item.abort = () => { this.queue = this.queue.filter(value => value !== item); reject(signal.reason || new Error('Cancelled')); this.pump(); };
      signal?.addEventListener('abort', item.abort, { once: true });
      this.queue.push(item); this.pump();
    });
  }
  pump() {
    while (this.active < this.limit) {
      const eligible = item => (this.keys.get(item.key) || 0) < this.perKey;
      let index = this.queue.findIndex(item => eligible(item) && item.key !== this.lastKey);
      if (index < 0) index = this.queue.findIndex(eligible);
      if (index < 0) break;
      const [item] = this.queue.splice(index, 1);
      item.signal?.removeEventListener('abort', item.abort);
      this.active++; this.keys.set(item.key, (this.keys.get(item.key) || 0) + 1); this.lastKey = item.key;
      let released = false;
      item.resolve(() => {
        if (released) return; released = true;
        this.active--; const count = this.keys.get(item.key) - 1;
        if (count) this.keys.set(item.key, count); else this.keys.delete(item.key);
        this.pump();
      });
    }
  }
  stats() { return { limit: this.limit, perUser: this.perKey, executing: this.active, queued: this.queue.length }; }
}
