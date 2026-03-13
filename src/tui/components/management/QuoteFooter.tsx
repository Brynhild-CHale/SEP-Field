/**
 * useQuoteLines — returns word-wrapped quote text as plain strings.
 *
 * ConsoleFrame wraps these lines in │...│ with padding.
 */

import { useQuoteGlitch } from '../../hooks/useQuoteGlitch.ts';
import { useGarble } from '../effects/DimContext.tsx';

export function useQuoteLines(quoteIndex: number, innerWidth: number): string[] {
	const g = useGarble();
	const { text } = useQuoteGlitch(quoteIndex);

	const lines: string[] = [];
	const words = text.split(' ');
	let line = '';
	for (const w of words) {
		if (line.length + w.length + 1 > innerWidth - 4) {
			lines.push(line);
			line = w;
		} else {
			line += (line.length > 0 ? ' ' : '') + w;
		}
	}
	if (line.length > 0) lines.push(line);

	return lines.map((l, i) => {
		const prefix = i === 0 ? ' "' : '  ';
		const suffix = i === lines.length - 1 ? '"' : '';
		return `${prefix}${g(l)}${suffix}`;
	});
}
