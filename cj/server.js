import http from 'http';
import worker, { refreshWhitelist } from './worker.js';

const port = Number(process.env.PORT) || 8080;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function writeResponseHeaders(res, headers) {
  headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    res.setHeader(key, value);
  });
  if (typeof headers.getSetCookie === 'function') {
    const cookies = headers.getSetCookie();
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? 'localhost';
    const body = await readBody(req);
    const request = new Request(`http://${host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body,
      duplex: body ? 'half' : undefined,
    });

    const response = await worker.fetch(request);
    res.statusCode = response.status;
    writeResponseHeaders(res, response.headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error('Request failed:', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Internal Server Error');
    }
  }
});

function start() {
  server.listen(port, '0.0.0.0', () => {
    console.log(`Listening on 0.0.0.0:${port}`);
  });

  refreshWhitelist()
    .then(() => console.log('Whitelist loaded'))
    .catch((err) => console.error('Initial whitelist load failed:', err));

  setInterval(() => {
    refreshWhitelist().catch((err) => {
      console.error('Scheduled whitelist refresh failed:', err);
    });
  }, REFRESH_INTERVAL_MS);
}

start();
