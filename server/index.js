import express from 'express';
import cors from 'cors';
import { readdir, readFile, writeFile, unlink, rename, stat, mkdir } from 'fs/promises';
import { join, extname, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import { randomBytes, timingSafeEqual } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'client', 'dist');
const PUBLIC = join(__dirname, '..', 'client', 'public');

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.pdf', '.zip', '.gz', '.tar', '.mp4', '.mp3', '.woff', '.woff2'
]);

// Brute-force rate limiter: max 10 failed auth attempts per IP per 15 min
const failedAttempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = failedAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 15 * 60 * 1000; }
  return entry.count < 10;
}
function recordFailure(ip) {
  const now = Date.now();
  const entry = failedAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  entry.count++;
  failedAttempts.set(ip, entry);
}

function safeEqual(a, b) {
  try {
    const ba = Buffer.from(a), bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch { return false; }
}

export function createServer({ workspace, port, token }) {
  const app = express();
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: '10mb' }));

  // Exchange URL token for a session cookie (one-time, then cookie-only)
  app.get('/auth', (req, res) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (!checkRateLimit(ip)) return res.status(429).send('Too many attempts');
    if (!safeEqual(req.query.token || '', token)) {
      recordFailure(ip);
      return res.status(401).send('Invalid token');
    }
    const sessionId = randomBytes(32).toString('hex');
    // Store session (in-memory, short-lived)
    app._sessions = app._sessions || new Map();
    app._sessions.set(sessionId, Date.now() + 8 * 60 * 60 * 1000); // 8h
    res.setHeader('Set-Cookie', `ncws=${sessionId}; HttpOnly; SameSite=Strict; Max-Age=28800; Path=/`);
    res.redirect('/');
  });

  // Auth middleware for API routes: accept session cookie or x-token header
  app.use('/api', (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many attempts' });

    // Check session cookie
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')));
    const sessions = app._sessions || new Map();
    const sessionId = cookies['ncws'];
    if (sessionId && sessions.has(sessionId) && sessions.get(sessionId) > Date.now()) {
      return next();
    }

    // Fallback: x-token header (for programmatic access)
    if (req.headers['x-token'] && safeEqual(req.headers['x-token'], token)) return next();

    recordFailure(ip);
    return res.status(401).json({ error: 'Unauthorized' });
  });

  // List directory
  app.get('/api/files', async (req, res) => {
    const rel = req.query.path || '';
    const abs = join(workspace, rel);
    if (!abs.startsWith(workspace)) return res.status(403).json({ error: 'Forbidden' });
    try {
      const entries = await readdir(abs, { withFileTypes: true });
      const items = await Promise.all(entries
        .filter(e => !e.name.startsWith('.git'))
        .map(async e => {
          const s = await stat(join(abs, e.name)).catch(() => null);
          return {
            name: e.name,
            type: e.isDirectory() ? 'dir' : 'file',
            size: s?.size || 0,
            modified: s?.mtime?.toISOString() || null,
            ext: extname(e.name).toLowerCase(),
          };
        }));
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      res.json({ path: rel, items });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Read file
  app.get('/api/file', async (req, res) => {
    const rel = req.query.path || '';
    const abs = join(workspace, rel);
    if (!abs.startsWith(workspace)) return res.status(403).json({ error: 'Forbidden' });
    try {
      const ext = extname(rel).toLowerCase();
      if (BINARY_EXTS.has(ext)) {
        res.setHeader('Content-Type', 'application/octet-stream');
        createReadStream(abs).pipe(res);
        return;
      }
      const content = await readFile(abs, 'utf8');
      res.json({ path: rel, content });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Write file
  app.post('/api/file', async (req, res) => {
    const { path: rel, content } = req.body;
    const abs = join(workspace, rel);
    if (!abs.startsWith(workspace)) return res.status(403).json({ error: 'Forbidden' });
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Delete file or directory
  app.delete('/api/file', async (req, res) => {
    const rel = req.query.path || '';
    const abs = join(workspace, rel);
    if (!abs.startsWith(workspace)) return res.status(403).json({ error: 'Forbidden' });
    try {
      await unlink(abs);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Rename/move
  app.post('/api/rename', async (req, res) => {
    const { from, to } = req.body;
    const absFrom = join(workspace, from);
    const absTo = join(workspace, to);
    if (!absFrom.startsWith(workspace) || !absTo.startsWith(workspace))
      return res.status(403).json({ error: 'Forbidden' });
    try {
      await rename(absFrom, absTo);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Create directory
  app.post('/api/mkdir', async (req, res) => {
    const { path: rel } = req.body;
    const abs = join(workspace, rel);
    if (!abs.startsWith(workspace)) return res.status(403).json({ error: 'Forbidden' });
    try {
      await mkdir(abs, { recursive: true });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Serve frontend
  const staticDir = existsSync(DIST) ? DIST : PUBLIC;
  app.use(express.static(staticDir));
  app.get('*', (req, res) => {
    res.sendFile(join(staticDir, 'index.html'));
  });

  app.listen(port, () => {
    const url = `http://localhost:${port}?token=${token}`;
    console.log('\n🚀 NanoClaw Workspace UI');
    console.log(`   Workspace: ${workspace}`);
    console.log(`   URL:       ${url}\n`);
  });

  return app;
}
