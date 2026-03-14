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
const CLR = '\x1B[2K';
const HIDE_CUR = '\x1B[?25l';
const SHOW_CUR = '\x1B[?25h';
const UP = (n: number) => `\x1B[${n}A`;
const DOWN = (n: number) => `\x1B[${n}B`;
const sleep = (ms: number) => Bun.sleep(ms);

/**
 * Render ship lines (cursor must start at ship row 0).
 * Cursor ends on the last ship line.
 */
function shipFrame(style: string): string {
	return SHIP_LINES.map((l) => `\r${CLR}${style}${l}${RESET}`).join('\n');
}

/**
 * Blank ship lines (cursor must start at ship row 0).
 * Cursor ends on the last ship line.
 */
function shipBlank(): string {
	return Array.from({ length: SHIP_ROW_COUNT }, () => `\r${CLR}`).join('\n');
}

/**
 * Animated splash: ship flickers then dims and vanishes,
 * static logo + interference lines stay put below.
 *
 * Falls back to static print when stdout is not a TTY (e.g. piped install).
 */
export async function playSplash(stream: NodeJS.WriteStream = process.stdout): Promise<void> {
	const w = (s: string) => stream.write(s);

	// No animation if not a TTY — just print the static art.
	if (!stream.isTTY) {
		w(SPLASH_ART);
		return;
	}

	w(HIDE_CUR);

	// -- Initial render --
	// Layout:  \n → ship (10 lines) → STATIC_BOTTOM (14 \n characters)
	// After this, cursor is 14 rows below the last ship line.
	w('\n');
	w(shipFrame(DIM));
	w(STATIC_BOTTOM);

	// Count how many \n in STATIC_BOTTOM — this is how far below the last ship line we are.
	const belowShip = (STATIC_BOTTOM.match(/\n/g) || []).length;
	// To reach ship row 0 from end: up past STATIC_BOTTOM, then up through the ship.
	const endToShipTop = belowShip + SHIP_ROW_COUNT - 1;
	// After rendering/blanking ship, cursor is on last ship line.
	// To return to end position from there:
	const shipBottomToEnd = belowShip;

	//
	// Every animation frame follows the same pattern:
	//   1. UP(endToShipTop)      — cursor to ship row 0
	//   2. shipFrame / shipBlank — cursor to last ship row
	//   3. DOWN(shipBottomToEnd) — cursor back to end position
	//
	const frame = (content: string) => {
		w(UP(endToShipTop));
		w(content);
		w(DOWN(shipBottomToEnd));
	};

	// -- Flicker sequence --
	const flickers = [
		{ on: 100, off: 70 },
		{ on: 80,  off: 90 },
		{ on: 120, off: 60 },
	];
	for (const { on, off } of flickers) {
		await sleep(on);
		frame(shipBlank());
		await sleep(off);
		frame(shipFrame(DIM));
	}

	await sleep(200);

	// -- Fade (grey ramp → gone) --
	for (const g of [248, 242, 238, 236]) {
		frame(shipFrame(`\x1B[38;5;${g}m`));
		await sleep(160);
	}

	// -- Final blank --
	frame(shipBlank());

	w(SHOW_CUR);
}
