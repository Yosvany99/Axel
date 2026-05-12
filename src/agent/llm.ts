import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, type CoreMessage, type StepResult } from 'ai';
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
    maxSteps,
    toolChoice: 'auto',
    onStepFinish(step: StepResult<any>) {
      stepCount++;

      // Log thoughts (text emitted mid-loop, not the final answer)
      if (step.text?.trim() && step.finishReason !== 'stop') {
        log('thought', step.text.trim(), undefined, modelId, provider.type);
      }

      // Log final answer
      if (step.text?.trim() && step.finishReason === 'stop') {
        log('agent_message', step.text.trim(), {
          inputTokens: step.usage?.promptTokens,
          outputTokens: step.usage?.completionTokens,
        }, modelId, provider.type);
      }

      // Log each tool call
      if (step.toolCalls && step.toolCalls.length > 0) {
        for (const tc of step.toolCalls) {
          log(
            'tool_call',
            `▶ ${tc.toolName}`,
            tc.args,
            modelId,
            provider.type
          );
        }
      }

      // Log each tool result
      if (step.toolResults && step.toolResults.length > 0) {
        for (const tr of step.toolResults) {
          const raw = tr.result;
          const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
          const preview = text.length > 1000 ? text.slice(0, 1000) + '…' : text;
          log(
            'tool_result',
            `◀ ${tr.toolName}`,
            preview,
            modelId,
            provider.type
          );
        }
      }

      log('info', `Step ${stepCount}/${maxSteps} — finish: ${step.finishReason} | tools: ${step.toolCalls?.length ?? 0}`);
    }
  });

  log('info', `Done. Steps: ${stepCount} | Finish: ${result.finishReason}`);

  // responseMessages contains the new assistant + tool messages to append
  return {
    newMessages: result.responseMessages as CoreMessage[],
    finishReason: result.finishReason
  };
}
