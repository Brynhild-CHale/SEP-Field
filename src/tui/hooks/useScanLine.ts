import { useState, useEffect } from 'react';

/**
 * Returns the current row index for the scan-line effect.
 * Scrolls top→bottom over `period` ms, then wraps.
 */
export function useScanLine(rows: number, period = 3500): number {
	const [position, setPosition] = useState(0);

	useEffect(() => {
		if (rows <= 0) return;
		const tickMs = Math.max(50, Math.floor(period / rows));
		const timer = setInterval(() => {
			setPosition(p => (p + 1) % rows);
		}, tickMs);
		return () => clearInterval(timer);
	}, [rows, period]);

	return position;
}
