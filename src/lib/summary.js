// End-of-event summary: reads the whole event partition (including taps) and summarizes it.
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE } from './db.js';
import { getEvent } from './events.js';
import { summarize } from '../core/summary.js';

async function allTaps(eventId) {
  const taps = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :t)',
        ExpressionAttributeValues: { ':pk': `EVT#${eventId}`, ':t': 'TAP#' },
        ProjectionExpression: 'tapType, stationId, tappedAt',
        ExclusiveStartKey,
      })
    );
    taps.push(...res.Items);
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return taps;
}

export async function eventSummary(eventId) {
  const [data, taps] = await Promise.all([getEvent(eventId), allTaps(eventId)]);
  return summarize({ event: data.event, stations: data.stations, jobs: data.jobs, taps });
}
