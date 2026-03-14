/**
 * Splash art — the Bistromath glitching out of existence
 * at Lord's Cricket Ground, cloaked by an SEP field.
 */

const DIM = '\x1B[2m';
const RESET = '\x1B[0m';
const CYAN = '\x1B[36m';

/** The ship — long freighter with geodesic dome (left) and engine nacelle (right). */
const SHIP_LINES = [
	'             ▄▓▓▓▓▓▓▓▄                ▄',
	'          ▄▓▒░ ░ ░ ░▒▓▄  ╥╥╥╥╥╥╥  ▄▓██▓▄',
	'         ▓▒░ ░ ░ ░ ░ ░▒▓▓▓▓▓▓▓▓▓████▀▀▓▓▄',
	'  ▄▄▄▄▓▓▒ ░ ░ ░ ░ ░ ░▒▀▀▀▀▀▀▀▀▀▓█▓▓▓▓▓▓▓▄▄▄',
	'  ▐▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▌',
	'  ▐▓░░░▓░░░▓░░░▓░░░▓░░░▒▓▓▓▓▒░░░░░░▓░░▓▓▓▓▓▌',
	'  ▐▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▌',
	'  ▐▓░░▓░░▓░░▓░░▓░░▓░░▓░░▓░░▓░░▓░░▓▓▓▓▓▓▓▓▓▓▌',
	'   ▀▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▀▀  ▄█▓▄',
	'                                           ▀▀▘',
];

const STATIC_BOTTOM = `
${CYAN}  ╔═══════════════════════════════════════════╗
  ║                                           ║
  ║   ███████╗███████╗██████╗                 ║
  ║   ██╔════╝██╔════╝██╔══██╗                ║
  ║   ███████╗█████╗  ██████╔╝                ║
  ║   ╚════██║██╔══╝  ██╔═══╝                 ║
  ║   ███████║███████╗██║  ██╗                ║
  ║   ╚══════╝╚══════╝╚═╝  ╚═╝field           ║
  ║                                           ║
  ╚═══════════════════════════════════════════╝${RESET}
${DIM}   ┄┄╌╌╌  ╌╌  ╌   ╌ ╌╌  ╌╌╌╌  ╌┄┄┄┄  ┄┄┄┄┄
  ▁▁▁▁▁▁▂▂▂▁▁▁▁▁▂▂▂▁▁▁▁▁▁▂▂▂▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁
  ▏ ┆  ┆  ▏▕  ▏ ▕   ▕ ▏ ▏▕  ▏  ┆  ┆ ┆  ▏  ▕${RESET}
`;

/** Static full splash for non-animated use. */
export const SPLASH_ART = `\n${DIM}${SHIP_LINES.join('\n')}${RESET}\n${STATIC_BOTTOM}`;

// -- Animation helpers -------------------------------------------------------

const SHIP_ROW_COUNT = SHIP_LINES.length;
const CLR_LINE = '\x1B[2K';
const HIDE_CURSOR = '\x1B[?25l';
const SHOW_CURSOR = '\x1B[?25h';
/** DECSC / DECRC — save and restore cursor position. */
const SAVE = '\x1B7';
const RESTORE = '\x1B8';
const sleep = (ms: number) => Bun.sleep(ms);

/** Render all ship lines. Cursor must be at ship row 0 col 0 on entry. */
function renderShip(style: string): string {
	return SHIP_LINES.map((l) => `${CLR_LINE}${style}${l}${RESET}`).join('\r\n');
}

/** Clear all ship lines. Cursor must be at ship row 0 on entry. */
function blankShip(): string {
	return Array.from({ length: SHIP_ROW_COUNT }, () => CLR_LINE).join('\r\n');
}

/**
 * Animated splash: ship flickers then dims and vanishes,
 * static logo + interference lines stay put below.
 */
export async function playSplash(stream: NodeJS.WriteStream = process.stdout): Promise<void> {
	const w = (s: string) => stream.write(s);

	w(HIDE_CURSOR);

	// Print a blank line, then save cursor (this is ship row 0).
	w('\n');
	w(SAVE);

	// Render initial ship + static section below.
	w(renderShip(DIM));
	w(STATIC_BOTTOM);

	// Save end-of-output position so we can return after animation.
	// Use xterm alternate save (SCOSC) since DECSC is used for ship top.
	// Instead: just remember we need to re-print \n at the end to land below.

	// -- Flicker sequence --
	const flickers = [
		{ on: 100, off: 70 },
		{ on: 80,  off: 90 },
		{ on: 120, off: 60 },
	];

	for (const { on, off } of flickers) {
		await sleep(on);
		w(RESTORE);         // jump to ship row 0
		w(blankShip());
		await sleep(off);
		w(RESTORE);         // jump to ship row 0
		w(renderShip(DIM));
	}

	await sleep(200);

	// -- Fade sequence (grey ramp → gone) --
	const greys = [248, 242, 238, 236];
	for (const g of greys) {
		w(RESTORE);
		w(renderShip(`\x1B[38;5;${g}m`));
		await sleep(160);
	}

	// -- Final: blank the ship region --
	w(RESTORE);
	w(blankShip());

	// Move cursor past the static section to the end.
	// Count visible content lines in STATIC_BOTTOM (lines between leading/trailing \n).
	const staticContentLines = STATIC_BOTTOM.split('\n').filter(l => l.length > 0).length;
	// From last ship line, move down: 1 (blank from leading \n) + content lines + 1 (trailing \n)
	w(`\x1B[${staticContentLines + 2}B`);
	w('\r');

	w(SHOW_CURSOR);
}
