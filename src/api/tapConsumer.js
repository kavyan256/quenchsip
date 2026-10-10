// Lambda fed by the SQS tap queue. Writes each tap (idempotent, see taps.js).
// Taps that can never succeed (bad input, station removed) are logged and dropped;
// anything else is reported as failed so SQS retries it, and after 3 tries it goes to the dead-letter queue.
import { recordTap } from '../lib/taps.js';
import { TapError } from '../core/tap.js';
import { HttpError } from '../lib/events.js';

export async function handler(event) {
  const batchItemFailures = [];
  for (const record of event.Records || []) {
    try {
      const { eventId, stationId, tap, expiresAt } = JSON.parse(record.body);
      const out = await recordTap(eventId, stationId, tap, expiresAt);
      console.log(JSON.stringify({ tap: tap.uuid, type: tap.type, duplicate: out.duplicate }));
    } catch (err) {
      if (err instanceof TapError || (err instanceof HttpError && err.status < 500) || err instanceof SyntaxError) {
        console.warn(JSON.stringify({ dropped: record.messageId, reason: err.message }));
      } else {
        console.error(JSON.stringify({ retry: record.messageId, reason: err.message }));
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
  }
  return { batchItemFailures };
}
