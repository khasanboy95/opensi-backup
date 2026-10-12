// Combine small stdout chunks so network latency does not delay a finished task.
export function progressSender(send) {
  let buffer = '', timer; let queue = Promise.resolve();
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    queue = queue.then(async () => {
      while (buffer) {
        const output = buffer.slice(0, 8192); buffer = buffer.slice(8192);
        await send(output).catch(() => {});
      }
    });
    return queue;
  };
  return {
    push(text) { buffer += text; if (!timer) timer = setTimeout(flush, 150); },
    flush,
  };
}
