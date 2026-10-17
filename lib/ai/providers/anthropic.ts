import 'server-only';
import { AiProviderError, type AiProvider, type CompletionRequest, type CompletionResult } from '../types';
import type { AiConfig } from '../config';

/**
 * Anthropic Messages API adapter.
 *
 * Raw HTTP rather than the SDK: this is one JSON POST, and the sibling adapter
 * speaks a different vendor's API. Taking two SDK dependencies into a codebase
 * the deploying organization self-hosts and owns would add supply-chain surface for no
 * capability.
 *
 * Notably absent: `temperature`, `top_p`, `top_k`. Current Claude models reject
 * them with a 400 (see lib/ai/types.ts).
 */

const API_VERSION = '2023-06-01';

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

export function createAnthropicProvider(config: AiConfig): AiProvider {
  return {
    id: 'anthropic',
    model: config.model,

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': API_VERSION,
          },
          body: JSON.stringify({
            model: config.model,
            max_tokens: request.maxTokens,
            system: request.system,
            messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        });
      } catch (cause) {
        throw new AiProviderError(
          `Could not reach the Anthropic API: ${cause instanceof Error ? cause.message : 'network error'}`,
          undefined,
          true,
        );
      }

      const body = (await response.json().catch(() => null)) as AnthropicResponse | null;

      if (!response.ok) {
        throw new AiProviderError(
          body?.error?.message ?? `Anthropic API returned ${response.status}.`,
          response.status,
          // 429 and 5xx are worth another try; 4xx is a configuration problem.
          response.status === 429 || response.status >= 500,
        );
      }

      // A safety classifier declining returns HTTP 200 with an empty content
      // array — reading content[0] here without checking would throw on a
      // response the API considers entirely successful.
      if (body?.stop_reason === 'refusal') {
        return {
          text: '',
          providerId: 'anthropic',
          model: body.model ?? config.model,
          stopReason: 'refusal',
        };
      }

      const text = (body?.content ?? [])
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('')
        .trim();

      return {
        text,
        providerId: 'anthropic',
        model: body?.model ?? config.model,
        stopReason:
          body?.stop_reason === 'max_tokens' ? 'max_tokens'
          : body?.stop_reason === 'end_turn' ? 'complete'
          : 'other',
        usage: body?.usage
          ? {
              inputTokens: body.usage.input_tokens ?? 0,
              outputTokens: body.usage.output_tokens ?? 0,
            }
          : undefined,
      };
    },
  };
}
