#!/usr/bin/env node
import { createServer } from '../server/index.js';
import { startTunnel } from '../server/tunnel.js';
import { resolve } from 'path';

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : def;
};

const workspace = resolve(getArg('--workspace', process.env.NANOCLAW_WORKSPACE || '/workspace/agent'));
const port = parseInt(getArg('--port', process.env.PORT || '3100'));
const token = getArg('--token', process.env.UI_TOKEN || Math.random().toString(36).slice(2));
const tunnel = !args.includes('--no-tunnel');

createServer({ workspace, port, token });

if (tunnel) {
  startTunnel(port, token);
}
