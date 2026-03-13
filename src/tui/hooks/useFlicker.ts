import { useState, useEffect, useRef } from 'react';

/**
 * Returns true during random "flicker" events.
 * Sequence: on → hold → rapid flicker-out → full brightness.
 */
export function useFlicker(minInterval = 8000, maxInterval = 25000, minHold = 3000, maxHold = 8000, enabled = true): boolean {
	const [flickering, setFlickering] = useState(false);
	const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

	useEffect(() => {
		const clearAll = () => {
			for (const t of timers.current) clearTimeout(t);
			timers.current = [];
		};

		if (!enabled) { setFlickering(false); return clearAll; }

		const scheduleFlicker = () => {
			const delay = minInterval + Math.random() * (maxInterval - minInterval);
			timers.current.push(setTimeout(() => {
				// Phase 1: go dim and hold
				setFlickering(true);
				const holdDuration = minHold + Math.random() * (maxHold - minHold);

				timers.current.push(setTimeout(() => {
					// Phase 2: rapid flicker-out (2-3 quick toggles before settling)
					const flickers = 2 + Math.floor(Math.random() * 2); // 2 or 3
					let t = 0;
					for (let i = 0; i < flickers; i++) {
						const offDur = 40 + Math.random() * 30;
						const onDur = 30 + Math.random() * 40;
						timers.current.push(setTimeout(() => setFlickering(false), t));
						t += offDur;
						timers.current.push(setTimeout(() => setFlickering(true), t));
						t += onDur;
					}
					// Final off — back to full brightness
					timers.current.push(setTimeout(() => {
						setFlickering(false);
						scheduleFlicker();
					}, t));
				}, holdDuration));
			}, delay));
		};
		scheduleFlicker();

		return clearAll;
	}, [minInterval, maxInterval, minHold, maxHold, enabled]);

	return flickering;
}
