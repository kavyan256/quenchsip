// Lambda invoked by EventBridge Scheduler every 2 minutes.
import { runProjection } from '../lib/projector.js';

export const handler = async () => runProjection(Date.now());
