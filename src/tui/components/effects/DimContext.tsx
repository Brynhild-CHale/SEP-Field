import { createContext, useContext } from 'react';

const DimContext = createContext(false);

export const DimProvider = DimContext.Provider;
export const useDim = () => useContext(DimContext);

const GarbleContext = createContext(false);

export const GarbleProvider = GarbleContext.Provider;

const GLITCH_CHARS = '░▒▓█▌▐╪╫╬┼';

function garbleText(text: string): string {
	return text.replace(/[a-zA-Z0-9]/g, ch =>
		Math.random() < 0.05 ? GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)] : ch
	);
}

export function useGarble(): (text: string) => string {
	const garbling = useContext(GarbleContext);
	return garbling ? garbleText : (t: string) => t;
}
