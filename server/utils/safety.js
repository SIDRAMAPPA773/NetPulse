class Semaphore {
  constructor(max) {
    this.max = Math.max(1, max);
    this.current = 0;
    this.queue = [];
  }
  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve(() => this.release());
      });
    });
  }
  release() {
    this.current = Math.max(0, this.current - 1);
    if (this.queue.length) {
      const next = this.queue.shift();
      next();
    }
  }
}

function createRateLimiter({ maxPerSecond }) {
  const interval = 1000 / Math.max(1, maxPerSecond);
  let last = 0;
  const lock = async () => {
    const now = Date.now();
    const wait = Math.max(0, last + interval - now);
    last = now + wait;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };
  return { acquire: lock };
}

module.exports = { Semaphore, createRateLimiter };
