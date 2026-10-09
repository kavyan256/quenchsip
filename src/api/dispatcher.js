// Lambda behind the dispatch state machine (Step Functions). One function, one action per state.
import { assign, saveToken, ackTimeout, doneTimeout } from '../lib/dispatch.js';

const actions = {
  assign: ({ eventId, jobId }) => assign(eventId, jobId),
  wait_ack: ({ eventId, jobId, token }) => saveToken(eventId, jobId, 'ack', token),
  wait_done: ({ eventId, jobId, token }) => saveToken(eventId, jobId, 'done', token),
  ack_timeout: ({ eventId, jobId }) => ackTimeout(eventId, jobId),
  done_timeout: ({ eventId, jobId }) => doneTimeout(eventId, jobId),
};

export async function handler(input) {
  const action = actions[input?.action];
  if (!action) throw new Error(`Unknown dispatch action: ${input?.action}`);
  const out = await action(input);
  console.log(JSON.stringify({ action: input.action, eventId: input.eventId, jobId: input.jobId, out }));
  return out;
}
