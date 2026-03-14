/** Test harness for splash animation. Run: bun run src/test-splash.ts */
import { playSplash } from './service/splash.ts';

// Clear screen so prior terminal content doesn't interfere with cursor math
process.stdout.write('\x1B[2J\x1B[H');
await playSplash();
