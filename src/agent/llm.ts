import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, type CoreMessage } from 'ai';
import type { AgentLog, ProviderConfig } from './types.js';

export type LogFn = (
  level: AgentLog['level'],
  message: string,
  data?: any,
  model?: string,
  provider?: string
) => void;

function createModel(provider: ProviderConfig, modelId: string) {
  if (provider.type === 'google') {
    return createGoogleGenerativeAI({ apiKey: provider.apiKey })(modelId);
  }
  if (provider.type === 'openrouter') {
    return createOpenRouter({ apiKey: provider.apiKey })(modelId);
  }
  throw new Error(`Unknown provider type: ${provider.type}`);
}

export async function runAgent(opts: {
  provider: ProviderConfig;
  modelId: string;
  systemPrompt: string;
  messages: CoreMessage[];
  tools: any;
  maxSteps: number;
  log: LogFn;
}): Promise<{ newMessages: CoreMessage[]; finishReason: string }> {
  const { provider, modelId, systemPrompt, messages, tools, maxSteps, log } = opts;

  const model = createModel(provider, modelId);
  const allMessages: CoreMessage[] = [...messages];
  const newMessages: CoreMessage[] = [];
  let stepCount = 0;
  let lastFinishReason = 'stop';

  log('info', `Starting with ${provider.type}/${modelId} | maxSteps: ${maxSteps}`);

  while (stepCount < maxSteps) {
    stepCount++;

    // Call model for one step
    const result = await generateText({
      model,
      system: systemPrompt,
      messages: allMessages,
      tools,
      toolChoice: 'auto',
      maxSteps: 1,
    });

    lastFinishReason = result.finishReason;
    const text = result.text ?? '';
    const toolCalls = result.toolCalls ?? [];
    const toolResults = result.toolResults ?? [];

    // Log streaming-like: text first
    if (text.trim()) {
      if (lastFinishReason === 'stop') {
        log('agent_message', text.trim(), {
          inputTokens: result.usage?.promptTokens,
          outputTokens: result.usage?.completionTokens,
        }, modelId, provider.type);
      } else {
        log('thought', text.trim(), undefined, modelId, provider.type);
      }
    }

    // Log tool calls
    for (const tc of toolCalls as any[]) {
      log('tool_call', `▶ ${tc.toolName}`, tc.args, modelId, provider.type);
    }

    // Log tool results
    for (const tr of toolResults as any[]) {
      const raw = tr.result;
      const txt = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
      log('tool_result', `◀ ${tr.toolName}`, txt.slice(0, 1000), modelId, provider.type);
    }

    log('info', `Step ${stepCount}/${maxSteps} — finish: ${lastFinishReason} | tools: ${toolCalls.length}`);

    // Add response to history
    const responseMessages = (result.responseMessages ?? []) as CoreMessage[];
    allMessages.push(...responseMessages);
    newMessages.push(...responseMessages);

    // Stop conditions
    if (lastFinishReason === 'stop' || lastFinishReason === 'length') break;
    if (toolCalls.length === 0) break;
  }

  log('info', `Done. Steps: ${stepCount} | Finish: ${lastFinishReason}`);
  return { newMessages, finishReason: lastFinishReason };
}
