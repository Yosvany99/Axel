import 'dotenv/config';
import express from 'express';
import path from 'path';

import { AgentSystem } from './agent/system.js';


const app = express();
const agent = new AgentSystem();

app.use(express.json());

// Serve static frontend in production
const publicDir = path.join(process.cwd(), 'dist', 'public');
app.use(express.static(publicDir));

// ── Status ────────────────────────────────────────────────
app.get('/api/status', (_, res) => {
  res.json({
    state: agent.getState(),
    providers: agent.getProviders(),
    config: agent.getConfig(),
  });
});

// ── SSE — logs en tiempo real ────────────────────────────
app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let lastId = parseInt(req.query.from as string || '0');

  const send = () => {
    const logs = agent.getLogs();
    const newLogs = logs.slice(lastId);
    if (newLogs.length > 0) {
      res.write(`data: ${JSON.stringify(newLogs)}\n\n`);
      lastId = logs.length;
    }
  };

  send();
  const interval = setInterval(send, 300);
  req.on('close', () => clearInterval(interval));
});

// ── Logs ─────────────────────────────────────────────────
app.get('/api/logs', (_, res) => res.json(agent.getLogs()));
app.delete('/api/logs', async (_, res) => { await agent.clearLogs(); res.json({ ok: true }); });

// ── Chat ─────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text is required' });
  res.json({ ok: true });
  // Run in background so the HTTP response is immediate
  agent.chat(text.trim());
});

app.delete('/api/history', async (_, res) => {
  await agent.clearHistory();
  res.json({ ok: true });
});

// ── Providers ─────────────────────────────────────────────

// Detect provider type and fetch available models
async function detectProvider(apiKey: string): Promise<{ type: 'google' | 'openrouter'; models: string[] }> {
  // Google keys start with "AIza"
  if (apiKey.startsWith('AIza')) {
    return {
      type: 'google',
      models: await (async () => {
        try {
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`);
          const d = await r.json();
          return (d.models || [])
            .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m: any) => m.name.replace('models/', ''))
            .sort();
        } catch { return ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']; }
      })()
    };
  }

  // OpenRouter keys start with "sk-or-"
  if (apiKey.startsWith('sk-or-')) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (res.ok) {
        const data: any = await res.json();
        const models = (data.data || [])
          .map((m: any) => m.id)
          .filter((id: string) => !id.includes(':free') || id.includes('free'))
          .slice(0, 50);
        return { type: 'openrouter', models };
      }
    } catch { /* fall through */ }
    return { type: 'openrouter', models: ['anthropic/claude-sonnet-4-5', 'google/gemini-2.5-flash', 'openai/gpt-4o'] };
  }

  throw new Error('Unrecognized API key format. Expected Google (AIza...) or OpenRouter (sk-or-...)');
}

app.post('/api/providers', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey?.trim()) return res.status(400).json({ error: 'apiKey required' });
  try {
    const { type, models } = await detectProvider(apiKey.trim());
    const p = agent.addProvider(type, apiKey.trim(), models);
    res.json({ id: p.id, type: p.type, models: p.models });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/providers/:id', (req, res) => {
  agent.removeProvider(req.params.id);
  res.json({ ok: true });
});

// ── Config ────────────────────────────────────────────────
app.patch('/api/config', async (req, res) => {
  await agent.updateConfig(req.body);
  res.json(agent.getConfig());
});

// Fallback to frontend
app.get('*', (_, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const PORT = process.env.PORT || 3001;

agent.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Agent server running on http://localhost:${PORT}`);
  });
});
