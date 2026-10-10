// A zero-dependency HTTP server for the demo. Run: npm start

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { USERS } from './core/policy.js';
import { createEngine } from './engine.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

const engine = createEngine();

const routes = {
  'GET /api/view': ({ user }) => engine.view(user),
  'GET /api/traces': ({ user }) => engine.traces(user).slice(-20),
  'POST /api/propose': ({ user, body }) => engine.propose(user, String(body.intent ?? '')),
  'POST /api/apply': ({ user, body }) => engine.apply(user, body.id),
  'POST /api/rollback': ({ user, body }) => engine.rollback(user, body.scope === 'org' ? 'org' : 'personal'),
};

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = routes[`${req.method} ${url.pathname}`];
  try {
    if (route) {
      // Demo identity: a real app takes this from its session, never from the client.
      const user = USERS[url.searchParams.get('user') ?? 'ana'];
      if (!user) return send(res, 401, { error: 'Unknown user' });
      return send(res, 200, await route({ user, body: req.method === 'POST' ? await readBody(req) : {} }));
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!TYPES[extname(file)] || file.includes('..')) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, await readFile(join(PUBLIC, file)), TYPES[extname(file)]);
  } catch (err) {
    send(res, err.code === 'ENOENT' ? 404 : 500, { error: err.message });
  }
}).listen(PORT, () => console.log(`Shapeshifting CRM demo → http://localhost:${PORT}`));
