// On AWS (TAP_QUEUE_URL set) the API checks a tap and puts it on an SQS queue, so a burst of taps at the
// peak never waits on database writes. Locally, taps are written straight away.
import { recordTap } from './taps.js';
import { validateTap } from '../core/tap.js';

let sqs;
export async function acceptTap(eventId, stationId, input) {
  if (!process.env.TAP_QUEUE_URL) return { status: undefined, body: await recordTap(eventId, stationId, input) };
  const tap = validateTap(input); // reject bad taps now, while the phone can still be told
  const { SQSClient, SendMessageCommand } = await import('@aws-sdk/client-sqs');
  sqs ??= new SQSClient({});
  await sqs.send(new SendMessageCommand({ QueueUrl: process.env.TAP_QUEUE_URL, MessageBody: JSON.stringify({ eventId, stationId, tap: { ...input, uuid: tap.uuid } }) }));
  return { status: 202, body: { uuid: tap.uuid, queued: true } };
}
