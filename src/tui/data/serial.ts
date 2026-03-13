/**
 * Generate a fake serial number for the Management Console header.
 * Deterministic per daemon session (seeded from daemonStartTime).
 */
export function generateSerial(seed: number): string {
	const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
	const a = (seed >>> 0) & 0xFFFF;
	const b = (seed >>> 16) & 0xFFFF;
	const c = ((seed * 2654435761) >>> 0) & 0xFFFF;
	return `${hex(a)}-${hex(b)}-${hex(c)}-UNSUPP`;
}
