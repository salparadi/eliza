export class RateLimiter {
  private queue: Map<string, Promise<any>> = new Map();
  private timestamps: Map<string, number> = new Map();
  private readonly rateLimit: number;
  private readonly interval: number;

  constructor(requestsPerInterval: number, intervalMs: number) {
    this.rateLimit = requestsPerInterval;
    this.interval = intervalMs;
  }

  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    await this.waitForSlot(key);

    try {
      const result = await fn();
      this.updateTimestamp(key);
      return result;
    } catch (error) {
      throw error;
    }
  }

  private async waitForSlot(key: string) {
    const now = Date.now();
    const recent = Array.from(this.timestamps.values())
      .filter(timestamp => now - timestamp < this.interval);

    if (recent.length >= this.rateLimit) {
      const oldestTimestamp = Math.min(...recent);
      const waitTime = this.interval - (now - oldestTimestamp);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  private updateTimestamp(key: string) {
    this.timestamps.set(key, Date.now());

    // Cleanup old timestamps
    const now = Date.now();
    for (const [key, timestamp] of this.timestamps.entries()) {
      if (now - timestamp > this.interval) {
        this.timestamps.delete(key);
      }
    }
  }
}