// Local stand-in for EventBridge Scheduler: runs the projector on a fixed interval.
import { runProjection } from '../lib/projector.js';

const EVERY_MS = Number(process.env.EVERY_MS || 120000);

const tick = () => runProjection(Date.now()).catch((err) => console.error('projection failed:', err.message));
tick();
setInterval(tick, EVERY_MS);
console.error(`Projector every ${EVERY_MS / 1000} s`);
