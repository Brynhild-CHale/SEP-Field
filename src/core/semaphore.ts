/**
 * Async Semaphore — FIFO queue with configurable permits
 *
 * Used for:
 * - ColimaManager: serialize VM starts (permits=1)
 * - ContainerManager: limit concurrent devcontainer up (permits=2)
 * - ContainerManager: mutex on ~/.claude/.claude.json writes (permits=1)
 */

type Resolver = () => void;

export class Semaphore {
	private permits: number;
	private queue: Resolver[] = [];

	constructor(permits: number) {
		if (permits < 1) throw new Error('Semaphore permits must be >= 1');
		this.permits = permits;
	}

	/** Acquire a permit. Resolves immediately if one is available, otherwise waits in FIFO order. */
	async acquire(): Promise<void> {
		if (this.permits > 0) {
			this.permits--;
			return;
		}
		return new Promise<void>((resolve) => {
			this.queue.push(resolve);
		});
	}

	/** Release a permit. Wakes the next waiter if any. */
	release(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.permits++;
		}
	}

	/** Run an async function while holding a permit. */
	async run<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await fn();
		} finally {
			this.release();
		}
	}

	/** Current number of available permits. */
	get available(): number {
		return this.permits;
	}

	/** Number of waiters in the queue. */
	get waiting(): number {
		return this.queue.length;
	}
}
