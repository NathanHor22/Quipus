export interface QueueLoopOptions {
  concurrency: number;
  pollIntervalMs: number;
  runNext: () => Promise<boolean>;
  onError: (error: unknown) => void;
}

/** Bounded drain loop; wakeups accelerate SQL polling but never carry a job. */
export class QueueLoop {
  private readonly active = new Set<Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private stopping = false;

  constructor(private readonly options: QueueLoopOptions) {
    if (
      !Number.isInteger(options.concurrency) ||
      options.concurrency < 1 ||
      options.concurrency > 4
    ) {
      throw new Error("Queue concurrency must be an integer between 1 and 4.");
    }
    if (!Number.isInteger(options.pollIntervalMs) || options.pollIntervalMs < 100) {
      throw new Error("Queue polling interval must be at least 100ms.");
    }
  }

  get activeCount(): number {
    return this.active.size;
  }

  start(): void {
    if (this.timer || this.stopping) return;
    this.timer = setInterval(() => this.wake(), this.options.pollIntervalMs);
    this.wake();
  }

  wake(): void {
    if (this.stopping) return;
    this.generation++;
    while (this.active.size < this.options.concurrency) {
      // Start on the next microtask so the slot is reserved before runNext runs.
      const task = Promise.resolve()
        .then(() => this.drain())
        .finally(() => this.active.delete(task));
      this.active.add(task);
    }
  }

  private async drain(): Promise<void> {
    while (!this.stopping) {
      const generation = this.generation;
      try {
        const processed = await this.options.runNext();
        if (!processed && generation === this.generation) return;
        // Yield between jobs, including in test adapters that resolve synchronously.
        await new Promise<void>((resolve) => setImmediate(resolve));
      } catch (error) {
        this.options.onError(error);
        return; // Back off until the next poll instead of hammering an outage.
      }
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.allSettled([...this.active]);
  }
}
