/**
 * Minimal dependency-free static server for the research platform MVP.
 *
 * Serves research/site as the web root and research/data as /data,
 * plus a single POST /api/event endpoint that appends analytics events
 * to research/data/analytics.log (one JSON object per line).
 *
 * Usage: node research/server.js [port]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.argv[2] || process.env.PORT || 4000;
const SITE_DIR = path.join(__dirname, 'site');
const DATA_DIR = path.join(__dirname, 'data');
const ANALYTICS_LOG = path.join(DATA_DIR, 'analytics.log');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function resolveStaticPath(baseDir, requestPath) {
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  return path.join(baseDir, safePath);
}

function handleEvent(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 10_000) req.destroy();
  });
  req.on('end', () => {
    try {
      const event = JSON.parse(body);
      const record = {
        ts: new Date().toISOString(),
        event: String(event.event || 'unknown').slice(0, 100),
        data: event.data || {},
      };
      fs.appendFile(ANALYTICS_LOG, JSON.stringify(record) + '\n', () => {});
      res.writeHead(204);
      res.end();
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid event payload' }));
    }
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const pathname = decodeURIComponent(parsed.pathname);

  if (req.method === 'POST' && pathname === '/api/event') {
    return handleEvent(req, res);
  }

  if (req.method !== 'GET') {
    res.writeHead(405);
    return res.end('Method not allowed');
  }

  if (pathname.startsWith('/data/')) {
    const filePath = resolveStaticPath(DATA_DIR, pathname.replace(/^\/data\//, ''));
    return sendFile(res, filePath);
  }

  let requestPath = pathname === '/' ? '/index.html' : pathname;
  if (!path.extname(requestPath)) requestPath += '.html';
  const filePath = resolveStaticPath(SITE_DIR, requestPath);
  sendFile(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Company Implementation Intelligence — http://localhost:${PORT}`);
});
