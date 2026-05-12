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

const SYSTEM_PROMPT = `You are a powerful AI agent. You have tools to run shell commands, read/write files, search the web, and use persistent memory.

Rules:
- Think step by step before acting.
- Use tools proactively. Read files before modifying them.
- For shell commands, handle errors and retry with fixes.
- Keep memory updated with important context.
- Respond in the same language the user writes in.
- When done, give a clear summary of what you did.`;

export class AgentSystem {
  private logs: AgentLog[] = [];
  private history: CoreMessage[] = [];
  private providers: Map<string, ProviderConfig> = new Map();
  private config: AgentConfig = { ...DEFAULT_CONFIG };
  private isProcessing = false;
  private currentModel?: string;
  private currentProvider?: string;

  async init() {
    await this.loadConfig();
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
    return p;
  }

  removeProvider(id: string) { this.providers.delete(id); }

  getProviders(): Omit<ProviderConfig, 'apiKey'>[] {
    return [...this.providers.values()].map(({ apiKey: _, ...rest }) => rest);
  }

  getProviderWithKey(id: string): ProviderConfig | undefined {
    return this.providers.get(id);
  }

  // ── History ──────────────────────────────────────────────

  private async loadHistory() {
    try {
      const raw = await fs.readFile(HISTORY_FILE, 'utf-8');
      this.history = JSON.parse(raw);
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

      // Append new messages (assistant replies + tool turns) to history
      this.history.push(...newMessages);
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
