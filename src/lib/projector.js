// Scheduled run (EventBridge Scheduler, every 2 minutes): for every live event, work out when each
// station runs dry and whether it has gone quiet, and save that on the station.
// Alerts and runner dispatch build on what is saved here.
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE } from './db.js';
import { getEvent } from './events.js';
import { boardView } from '../core/board.js';

const DAY = 24 * 3600 * 1000;

// Events that started in the last 24 h and have not ended (events last at most 24 h).
export async function liveEventIds(now) {
  const res = await db.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
      ExpressionAttributeValues: { ':pk': 'EVENTS', ':from': new Date(now - DAY).toISOString(), ':to': `${new Date(now).toISOString()}~` },
    })
  );
  return res.Items.filter((x) => Date.parse(x.endsAt) > now).map((x) => x.id);
}

export async function projectEvent(eventId, now) {
  const data = await getEvent(eventId);
  const view = boardView(data, now);
  const computedAt = new Date(now).toISOString();
  const alerts = [];

  for (const t of view.tiles) {
    const wasAlerting = Boolean(t.station.projection?.alert);
    const p = { ...t.projection, status: t.status, computedAt };
    // alertSince marks when this station started needing a runner (used by dispatch).
    const alertSince = p.alert ? (wasAlerting && t.station.alertSince) || computedAt : null;
    await db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `EVT#${eventId}`, SK: `STN#${t.station.id}` },
        ConditionExpression: 'attribute_exists(SK)', // station may have been removed meanwhile
        UpdateExpression: 'SET #projection = :p, alertSince = :a', // "projection" is a DynamoDB reserved word
        ExpressionAttributeNames: { '#projection': 'projection' },
        ExpressionAttributeValues: { ':p': p, ':a': alertSince },
      })
    ).catch((err) => {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    });
    if (p.alert && !wasAlerting) alerts.push({ station: t.station.name, dryAt: p.dryAt, minutesToDry: p.minutesToDry });
  }

  return {
    eventId,
    event: data.event.name,
    stations: view.tiles.length,
    summary: view.summary,
    newAlerts: alerts,
    quiet: view.tiles.filter((t) => t.flags.quiet).map((t) => t.station.name),
  };
}

export async function runProjection(now = Date.now()) {
  const ids = await liveEventIds(now);
  const results = [];
  for (const id of ids) {
    try {
      results.push(await projectEvent(id, now));
    } catch (err) {
      results.push({ eventId: id, error: err.message });
    }
  }
  // One JSON line per run: shows up in CloudWatch Logs (and in the local scheduler output).
  console.log(JSON.stringify({ run: new Date(now).toISOString(), liveEvents: ids.length, results }));
  return { liveEvents: ids.length, results };
}
