import express from 'express';
import cors from 'cors';
import { readdir, readFile, writeFile, unlink, rename, stat, mkdir } from 'fs/promises';
import { join, relative, extname, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', 'client', 'dist');
const PUBLIC = join(__dirname, '..', 'client', 'public');

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.pdf', '.zip', '.gz', '.tar', '.mp4', '.mp3', '.woff', '.woff2'
]);

export function createServer({ workspace, port, token }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Auth middleware for API routes
  app.use('/api', (req, res, next) => {
    const t = req.headers['x-token'] || req.query.token;
    if (t !== token) return res.status(401).json({ error: 'Unauthorized' });
    next();
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
