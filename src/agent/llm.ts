import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, type CoreMessage } from 'ai';
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
  let stepCount = 0;
  let lastFinishReason = 'stop';

  log('info', `Starting with ${provider.type}/${modelId} | maxSteps: ${maxSteps}`);

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools,
    toolChoice: 'auto',
    maxSteps,
    onChunk({ chunk }: any) {
      if (chunk.type === 'text-delta' && chunk.textDelta) {
        log('thought', chunk.textDelta, undefined, modelId, provider.type);
      }
    },
    onStepFinish(step: any) {
      stepCount++;
      const toolCalls: any[] = step.toolCalls ?? [];
      const toolResults: any[] = step.toolResults ?? [];
      const finishReason: string = step.finishReason ?? '';
      lastFinishReason = finishReason;

      for (const tc of toolCalls) {
        log('tool_call', `▶ ${tc.toolName}`, tc.args, modelId, provider.type);
      }
      for (const tr of toolResults) {
        const raw = tr.result;
        const txt = typeof raw === 'string' ? raw : JSON.stringify(raw);
        log('tool_result', `◀ ${tr.toolName}`, txt.slice(0, 1000), modelId, provider.type);
      }
      log('info', `Step ${stepCount}/${maxSteps} — finish: ${finishReason} | tools: ${toolCalls.length}`);
    },
    onFinish({ text, usage }: any) {
      if (text?.trim()) {
        log('agent_message', text.trim(), {
          inputTokens: usage?.promptTokens,
          outputTokens: usage?.completionTokens,
        }, modelId, provider.type);
      }
    },
  });

  // Consume the stream fully
  await result.consumeStream();

  const responseMessages = await result.responseMessages;
  log('info', `Done. Steps: ${stepCount} | Finish: ${lastFinishReason}`);

  return {
    newMessages: (responseMessages ?? []) as CoreMessage[],
    finishReason: lastFinishReason,
  };
}
