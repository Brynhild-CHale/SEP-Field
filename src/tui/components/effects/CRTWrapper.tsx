/**
 * CRTWrapper — applies scan-line and flicker effects to Management Console.
 *
 * Uses DimContext to propagate flicker state to leaf <Text> elements,
 * avoiding the Ink error of nesting <Box> inside <Text>.
 */

import React from 'react';
import { Box } from 'ink';
import { useStore } from 'zustand';
import { store } from '../../store.ts';
import { useFlicker } from '../../hooks/useFlicker.ts';
import { DimProvider, GarbleProvider } from './DimContext.tsx';

interface CRTWrapperProps {
	children: React.ReactNode;
}

export function CRTWrapper({ children }: CRTWrapperProps) {
	const effectsEnabled = useStore(store, s => s.effectsEnabled);
	const dimming = useFlicker(16000, 50000, 3000, 8000, effectsEnabled);
	const garbling = useFlicker(24000, 70000, 500, 1500, effectsEnabled);

	return (
		<DimProvider value={dimming}>
			<GarbleProvider value={garbling}>
				<Box flexDirection="column">
					{children}
				</Box>
			</GarbleProvider>
		</DimProvider>
	);
}
