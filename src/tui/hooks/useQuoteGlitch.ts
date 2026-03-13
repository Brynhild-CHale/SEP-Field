import { useState, useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { store } from '../store.ts';
import { quotes } from '../data/quotes.ts';

const BOX_CHARS = '┌┐└┘├┤┬┴┼─│═║╔╗╚╝╠╣╦╩╬░▒▓█';

function scramble(text: string): string {
	return text
		.split('')
		.map(ch => (ch === ' ' ? ' ' : BOX_CHARS[Math.floor(Math.random() * BOX_CHARS.length)]))
		.join('');
}

/**
 * Returns the current quote text (possibly glitched) and the quote index.
 * Glitch fires every 60-120s, duration 200-400ms.
 */
export function useQuoteGlitch(quoteIndex: number): { text: string; glitching: boolean } {
	const effectsEnabled = useStore(store, s => s.effectsEnabled);
	const [glitching, setGlitching] = useState(false);
	const [glitchText, setGlitchText] = useState('');
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const resolveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!effectsEnabled) return;

		const scheduleGlitch = () => {
			const delay = 60000 + Math.random() * 60000;
			timeoutRef.current = setTimeout(() => {
				const original = quotes[quoteIndex] || quotes[0];
				setGlitchText(scramble(original));
				setGlitching(true);
				const duration = 200 + Math.random() * 200;
				resolveRef.current = setTimeout(() => {
					setGlitching(false);
					scheduleGlitch();
				}, duration);
			}, delay);
		};
		scheduleGlitch();

		return () => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
			if (resolveRef.current) clearTimeout(resolveRef.current);
		};
	}, [quoteIndex, effectsEnabled]);

	const text = glitching ? glitchText : (quotes[quoteIndex] || quotes[0]);
	return { text, glitching };
}
