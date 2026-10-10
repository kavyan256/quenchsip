// Local dev server: turns plain HTTP requests into API Gateway v2 events for the Lambda handler.
// Listens on all interfaces so phones on the same Wi-Fi can reach it.
import { createServer } from 'node:http';
import { handler } from '../api/handler.js';

const PORT = Number(process.env.PORT || 3001);
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,x-organiser-pin,x-organiser-key,x-access-token',
};

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS).end();
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const url = new URL(req.url, 'http://localhost');
  const out = await handler({
    rawPath: url.pathname,
    requestContext: { http: { method: req.method } },
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks).toString() : undefined,
  });
  res.writeHead(out.statusCode, { ...CORS, ...out.headers }).end(out.body);
}).listen(PORT, '0.0.0.0', () => console.log(`Quench API on http://0.0.0.0:${PORT}`));
