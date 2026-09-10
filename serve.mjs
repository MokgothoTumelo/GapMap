// GapMap dev server — a minimal static file server.
//
// Serves the repo root statically: the demo screens at the root, frontend/,
// and core/demo-data/. There are no API routes — the Learning Companion's
// Node service was retired with the move to Firebase AI Logic (see
// docs/adr/0004-firebase-ai-logic.md). The agent panel's browser client and
// optional live Firebase AI Logic setup run without server routes; live errors
// are surfaced in the panel. Static hosting is the whole job, so this file is
// the whole server: no router, no response seam, no SSE.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(fileURLToPath(new URL('.', import.meta.url)));
// Strip a trailing separator so the prefix check is exact: fileURLToPath of a
// directory URL yields a trailing slash, and normalize/join preserve it —
// without this, `root + sep` double-slashes and every request fails the
// traversal guard.
const safeRoot = root.endsWith(sep) ? root.slice(0, -1) : root;
const port = Number(process.env.PORT || 8000);

const allowedOrigin = process.env.CORS_ORIGIN || '*';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

function respond(res, status, headers, body) {
  res.writeHead(status, {
    'access-control-allow-origin': allowedOrigin,
    vary: 'Origin',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    ...headers,
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent((req.url || '/').split('?')[0]);
    const relative = requested === '/' ? '/index.html' : requested;
    const path = normalize(join(safeRoot, relative));

    if (!path.startsWith(safeRoot + sep)) {
      respond(
        res,
        403,
        { 'content-type': 'application/json' },
        JSON.stringify({ error: 'forbidden' }),
      );
      return;
    }

    const contents = await readFile(path);
    respond(
      res,
      200,
      {
        'content-type': CONTENT_TYPES[extname(path)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      },
      contents,
    );
  } catch (error) {
    if (error.code === 'ENOENT') {
      respond(
        res,
        404,
        { 'content-type': 'application/json' },
        JSON.stringify({ error: 'not found' }),
      );
      return;
    }
    if (!res.headersSent) {
      respond(
        res,
        500,
        { 'content-type': 'application/json' },
        JSON.stringify({ error: error.message }),
      );
    }
  }
});

server.listen(port, '0.0.0.0', () =>
  console.log(`GapMap running at http://localhost:${port}`),
);