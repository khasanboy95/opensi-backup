// Modern sites request hundreds of modules at once. Keep the validated
// transport below the CDN's connection limit while preserving request order.
export function browserRequestLimit(maxActive = 12) {
  let active = 0;
  let closed = false;
  const waiting = [];
  const controller = new AbortController();
  const closedError = () => new Error('Brauzer sessiyasi yopilgan.');
  return {
    get active() { return active; },
    get waiting() { return waiting.length; },
    async run(task) {
      if (closed) throw closedError();
      if (active < maxActive) active++;
      else await new Promise((resolve, reject) => waiting.push({ resolve, reject }));
      try {
        if (closed) throw closedError();
        return await task(controller.signal);
      } finally {
        if (waiting.length && !closed) waiting.shift().resolve();
        else active--;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      controller.abort(closedError());
      for (const item of waiting.splice(0)) item.reject(closedError());
    },
  };
}
