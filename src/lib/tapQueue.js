// On AWS (TAP_QUEUE_URL set) the API checks a tap and puts it on an SQS queue, so a burst of taps at the
// peak never waits on database writes. Locally, taps are written straight away.
import { recordTap } from './taps.js';
import { validateTap } from '../core/tap.js';

let sqs;
// expiresAt: the station's TTL, so a tap never outlives its event (demo events go after a day).
export async function acceptTap(eventId, stationId, input, expiresAt) {
  if (!process.env.TAP_QUEUE_URL) return { status: undefined, body: await recordTap(eventId, stationId, input, expiresAt) };
  const tap = validateTap(input); // reject bad taps now, while the phone can still be told
  const { SQSClient, SendMessageCommand } = await import('@aws-sdk/client-sqs');
  sqs ??= new SQSClient({});
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.TAP_QUEUE_URL, MessageBody: JSON.stringify({ eventId, stationId, expiresAt, tap: { ...input, uuid: tap.uuid } }) }));
  return { status: 202, body: { uuid: tap.uuid, queued: true } };
}
