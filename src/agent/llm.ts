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
  let stepCount = 0;
  let lastFinishReason = 'stop';

  log('info', `Starting with ${provider.type}/${modelId} | maxSteps: ${maxSteps}`);

  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    tools,
    toolChoice: 'auto',
    maxSteps,
    onStepFinish(step: any) {
      stepCount++;
      const toolCalls: any[] = step.toolCalls ?? [];
      const toolResults: any[] = step.toolResults ?? [];
      const text: string = step.text ?? '';
      lastFinishReason = step.finishReason ?? 'stop';

      if (text.trim()) {
        if (lastFinishReason === 'stop') {
          log('agent_message', text.trim(), {
            inputTokens: step.usage?.promptTokens,
            outputTokens: step.usage?.completionTokens,
          }, modelId, provider.type);
        } else {
          log('thought', text.trim(), undefined, modelId, provider.type);
        }
      }

      for (const tc of toolCalls) {
        log('tool_call', `▶ ${tc.toolName}`, tc.args, modelId, provider.type);
      }

      for (const tr of toolResults) {
        const raw = tr.result;
        const txt = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '(empty)');
        log('tool_result', `◀ ${tr.toolName}`, txt.slice(0, 2000), modelId, provider.type);
      }

      log('info', `Step ${stepCount}/${maxSteps} — finish: ${lastFinishReason} | tools: ${toolCalls.length} | results: ${toolResults.length}`);
    }
  });

  // Fallback: si no hubo steps pero hay texto
  if (stepCount === 0 && result.text?.trim()) {
    log('agent_message', result.text.trim(), {
      inputTokens: result.usage?.promptTokens,
      outputTokens: result.usage?.completionTokens,
    }, modelId, provider.type);
  }

  log('info', `Done. Steps: ${stepCount} | Finish: ${result.finishReason}`);

  return {
    newMessages: (result.responseMessages ?? []) as CoreMessage[],
    finishReason: result.finishReason,
  };
}
