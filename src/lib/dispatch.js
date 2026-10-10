// Runner dispatch.
//   PK EVT#<id>  SK JOB#<jobId>  stationId, runnerId, state, jars, cups, times, excluded runners
//   station.openJobId: the station's open job (at most one); runner.status free|busy, runner.currentJobId
//
// On AWS a Step Functions state machine drives each job: assign a runner (retry while none is free),
// wait for "On my way" (reassign to someone else on timeout), wait for "Delivered" (mark stale on timeout).
// The runner's taps reach the API, which updates the job and resumes the state machine with its task token.
// Locally (no STATE_MACHINE_ARN) jobs are assigned directly and timeouts are not simulated.
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE } from './db.js';
import { HttpError, getEvent, expiryAfter } from './events.js';
import { newId } from './pin.js';
import { boardView } from '../core/board.js';
import { jarsToSend, pickRunner, dispatchDecision, OPEN_STATES } from '../core/dispatch.js';

export const MAX_ASSIGN_ATTEMPTS = 10; // with a 60 s wait between tries: about 10 minutes (only when a free runner was taken meanwhile)
const pk = (id) => `EVT#${id}`;
const nowIso = () => new Date().toISOString();

let sfnClient;
async function sfn() {
  if (!sfnClient) {
    const { SFNClient } = await import('@aws-sdk/client-sfn');
    sfnClient = new SFNClient({});
  }
  return sfnClient;
}
async function resume(token, output) {
  if (!token || !process.env.STATE_MACHINE_ARN) return;
  const { SendTaskSuccessCommand } = await import('@aws-sdk/client-sfn');
  await (await sfn()).send(new SendTaskSuccessCommand({ taskToken: token, output: JSON.stringify(output) })).catch((err) => {
    // The state machine may have already moved on (timed out); the database is the record either way.
    if (!['TaskTimedOut', 'TaskDoesNotExist', 'InvalidToken'].includes(err.name)) throw err;
  });
}

async function getJob(eventId, jobId) {
  const res = await db.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(eventId), SK: `JOB#${jobId}` } }));
  if (!res.Item) throw new HttpError(404, 'Job not found.');
  return res.Item;
}

async function runnersOf(eventId) {
  const res = await db.send(
    new QueryCommand({ TableName: TABLE, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :r)', ExpressionAttributeValues: { ':pk': pk(eventId), ':r': 'RUN#' } })
  );
  return res.Items.map((r) => ({ ...r, id: r.SK.slice(4) }));
}

const cancelledBecause = (err, index) => err.name === 'TransactionCanceledException' && err.CancellationReasons?.[index]?.Code === 'ConditionalCheckFailed';

// Opens a job for a station unless it already has one (or the event has no runners). Returns { started, jobId }.
// On AWS the state machine starts only when a runner is free; otherwise the job waits and the scheduled
// check starts it later (startWaitingJobs), so waiting costs no Step Functions state transitions.
export async function startDispatch(eventId, stationId, reason, now = Date.now()) {
  const data = await getEvent(eventId);
  const decision = dispatchDecision(data.runners);
  if (decision === 'no_runners') return { started: false, reason: 'no_runners' };
  const tile = boardView(data, now).tiles.find((t) => t.station.id === stationId);
  if (!tile) throw new HttpError(404, 'Station not found.');
  if (tile.station.openJobId) return { started: false, jobId: tile.station.openJobId };

  const { clock } = boardView(data, now);
  const hour = data.plan.rows.find((r) => r.stationId === stationId)?.byHour?.[clock.hourIndex];
  const minutesLeft = clock.known ? (clock.end - now) / 60000 : undefined;
  const jobId = newId(8);
  const job = {
    PK: pk(eventId),
    SK: `JOB#${jobId}`,
    type: 'job',
    eventId,
    stationId,
    stationName: tile.station.name,
    zone: tile.station.zone,
    reason,
    state: 'waiting',
    jars: jarsToSend({ ...tile.projection, minutesLeft }),
    cups: tile.flags.cupsLow ? hour?.high?.cups ?? 0 : 0,
    dryAt: tile.projection.dryAt,
    excluded: [],
    attempts: 0,
    createdAt: new Date(now).toISOString(),
    expiresAt: expiryAfter(new Date(now).toISOString()),
  };
  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: TABLE, Item: job } },
          {
            Update: {
              TableName: TABLE,
              Key: { PK: pk(eventId), SK: `STN#${stationId}` },
              ConditionExpression: 'attribute_exists(SK) AND attribute_not_exists(openJobId)',
              UpdateExpression: 'SET openJobId = :j',
              ExpressionAttributeValues: { ':j': jobId },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (cancelledBecause(err, 1)) return { started: false };
    throw err;
  }

  if (!process.env.STATE_MACHINE_ARN) await assign(eventId, jobId);
  else if (decision === 'start') await startExecution(eventId, jobId);
  return { started: true, jobId, waiting: decision === 'wait' };
}

async function startExecution(eventId, jobId) {
  const { StartExecutionCommand } = await import('@aws-sdk/client-sfn');
  // The name is unique per job, so starting twice (a race with the scheduled check) is harmless.
  const out = await (await sfn()).send(
    new StartExecutionCommand({
      stateMachineArn: process.env.STATE_MACHINE_ARN,
      name: `${eventId}-${jobId}`,
      input: JSON.stringify({
        eventId,
        jobId,
        ackTimeoutSeconds: Number(process.env.ACK_TIMEOUT_SECONDS || 180),
        doneTimeoutSeconds: Number(process.env.DONE_TIMEOUT_SECONDS || 2700),
      }),
    })
  );
  await db.send(new UpdateCommand({ TableName: TABLE, Key: { PK: pk(eventId), SK: `JOB#${jobId}` }, UpdateExpression: 'SET executionArn = :a', ExpressionAttributeValues: { ':a': out.executionArn } }));
}

// Scheduled check (AWS): start the state machine for waiting jobs, oldest first, one per free runner.
export async function startWaitingJobs(eventId, data) {
  const waiting = (data.jobs || []).filter((j) => j.state === 'waiting' && !j.running).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const free = (data.runners || []).filter((r) => r.status === 'free').length;
  const started = [];
  for (const j of waiting.slice(0, free)) {
    await startExecution(eventId, j.id);
    started.push(j.id);
  }
  return started;
}

// State machine step: give the job to a free runner. { assigned, giveUp }
// If another job takes the chosen runner at the same moment, try the next free runner straight away.
export async function assign(eventId, jobId) {
  const tried = [];
  for (let i = 0; i < 5; i++) {
    const out = await assignOnce(eventId, jobId, tried);
    if (!out.raced) return out;
    tried.push(out.runnerId);
  }
  return { assigned: false, giveUp: false };
}

async function assignOnce(eventId, jobId, tried) {
  const job = await getJob(eventId, jobId);
  if (job.state !== 'waiting') return { assigned: OPEN_STATES.has(job.state) || job.state === 'done', giveUp: !OPEN_STATES.has(job.state) && job.state !== 'done' };

  const runner = pickRunner(await runnersOf(eventId), [...(job.excluded || []), ...tried]);
  if (!runner) {
    const attempts = (job.attempts || 0) + 1;
    if (attempts >= MAX_ASSIGN_ATTEMPTS) {
      await closeJob(eventId, job, 'unassigned', {});
      return { assigned: false, giveUp: true };
    }
    await db.send(new UpdateCommand({ TableName: TABLE, Key: { PK: pk(eventId), SK: `JOB#${jobId}` }, UpdateExpression: 'SET attempts = :a', ExpressionAttributeValues: { ':a': attempts } }));
    return { assigned: false, giveUp: false };
  }

  const at = nowIso();
  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TABLE,
              Key: { PK: pk(eventId), SK: runner.SK },
              ConditionExpression: '#s = :free',
              UpdateExpression: 'SET #s = :busy, currentJobId = :j',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':free': 'free', ':busy': 'busy', ':j': jobId },
            },
          },
          {
            Update: {
              TableName: TABLE,
              Key: { PK: pk(eventId), SK: `JOB#${jobId}` },
              ConditionExpression: '#st = :waiting',
              UpdateExpression: 'SET #st = :assigned, runnerId = :r, runnerName = :n, assignedAt = :at',
              ExpressionAttributeNames: { '#st': 'state' },
              ExpressionAttributeValues: { ':waiting': 'waiting', ':assigned': 'assigned', ':r': runner.id, ':n': runner.name, ':at': at },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (cancelledBecause(err, 0)) return { raced: true, runnerId: runner.id }; // runner taken meanwhile
    if (err.name === 'TransactionCanceledException') return { assigned: false, giveUp: false };
    throw err;
  }
  return { assigned: true, giveUp: false, runnerId: runner.id };
}

// State machine step: remember the task token so the runner's tap can resume the machine.
// If the runner already tapped (race), resume straight away.
export async function saveToken(eventId, jobId, stage, token) {
  const field = stage === 'ack' ? 'ackToken' : 'doneToken';
  await db.send(new UpdateCommand({ TableName: TABLE, Key: { PK: pk(eventId), SK: `JOB#${jobId}` }, UpdateExpression: `SET ${field} = :t`, ExpressionAttributeValues: { ':t': token } }));
  const job = await getJob(eventId, jobId);
  const already = stage === 'ack' ? ['acked', 'done'].includes(job.state) : job.state === 'done';
  if (already || !OPEN_STATES.has(job.state)) await resume(token, { state: job.state });
  return { saved: true };
}

function checkRunner(job, runnerId) {
  if (!runnerId || job.runnerId !== runnerId) throw new HttpError(403, 'This job is not yours.');
}

// Runner tapped "On my way".
export async function ack(eventId, jobId, runnerId) {
  const job = await getJob(eventId, jobId);
  checkRunner(job, runnerId);
  if (job.state === 'assigned') {
    await db.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: pk(eventId), SK: `JOB#${jobId}` },
        ConditionExpression: '#st = :assigned AND runnerId = :r',
        UpdateExpression: 'SET #st = :acked, ackedAt = :at',
        ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':assigned': 'assigned', ':acked': 'acked', ':r': runnerId, ':at': nowIso() },
      })
    ).catch((err) => {
      if (err.name !== 'ConditionalCheckFailedException') throw err;
    });
  } else if (job.state !== 'acked') {
    throw new HttpError(409, 'This job is no longer open.');
  }
  await resume(job.ackToken, { state: 'acked' });
  return { state: 'acked' };
}

// Ends a job: optional restock on the station, frees the station and the runner.
async function closeJob(eventId, job, state, { jars = 0, cups = 0, by } = {}) {
  const at = nowIso();
  const items = [
    {
      Update: {
        TableName: TABLE,
        Key: { PK: pk(eventId), SK: job.SK },
        ConditionExpression: '#st IN (:w, :a, :k)',
        UpdateExpression: 'SET #st = :state, closedAt = :at, deliveredJars = :j, deliveredCups = :c',
        ExpressionAttributeNames: { '#st': 'state' },
        ExpressionAttributeValues: { ':w': 'waiting', ':a': 'assigned', ':k': 'acked', ':state': state, ':at': at, ':j': jars, ':c': cups },
      },
    },
  ];
  const restock = state === 'done' && (jars > 0 || cups > 0);
  items.push({
    Update: {
      TableName: TABLE,
      Key: { PK: pk(eventId), SK: `STN#${job.stationId}` },
      ConditionExpression: 'attribute_exists(SK)',
      UpdateExpression: restock
        ? `REMOVE openJobId SET restocks = list_append(if_not_exists(restocks, :empty), :rs)${jars > 0 ? ', lastRestockAt = :at' : ''}${cups > 0 ? ', lastCupsRestockAt = :at' : ''}`
        : 'REMOVE openJobId',
      ...(restock ? { ExpressionAttributeValues: { ':empty': [], ':rs': [{ at, jars, cups, jobId: job.SK.slice(4), by: by || null }], ':at': at } } : {}),
    },
  });
  if (job.runnerId) {
    items.push({
      Update: {
        TableName: TABLE,
        Key: { PK: pk(eventId), SK: `RUN#${job.runnerId}` },
        ConditionExpression: 'attribute_exists(SK)',
        UpdateExpression: 'SET #s = :free, freeSince = :at REMOVE currentJobId',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':free': 'free', ':at': at },
      },
    });
  }
  await db.send(new TransactWriteCommand({ TransactItems: items }));
}

// Runner tapped "Delivered": restock the station (resets "Last jar" and the dry time).
export async function done(eventId, jobId, runnerId, input = {}) {
  const job = await getJob(eventId, jobId);
  checkRunner(job, runnerId);
  if (job.state === 'done') return { state: 'done' };
  if (!['assigned', 'acked'].includes(job.state)) throw new HttpError(409, 'This job is no longer open.');
  const count = (v, fallback, max) => {
    const n = v === undefined || v === '' ? fallback : Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new HttpError(400, `Delivered amounts must be whole numbers from 0 to ${max}.`);
    return n;
  };
  const jars = count(input.jars, job.jars, 50);
  const cups = count(input.cups, job.cups, 100000);
  try {
    await closeJob(eventId, job, 'done', { jars, cups, by: job.runnerName });
  } catch (err) {
    if (err.name === 'TransactionCanceledException') throw new HttpError(409, 'This job is no longer open.');
    throw err;
  }
  // Skipping "On my way" is fine: resume both waits.
  await resume(job.ackToken, { state: 'done' });
  await resume(job.doneToken, { state: 'done' });
  return { state: 'done', jars, cups };
}

// State machine step: runner did not tap "On my way" in time. Free them and try someone else.
export async function ackTimeout(eventId, jobId) {
  const job = await getJob(eventId, jobId);
  if (job.state !== 'assigned') return { state: job.state };
  const at = nowIso();
  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: TABLE,
              Key: { PK: pk(eventId), SK: `JOB#${jobId}` },
              ConditionExpression: '#st = :assigned AND runnerId = :r',
              UpdateExpression: 'SET #st = :waiting, excluded = list_append(if_not_exists(excluded, :empty), :me), reassignedAt = :at REMOVE runnerId, runnerName, ackToken',
              ExpressionAttributeNames: { '#st': 'state' },
              ExpressionAttributeValues: { ':assigned': 'assigned', ':waiting': 'waiting', ':r': job.runnerId, ':empty': [], ':me': [job.runnerId], ':at': at },
            },
          },
          {
            Update: {
              TableName: TABLE,
              Key: { PK: pk(eventId), SK: `RUN#${job.runnerId}` },
              UpdateExpression: 'SET #s = :free, freeSince = :at REMOVE currentJobId',
              ConditionExpression: 'currentJobId = :j',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':free': 'free', ':at': at, ':j': jobId },
            },
          },
        ],
      })
    );
  } catch (err) {
    if (err.name !== 'TransactionCanceledException') throw err;
    return { state: (await getJob(eventId, jobId)).state };
  }
  return { state: 'waiting', reassigned: true };
}

// State machine step: delivery never confirmed. Close the job so the station can be dispatched again.
export async function doneTimeout(eventId, jobId) {
  const job = await getJob(eventId, jobId);
  if (!OPEN_STATES.has(job.state)) return { state: job.state };
  await closeJob(eventId, job, 'stale', {}).catch((err) => {
    if (err.name !== 'TransactionCanceledException') throw err;
  });
  return { state: 'stale' };
}

// The runner's own screen: who they are and their current (or last) job.
export async function runnerView(eventId, runnerId) {
  const data = await getEvent(eventId);
  const runner = data.runners.find((r) => r.id === runnerId);
  if (!runner) throw new HttpError(404, 'Runner not found.');
  const mine = data.jobs.filter((j) => j.runnerId === runnerId).sort((a, b) => (b.assignedAt || '').localeCompare(a.assignedAt || ''));
  const current = mine.find((j) => j.id === runner.currentJobId) || null;
  return {
    event: { name: data.event.name },
    runner: { id: runner.id, name: runner.name, status: runner.status },
    job: current,
    lastJob: current ? null : mine[0] || null,
  };
}

// Used by the local scheduler (no Step Functions): retry jobs still waiting for a runner.
export async function retryWaiting(eventId, jobs) {
  for (const j of jobs.filter((x) => x.state === 'waiting')) await assign(eventId, j.id);
}
