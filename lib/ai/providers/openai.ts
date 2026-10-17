import 'server-only';
import { AiProviderError, type AiProvider, type CompletionRequest, type CompletionResult } from '../types';
import type { AiConfig } from '../config';

/**
 * OpenAI Chat Completions adapter.
 *
 * Also serves every OpenAI-compatible endpoint — Ollama, vLLM, LM Studio,
 * Azure OpenAI, OpenRouter — which is what makes a fully self-hosted
 * deployment possible: an organization who will not send sustainability data to a
 * third party can point `AI_BASE_URL` at a model running on their own
 * hardware and use the identical code path.
 *
 * `temperature` is omitted here too. It would be accepted, but the whole point
 * of the shared interface is that a task behaves the same whichever provider is
 * configured; steering one provider through a parameter the other rejects would
 * reintroduce the divergence.
 */

interface OpenAiResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
}

export function createOpenAiProvider(config: AiConfig): AiProvider {
  /**
   * OpenAI's newer models require `max_completion_tokens`; the broader
   * compatible ecosystem standardised on `max_tokens` and much of it does not
   * recognise the newer name. Chosen per provider rather than guessed, and both
   * are documented — a mismatched endpoint surfaces the provider's own error
   * verbatim rather than a swallowed one.
   */
  const maxTokensField =
    config.providerId === 'openai' ? 'max_completion_tokens' : 'max_tokens';

  return {
    id: config.providerId,
    model: config.model,

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      // A local runtime usually needs no key; sending an empty bearer breaks some.
      if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: config.model,
            [maxTokensField]: request.maxTokens,
            messages: [
              { role: 'system', content: request.system },
              ...request.messages.map((m) => ({ role: m.role, content: m.content })),
            ],
          }),
        });
      } catch (cause) {
        throw new AiProviderError(
          `Could not reach the model endpoint at ${config.baseUrl}: ${cause instanceof Error ? cause.message : 'network error'}`,
          undefined,
          true,
        );
      }

      const body = (await response.json().catch(() => null)) as OpenAiResponse | null;

      if (!response.ok) {
        throw new AiProviderError(
          body?.error?.message ?? `Model endpoint returned ${response.status}.`,
          response.status,
          response.status === 429 || response.status >= 500,
        );
      }

      const choice = body?.choices?.[0];
      const finish = choice?.finish_reason;

      return {
        text: (choice?.message?.content ?? '').trim(),
        providerId: config.providerId,
        model: body?.model ?? config.model,
        stopReason:
          finish === 'length' ? 'max_tokens'
          : finish === 'content_filter' ? 'refusal'
          : finish === 'stop' ? 'complete'
          : 'other',
        usage: body?.usage
          ? {
              inputTokens: body.usage.prompt_tokens ?? 0,
              outputTokens: body.usage.completion_tokens ?? 0,
            }
          : undefined,
      };
    },
  };
}
