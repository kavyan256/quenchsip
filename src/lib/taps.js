// Tap storage. One transaction: store the tap (only if its id is new) and update the station's counters.
// A retried tap fails the first condition, so nothing is counted twice.
//   PK EVT#<id>  SK TAP#<uuid>  type, stationId, tappedAt, receivedAt, deviceTs
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE } from './db.js';
import { HttpError } from './events.js';
import { validateTap } from '../core/tap.js';

const COUNTER = { swap: 'swapCount', last_jar: 'lastJarCount', cups_low: 'cupsLowCount', stocked: 'stockCount' };
const LAST_AT = { swap: 'lastSwapAt', last_jar: 'lastJarAt', cups_low: 'cupsLowAt', stocked: 'stockedAt' };

// Extra station fields per tap type. Swap times feed the projection; a stock count replaces any earlier count.
// Note: phones send their queued taps oldest first, so "last ... at" fields end on the newest tap.
function extraUpdate(tap) {
  if (tap.type === 'swap') return { set: ', swapTimes = list_append(if_not_exists(swapTimes, :empty), :t)', values: { ':t': [tap.tappedAt], ':empty': [] } };
  if (tap.type === 'stocked') return { set: ', stockedJars = :jars, stockedCups = :cups, stocked = :yes', values: { ':jars': tap.jars, ':cups': tap.cups, ':yes': true } };
  return { set: '', values: {} };
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
              UpdateExpression: `ADD ${COUNTER[tap.type]} :one SET ${LAST_AT[tap.type]} = :at, lastTapAt = :at${extra.set}`,
              ExpressionAttributeValues: { ':one': 1, ':at': tap.tappedAt, ...extra.values },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (err.name !== 'TransactionCanceledException') throw err;
    const [tapReason, stationReason] = (err.CancellationReasons || []).map((r) => r?.Code);
    if (tapReason === 'ConditionalCheckFailed') return { uuid: tap.uuid, duplicate: true };
    if (stationReason === 'ConditionalCheckFailed') throw new HttpError(404, 'Station not found.');
    throw err;
  }
  return { uuid: tap.uuid, duplicate: false, tappedAt: tap.tappedAt };
}
