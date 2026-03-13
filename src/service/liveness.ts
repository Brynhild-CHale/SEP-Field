/**
 * Socket liveness probe.
 *
 * Attempts net.connect() to the Unix socket with a 1s timeout.
 * Returns true if something is listening, false on ECONNREFUSED/ENOENT/timeout.
 */

import { connect } from 'net';
import { SOCKET_PATH } from './paths.ts';

export function checkSocketAlive(socketPath: string = SOCKET_PATH): Promise<boolean> {
	return new Promise((resolve) => {
		const sock = connect({ path: socketPath });
		const timer = setTimeout(() => {
			sock.destroy();
			resolve(false);
		}, 1000);

		sock.on('connect', () => {
			clearTimeout(timer);
			sock.destroy();
			resolve(true);
		});

		sock.on('error', () => {
			clearTimeout(timer);
			sock.destroy();
			resolve(false);
		});
	});
}
