import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, stepCountIs, type CoreMessage } from 'ai';
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

  // Retry logic for rate limits
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        tools,
        toolChoice: 'auto',
        stopWhen: stepCountIs(maxSteps),
        onStepFinish(step: any) {
          stepCount++;
          const text: string = step.text ?? '';
          const finishReason: string = step.finishReason ?? 'stop';
          const toolCalls: any[] = step.toolCalls ?? [];
          const toolResults: any[] = step.toolResults ?? [];

          // Log tool calls with correct name
          for (const tc of toolCalls) {
            const name = tc.toolName ?? tc.name ?? 'unknown';
            log('tool_call', `▶ ${name}`, tc.args ?? tc.input, modelId, provider.type);
          }

          // Log tool results with correct name
          for (const tr of toolResults) {
            const name = tr.toolName ?? tr.name ?? 'unknown';
            const raw = tr.result ?? tr.output;
            const txt = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
            log('tool_result', `◀ ${name}`, txt.slice(0, 2000), modelId, provider.type);
          }

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

          log('info', `Step ${stepCount} — finish: ${finishReason} | tools: ${toolCalls.length}`);
        }
      });

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

    } catch (err: any) {
      lastError = err;
      const isRateLimit = err.message?.includes('high demand') || err.message?.includes('429') || err.message?.includes('rate');
      if (isRateLimit && attempt < 3) {
        const wait = attempt * 15000;
        log('warn', `Rate limit hit, waiting ${wait/1000}s before retry ${attempt}/3...`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}
