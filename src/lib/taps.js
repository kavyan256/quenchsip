// Tap storage. One transaction: store the tap (only if its id is new) and update the station's counters.
// A retried tap fails the first condition, so nothing is counted twice.
//   PK EVT#<id>  SK TAP#<uuid>  type, stationId, tappedAt, receivedAt, deviceTs
import { TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE } from './db.js';
import { HttpError } from './events.js';
import { validateTap } from '../core/tap.js';

const COUNTER = { swap: 'swapCount', last_jar: 'lastJarCount', cups_low: 'cupsLowCount', stocked: 'stockCount' };
const LAST_AT = { swap: 'lastSwapAt', last_jar: 'lastJarAt', cups_low: 'cupsLowAt', stocked: 'stockedAt' };

// Swap times feed the projection (it sorts them, so arrival order does not matter).
function extraUpdate(tap) {
  if (tap.type === 'swap') return { set: ' SET swapTimes = list_append(if_not_exists(swapTimes, :empty), :t)', values: { ':t': [tap.tappedAt], ':empty': [] } };
  return { set: '', values: {} };
}

// "Last ... at" fields (and the stock count) only ever move forward in time. On AWS taps come through an
// SQS queue that does not keep order, so an older tap can arrive after a newer one; it must not win.
async function moveForward(pk, stationId, tap) {
  const sets = { lastTapAt: {}, [LAST_AT[tap.type]]: tap.type === 'stocked' ? { stockedJars: tap.jars, stockedCups: tap.cups } : {} };
  for (const [field, extra] of Object.entries(sets)) {
    const extraSet = Object.keys(extra).map((k) => `, ${k} = :${k}`).join('');
    await db
      .send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: pk, SK: `STN#${stationId}` },
          ConditionExpression: `attribute_exists(SK) AND (attribute_not_exists(${field}) OR ${field} < :at)`,
          UpdateExpression: `SET ${field} = :at${extraSet}`,
          ExpressionAttributeValues: { ':at': tap.tappedAt, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`:${k}`, v])) },
        })
      )
      .catch((err) => {
        if (err.name !== 'ConditionalCheckFailedException') throw err; // a newer tap already set it
      });
  }
}

export async function recordTap(eventId, stationId, input) {
  const tap = validateTap(input);
  const receivedAt = new Date().toISOString();
  const pk = `EVT#${eventId}`;

  const extra = extraUpdate(tap);
  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE,
              Item: { PK: pk, SK: `TAP#${tap.uuid}`, type: 'tap', tapType: tap.type, stationId, tappedAt: tap.tappedAt, receivedAt, deviceTs: tap.deviceTs, clockTrusted: tap.clockTrusted, jars: tap.jars, cups: tap.cups },
              ConditionExpression: 'attribute_not_exists(SK)',
            },
          },
          {
            Update: {
              TableName: TABLE,
              Key: { PK: pk, SK: `STN#${stationId}` },
              ConditionExpression: 'attribute_exists(SK)',
              UpdateExpression: `ADD ${COUNTER[tap.type]} :one${tap.type === 'stocked' ? ' SET stocked = :yes' : extra.set}`,
              ExpressionAttributeValues: { ':one': 1, ...(tap.type === 'stocked' ? { ':yes': true } : extra.values) },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (err.name !== 'TransactionCanceledException') throw err;
    const [tapReason, stationReason] = (err.CancellationReasons || []).map((r) => r?.Code);
    if (tapReason === 'ConditionalCheckFailed') {
      // Already stored. Re-apply the times in case the first attempt stopped before doing so (idempotent).
      await moveForward(pk, stationId, tap);
      return { uuid: tap.uuid, duplicate: true };
    }
    if (stationReason === 'ConditionalCheckFailed') throw new HttpError(404, 'Station not found.');
    throw err;
  }
  await moveForward(pk, stationId, tap);
  if (tap.type === 'last_jar') {
    // Best effort: a failure here must not lose the tap; the scheduled projector will dispatch anyway.
    await import('./dispatch.js')
      .then(({ startDispatch }) => startDispatch(eventId, stationId, 'last_jar'))
      .catch((err) => console.error('dispatch after last jar failed:', err.message));
  }
  return { uuid: tap.uuid, duplicate: false, tappedAt: tap.tappedAt };
}
