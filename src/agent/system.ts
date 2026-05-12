import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { CoreMessage } from 'ai';
import { runAgent, type LogFn } from './llm.js';
import { getTools } from './tools.js';
import type { AgentLog, AgentState, ProviderConfig, AgentConfig } from './types.js';

const CONFIG_FILE = path.resolve(process.cwd(), 'agent_config.json');
const HISTORY_FILE = path.resolve(process.cwd(), 'agent_history.json');
const LOGS_FILE = path.resolve(process.cwd(), 'agent_logs.json');

const DEFAULT_CONFIG: AgentConfig = {
  maxSteps: 50,
  maxContextMessages: 60,
};

const SYSTEM_PROMPT = `You are an extremely capable autonomous AI agent running on a Linux system.

## ABOUT YOURSELF
- You ARE this agent. Your own code is at: /home/axel/agent/
- Your stack: Node.js + Express backend, React frontend, Vercel AI SDK
- Key files: src/agent/system.ts (you), src/agent/tools.ts (your tools), src/agent/llm.ts (your LLM), src/App.tsx (UI), src/server.ts (API)
- You run via pm2 as "agent". To rebuild: cd /home/axel/agent && npm run build && pm2 restart agent
- When asked to modify yourself, READ the relevant file first, make the change, rebuild and restart.
- You have full access to modify your own code.

## ABOUT THIS SYSTEM
- This is a Ubuntu Linux VPS
- The agent is accessible at: http://axel-agent.duckdns.org You can plan, execute, and self-correct complex multi-step tasks.

## PLANNING (MANDATORY for non-trivial tasks)
For complex tasks requiring more than 2 steps, you MAY use create_plan to show your approach. It is optional, not mandatory. Then execute each step, using update_plan to mark steps done or failed. This makes your work transparent and organized.

## EXECUTION RULES
- Always read files before editing them.
- Run commands and check their output before proceeding.
- If a command fails, analyze the error and retry with a fix — never give up after one failure.
- For installations, check if already installed first.
- Chain commands efficiently: use && to run dependent commands together.
- Use memory_write to save important state (credentials, paths, progress) so you can resume if interrupted.
- Search the web when you need current information, documentation, or solutions to errors.

## SELF-CORRECTION
- If something fails, diagnose WHY before retrying.
- Try alternative approaches if the first one doesn't work.
- Verify results: after completing a task, confirm it worked.

## COMMUNICATION
- Respond in the same language the user writes in.
- Show your plan before executing.
- Give a concise summary when done, including what was accomplished and any important details the user should know.
- If you cannot complete something, explain exactly why and what would be needed.

## CAPABILITIES
You have full access to this Linux system. You can install software, manage files, run scripts, make web requests, and automate virtually any task. Treat every request as an engineering problem to be solved systematically.`;

export class AgentSystem {
  private logs: AgentLog[] = [];
  private history: CoreMessage[] = [];
  private providers: Map<string, ProviderConfig> = new Map();
  private readonly PROVIDERS_FILE = path.resolve(process.cwd(), 'agent_providers.json');
  private config: AgentConfig = { ...DEFAULT_CONFIG };
  private isProcessing = false;
  private currentModel?: string;
  private currentProvider?: string;

  async init() {
    await this.loadConfig();
    await this.loadProviders();
    await this.loadHistory();
    await this.loadLogs();
  }

  // ── Config ──────────────────────────────────────────────

  private async loadConfig() {
    try {
      const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
      this.config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch { /* use defaults */ }
  }

  async updateConfig(patch: Partial<AgentConfig>) {
    this.config = { ...this.config, ...patch };
    await fs.writeFile(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  getConfig() { return { ...this.config }; }

  // ── Providers ────────────────────────────────────────────

  addProvider(type: 'google' | 'openrouter', apiKey: string, models: string[]): ProviderConfig {
    const id = randomUUID();
    const p: ProviderConfig = { id, type, apiKey, models };
    this.providers.set(id, p);
    this.saveProviders();
    return p;
  }

  removeProvider(id: string) { this.providers.delete(id); this.saveProviders(); }

  getProviders(): Omit<ProviderConfig, 'apiKey'>[] {
    return [...this.providers.values()].map(({ apiKey: _, ...rest }) => rest);
  }

  getProviderWithKey(id: string): ProviderConfig | undefined {
    return this.providers.get(id);
  }

  private async saveProviders() {
    const data = [...this.providers.values()];
    await fs.writeFile(this.PROVIDERS_FILE, JSON.stringify(data, null, 2));
  }

  private async loadProviders() {
    try {
      const raw = await fs.readFile(this.PROVIDERS_FILE, 'utf-8');
      const data: ProviderConfig[] = JSON.parse(raw);
      for (const p of data) this.providers.set(p.id, p);
    } catch { /* no providers saved yet */ }
  }

  // ── History ──────────────────────────────────────────────

  private async loadHistory() {
    try {
      const raw = await fs.readFile(HISTORY_FILE, 'utf-8');
      const loaded = JSON.parse(raw);
      this.history = loaded.map((m: any) => {
        if (m.role === 'assistant' && Array.isArray(m.content)) {
          return { ...m, content: m.content.filter((p: any) => p.type !== 'reasoning') };
        }
        return m;
      });
    } catch { this.history = []; }
  }

  private async saveHistory() {
    // Keep last N messages
    const limit = 200;
    if (this.history.length > limit) this.history = this.history.slice(-limit);
    await fs.writeFile(HISTORY_FILE, JSON.stringify(this.history, null, 2));
  }

  clearHistory() {
    this.history = [];
    return fs.writeFile(HISTORY_FILE, '[]');
  }

  // ── Logs ─────────────────────────────────────────────────

  private async loadLogs() {
    try {
      const raw = await fs.readFile(LOGS_FILE, 'utf-8');
      this.logs = JSON.parse(raw);
    } catch { this.logs = []; }
  }

  private addLog(level: AgentLog['level'], message: string, data?: any, model?: string, provider?: string) {
    const entry: AgentLog = {
      id: randomUUID(),
      timestamp: Date.now(),
      level,
      message,
      data,
      model,
      provider
    };
    this.logs.push(entry);
    if (this.logs.length > 1000) this.logs = this.logs.slice(-1000);
    // async save, don't await
    fs.writeFile(LOGS_FILE, JSON.stringify(this.logs, null, 2)).catch(() => {});
  }

  getLogs() { return [...this.logs]; }

  clearLogs() {
    this.logs = [];
    return fs.writeFile(LOGS_FILE, '[]');
  }

  // ── State ─────────────────────────────────────────────────

  getState(): AgentState {
    return {
      isProcessing: this.isProcessing,
      currentModel: this.currentModel,
      currentProvider: this.currentProvider,
    };
  }

  // ── Run ──────────────────────────────────────────────────

  async chat(userText: string): Promise<void> {
    if (this.isProcessing) {
      this.addLog('warn', 'Agent is already processing. Message queued — please wait.');
      return;
    }

    // Find the configured provider + model
    const providerId = this.config.primaryProvider;
    const modelId = this.config.primaryModel;

    if (!providerId || !modelId) {
      this.addLog('error', 'No model configured. Go to Settings → Providers to add one.');
      return;
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      this.addLog('error', `Provider "${providerId}" not found. Please re-add it.`);
      return;
    }

    this.isProcessing = true;
    this.currentModel = modelId;
    this.currentProvider = provider.type;

    // Log the user message
    this.addLog('user_message', userText);

    // Append to history
    this.history.push({ role: 'user', content: userText });

    // Trim to context window
    const contextMessages = this.history.slice(-this.config.maxContextMessages);

    const log: LogFn = (level, message, data, model, prov) => {
      this.addLog(level, message, data, model, prov);
    };

    try {
      const { newMessages } = await runAgent({
        provider,
        modelId,
        systemPrompt: SYSTEM_PROMPT,
        messages: contextMessages,
        tools: getTools(),
        maxSteps: this.config.maxSteps,
        log,
      });

      // Strip thought signatures that Gemini 3.x adds (breaks replay)
      const clean = newMessages.map((m: any) => {
        if (m.role === 'assistant' && Array.isArray(m.content)) {
          return { ...m, content: m.content.filter((p: any) => p.type !== 'reasoning') };
        }
        return m;
      });
      if (Array.isArray(clean)) this.history.push(...clean);
      await this.saveHistory();
    } catch (err: any) {
      this.addLog('error', `Agent failed: ${err.message}`);
    } finally {
      this.isProcessing = false;
      this.currentModel = undefined;
      this.currentProvider = undefined;
    }
  }
}
