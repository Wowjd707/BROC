/**
 * AI configuration, resolved from the environment.
 *
 * Absent configuration is the default and a supported state — `resolveAiConfig`
 * returns null and every AI affordance disappears. Nothing in the platform
 * degrades: the disclosure editor still works, it just has no Draft button.
 *
 * Pure (takes an env record rather than reading `process.env`) so the
 * precedence rules are unit-testable.
 */

export const AI_PROVIDER_IDS = ['anthropic', 'openai', 'openai-compatible'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface AiConfig {
  providerId: AiProviderId;
  apiKey: string;
  model: string;
  /** API root, without a trailing slash. */
  baseUrl: string;
}

export type AiConfigResult =
  | { configured: true; config: AiConfig }
  | { configured: false; reason: string | null };

const DEFAULT_BASE_URLS: Record<AiProviderId, string | null> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  // A self-hosted or third-party endpoint has no sensible default.
  'openai-compatible': null,
};

/**
 * Default model per provider.
 *
 * Anthropic gets a default because the current model id is knowable and stable.
 * The others do not: guessing a model id would either 404 or silently pin a
 * deploying organization to something they did not choose, and this codebase does not invent
 * values it cannot cite. `AI_MODEL` is therefore required for those, and the
 * error says so.
 */
const DEFAULT_MODELS: Record<AiProviderId, string | null> = {
  anthropic: 'claude-opus-5',
  openai: null,
  'openai-compatible': null,
};

function isProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Resolve configuration, or explain why there is none.
 *
 * `reason` is null when AI simply was not switched on — that is not an error
 * and must not be surfaced as one. It is a string when the operator clearly
 * intended to enable it and got something wrong, which they need told.
 */
export function resolveAiConfig(env: Record<string, string | undefined>): AiConfigResult {
  const providerRaw = (env.AI_PROVIDER ?? '').trim().toLowerCase();

  if (!providerRaw || providerRaw === 'none' || providerRaw === 'off') {
    return { configured: false, reason: null };
  }

  if (!isProviderId(providerRaw)) {
    return {
      configured: false,
      reason: `AI_PROVIDER must be one of: ${AI_PROVIDER_IDS.join(', ')} (or unset to disable). Got "${providerRaw}".`,
    };
  }

  const apiKey = (env.AI_API_KEY ?? '').trim();
  // A self-hosted runtime (Ollama, vLLM, LM Studio) commonly needs no key.
  if (!apiKey && providerRaw !== 'openai-compatible') {
    return { configured: false, reason: 'AI_PROVIDER is set but AI_API_KEY is empty.' };
  }

  const model = (env.AI_MODEL ?? '').trim() || DEFAULT_MODELS[providerRaw];
  if (!model) {
    return {
      configured: false,
      reason: `AI_MODEL is required for provider "${providerRaw}" — the platform does not guess model identifiers.`,
    };
  }

  const baseUrl = ((env.AI_BASE_URL ?? '').trim() || DEFAULT_BASE_URLS[providerRaw] || '')
    .replace(/\/+$/, '');
  if (!baseUrl) {
    return {
      configured: false,
      reason: 'AI_BASE_URL is required for provider "openai-compatible".',
    };
  }

  return { configured: true, config: { providerId: providerRaw, apiKey, model, baseUrl } };
}

/** What the UI may say about the configuration. Never includes the key. */
export interface AiStatus {
  enabled: boolean;
  providerId: string | null;
  model: string | null;
  /** Set only when configuration was attempted and is broken. */
  problem: string | null;
}

export function describeAiConfig(result: AiConfigResult): AiStatus {
  if (result.configured) {
    return {
      enabled: true,
      providerId: result.config.providerId,
      model: result.config.model,
      problem: null,
    };
  }
  return { enabled: false, providerId: null, model: null, problem: result.reason };
}
