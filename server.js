// Local server: the same API as Vercel plus the static page in public/.
// Run: npm start  (reads .env if present)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

try { process.loadEnvFile('.env'); } catch { /* no .env: fine */ }
const { default: handler } = await import('./src/app.js');

const PUBLIC = join(import.meta.dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const port = Number(process.env.PORT || 3000);

createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) return handler(req, res);
  const rel = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
  try {
    const body = await readFile(file);
    res.setHeader('content-type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}).listen(port, () => console.log(`Mappls problem intake running at http://localhost:${port}`));
