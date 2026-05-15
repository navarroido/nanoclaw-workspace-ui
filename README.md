# nanoclaw-workspace-ui

Visual file manager UI for NanoClaw agents — browse, edit, and manage your agent workspace from the browser.

## Usage

```bash
# Run directly (no install needed)
npx nanoclaw-workspace-ui

# With options
npx nanoclaw-workspace-ui --workspace /workspace/agent --port 3100

# Or install globally
npm install -g nanoclaw-workspace-ui
nanoclaw-workspace-ui
```

The server starts and prints a URL + auth token. Open it in your browser.

## Features

- 📁 Browse workspace directory tree
- 📝 View and edit text files (code, markdown, JSON, etc.)
- 🖼️ Preview images
- ✏️ Create new files and folders
- 🗑️ Delete files
- 💾 Save with Ctrl+S / Cmd+S
- 🔐 Token-based auth (no credentials needed after first URL)

## Deployment with tunnel

To access from outside the server:

```bash
# Install cloudflared once
npm install -g cloudflared

# Start UI + tunnel
npx nanoclaw-workspace-ui &
cloudflared tunnel --url http://localhost:3100
```

The agent can send you the tunnel URL via chat.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--workspace` | `/workspace/agent` | Path to expose |
| `--port` | `3100` | HTTP port |
| `--token` | (random) | Auth token |

## Environment variables

- `NANOCLAW_WORKSPACE` — workspace path
- `PORT` — server port
- `UI_TOKEN` — fixed token (useful for persistent URLs)
