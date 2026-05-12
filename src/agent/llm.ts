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

  log('info', `Starting with ${provider.type}/${modelId} | maxSteps: ${maxSteps}`);

  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    tools,
    toolChoice: 'auto',
    maxSteps,
    // Log tool calls as they start
    experimental_onToolCallStart({ toolName, input }: any) {
      log('tool_call', `▶ ${toolName}`, input, modelId, provider.type);
    },
    // Log tool results as they finish
    experimental_onToolCallFinish({ toolName, output, error }: any) {
      if (error) {
        log('tool_result', `◀ ${toolName} ERROR`, String(error), modelId, provider.type);
      } else {
        const txt = typeof output === 'string' ? output : JSON.stringify(output ?? '');
        log('tool_result', `◀ ${toolName}`, txt.slice(0, 2000), modelId, provider.type);
      }
    },
    onStepFinish(step: any) {
      stepCount++;
      const text: string = step.text ?? '';
      const finishReason: string = step.finishReason ?? 'stop';
      const toolCalls: any[] = step.toolCalls ?? [];

      if (text.trim()) {
        if (finishReason === 'stop') {
          log('agent_message', text.trim(), {
            inputTokens: step.usage?.promptTokens,
            outputTokens: step.usage?.completionTokens,
          }, modelId, provider.type);
        } else {
          log('thought', text.trim(), undefined, modelId, provider.type);
        }
      }

      log('info', `Step ${stepCount}/${maxSteps} — finish: ${finishReason} | tools: ${toolCalls.length}`);
    }
  });

  // Fallback: respuesta directa sin steps
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
