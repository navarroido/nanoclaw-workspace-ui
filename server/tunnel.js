import { spawn, execFileSync } from 'child_process';
import { writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, '..', '.tunnel-state.json');

function findCloudflared() {
  const candidates = [
    'cloudflared',
    '/home/node/.npm/_npx/8a26fc3a61fe4212/node_modules/cloudflared/bin/cloudflared',
    '/usr/local/bin/cloudflared',
    '/usr/bin/cloudflared',
  ];
  for (const c of candidates) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch {}
  }
  // Try npx as last resort
  return null;
}

export function startTunnel(port, token) {
  console.log('🌐 Starting Cloudflare tunnel...');

  const cloudflaredBin = findCloudflared();
  if (!cloudflaredBin) {
    console.error('cloudflared not found — tunnel disabled. Install with: npm install -g cloudflared');
    return null;
  }

  const proc = spawn(cloudflaredBin, ['tunnel', '--url', `http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let url = null;

  const onData = (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !url) {
      url = match[0];
      const fullUrl = `${url}?token=${token}`;
      writeFileSync(STATE_FILE, JSON.stringify({ url, fullUrl, port, token, pid: proc.pid }));
      console.log(`\n✅ Tunnel ready: ${fullUrl}\n`);
      // Emit event so the agent can send this URL to the user
      process.emit('tunnel:ready', { url, fullUrl, token });
    }
  };

  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('exit', () => {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
    console.log('Tunnel closed.');
  });

  process.on('exit', () => proc.kill());
  process.on('SIGINT', () => { proc.kill(); process.exit(0); });

  return proc;
}

export function getTunnelState() {
  try {
    return JSON.parse(require('fs').readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}
