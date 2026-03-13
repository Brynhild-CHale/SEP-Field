import { useState, useEffect } from 'react';

/**
 * Returns a 0→1 progress value over `durationMs`.
 * Resets when `key` changes.
 */
export function useAnimation(durationMs: number, fps: number = 30, key?: unknown): number {
	const [progress, setProgress] = useState(0);

	useEffect(() => {
		setProgress(0);
		const interval = 1000 / fps;
		const step = interval / durationMs;

		const timer = setInterval(() => {
			setProgress(p => {
				const next = p + step;
				if (next >= 1) {
					clearInterval(timer);
					return 1;
				}
				return next;
			});
		}, interval);

		return () => clearInterval(timer);
	}, [durationMs, fps, key]);

	return progress;
}
