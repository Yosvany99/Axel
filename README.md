# Agent

A clean AI agent with a React chat UI, Express backend, and tool support.

## Stack

- **Frontend**: React 18 + Vite (no extra UI lib)
- **Backend**: Express + TypeScript
- **AI**: Vercel AI SDK v4 — stable, correct `onStepFinish` tool logging
- **Providers**: Google Gemini, OpenRouter

## Tools

| Tool | Description |
|------|-------------|
| `run_command` | Execute shell commands (30s timeout) |
| `read_file` | Read file contents |
| `write_file` | Write files (creates dirs as needed) |
| `list_directory` | List directory contents |
| `search_web` | Google search via Serper API |
| `fetch_url` | Fetch URL contents |
| `memory_write` | Save key/value to persistent memory |
| `memory_read` | Read from persistent memory |
| `memory_list` | List all memory keys |

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your API keys

npm run dev
# Open http://localhost:3001
```

## Add API Keys in UI

Go to **Settings → API Keys**, paste your Google or OpenRouter key, and click **Add**. Then click a model to activate it.

## Build for production

```bash
npm run build
npm start
```
