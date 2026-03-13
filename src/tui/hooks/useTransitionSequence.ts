/**
 * Transition state machine.
 *
 * Switcher → Management: 10 phases over ~2.8s
 * Management → Switcher: 3 phases over ~150ms
 *
 * Driven by setTimeout chains. Updates the zustand store directly
 * so the orchestrator and TransitionRenderer can read current phase.
 */

import { useEffect, useRef } from 'react';
import { store, type TransitionPhase } from '../store.ts';

interface PhaseSpec {
	phase: TransitionPhase;
	duration: number;
}

const FORWARD_SEQUENCE: PhaseSpec[] = [
	{ phase: 'pinch', duration: 200 },
	{ phase: 'line-hold', duration: 150 },
	{ phase: 'line-collapse', duration: 100 },
	{ phase: 'darkness', duration: 400 },
	{ phase: 'cursor-blink', duration: 600 },
	{ phase: 'frame-draw', duration: 300 },
	{ phase: 'false-start', duration: 200 },
	{ phase: 'scan', duration: 150 },
	{ phase: 'content-fill', duration: 500 },
	{ phase: 'stabilize', duration: 200 },
];

const REVERSE_SEQUENCE: PhaseSpec[] = [
	{ phase: 'collapse', duration: 100 },
	{ phase: 'black', duration: 50 },
];

export function useTransitionSequence() {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		const instantResolve = (finalMode: 'switcher' | 'management') => {
			store.setState({ mode: finalMode, transitionPhase: 'idle', transitionProgress: 0 });
		};

		const unsubscribe = store.subscribe((state, prev) => {
			// Detect transition start
			if (state.mode === 'transition-to-mgmt' && prev.mode !== 'transition-to-mgmt') {
				if (!store.getState().effectsEnabled) { instantResolve('management'); return; }
				runSequence(FORWARD_SEQUENCE, 'management');
			} else if (state.mode === 'transition-to-switcher' && prev.mode !== 'transition-to-switcher') {
				if (!store.getState().effectsEnabled) { instantResolve('switcher'); return; }
				runSequence(REVERSE_SEQUENCE, 'switcher');
			}
		});

		// Check if we're already in a transition mode on mount
		const current = store.getState();
		if (current.mode === 'transition-to-mgmt') {
			if (!current.effectsEnabled) { instantResolve('management'); }
			else { runSequence(FORWARD_SEQUENCE, 'management'); }
		} else if (current.mode === 'transition-to-switcher') {
			if (!current.effectsEnabled) { instantResolve('switcher'); }
			else { runSequence(REVERSE_SEQUENCE, 'switcher'); }
		}

		return () => {
			unsubscribe();
			if (timerRef.current) clearTimeout(timerRef.current);
			if (progressRef.current) clearInterval(progressRef.current);
		};
	}, []);

	function runSequence(sequence: PhaseSpec[], finalMode: 'switcher' | 'management') {
		let idx = 0;

		function advancePhase() {
			if (idx >= sequence.length) {
				// Transition complete
				store.setState({
					mode: finalMode,
					transitionPhase: 'idle',
					transitionProgress: 0,
				});
				return;
			}

			const spec = sequence[idx];
			store.setState({ transitionPhase: spec.phase, transitionProgress: 0 });

			// Tick progress within this phase at ~30fps
			const tickMs = 33;
			const step = tickMs / spec.duration;
			progressRef.current = setInterval(() => {
				const current = store.getState().transitionProgress;
				const next = Math.min(1, current + step);
				store.setState({ transitionProgress: next });
			}, tickMs);

			// After duration, advance to next phase
			timerRef.current = setTimeout(() => {
				if (progressRef.current) {
					clearInterval(progressRef.current);
					progressRef.current = null;
				}
				store.setState({ transitionProgress: 1 });
				idx++;
				advancePhase();
			}, spec.duration);
		}

		advancePhase();
	}
}
