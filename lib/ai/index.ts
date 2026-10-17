import 'server-only';
import { resolveAiConfig, describeAiConfig, type AiConfig, type AiStatus } from './config';
import { createAnthropicProvider } from './providers/anthropic';
import { createOpenAiProvider } from './providers/openai';
import type { AiProvider } from './types';

export { AiProviderError } from './types';
export type { AiStatus } from './config';

/**
 * Provider resolution.
 *
 * Server-only — the API key must never reach the browser, so this module is
 * marked `server-only` and importing it from a Client Component is a build
 * error, the same guarantee `lib/supabase/server.ts` relies on.
 */

function providerFor(config: AiConfig): AiProvider {
  return config.providerId === 'anthropic'
    ? createAnthropicProvider(config)
    : createOpenAiProvider(config);
}

/** The configured provider, or null when the AI layer is switched off. */
export function getAiProvider(): AiProvider | null {
  const result = resolveAiConfig(process.env);
  return result.configured ? providerFor(result.config) : null;
}

/** What the UI may know: whether it is on, and which model. Never the key. */
export function getAiStatus(): AiStatus {
  return describeAiConfig(resolveAiConfig(process.env));
}
