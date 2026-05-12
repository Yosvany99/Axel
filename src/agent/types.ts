export type LogLevel = 'info' | 'error' | 'warn' | 'thought' | 'tool_call' | 'tool_result' | 'agent_message' | 'user_message';

export interface AgentLog {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: any;
  model?: string;
  provider?: string;
}

export interface AgentState {
  isProcessing: boolean;
  currentModel?: string;
  currentProvider?: string;
}

export interface ProviderConfig {
  id: string;
  type: 'openrouter' | 'google';
  apiKey: string;
  models: string[];
  fallback?: { type: 'openrouter' | 'google'; modelId: string }[];
}

export interface AgentConfig {
  primaryProvider?: string;
  primaryModel?: string;
  maxSteps: number;
  maxContextMessages: number;
}

export type Message = {
  role: 'user' | 'assistant';
  content: string;
};
