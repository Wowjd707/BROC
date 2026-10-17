import { describe, it, expect } from 'vitest';
import { resolveAiConfig, describeAiConfig, AI_PROVIDER_IDS } from './config';

describe('resolveAiConfig — disabled by default', () => {
  it('is off when nothing is set, with no error', () => {
    // Absent configuration is a supported state, not a misconfiguration.
    const result = resolveAiConfig({});
    expect(result.configured).toBe(false);
    if (!result.configured) expect(result.reason).toBeNull();
  });

  it('accepts explicit off switches without complaint', () => {
    for (const value of ['none', 'off', '', '  ']) {
      const result = resolveAiConfig({ AI_PROVIDER: value });
      expect(result.configured, value).toBe(false);
      if (!result.configured) expect(result.reason, value).toBeNull();
    }
  });
});

describe('resolveAiConfig — Anthropic', () => {
  it('defaults the model and base URL', () => {
    const result = resolveAiConfig({ AI_PROVIDER: 'anthropic', AI_API_KEY: 'sk-test' });
    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config.model).toBe('claude-opus-5');
      expect(result.config.baseUrl).toBe('https://api.anthropic.com');
    }
  });

  it('lets the deploying organization choose a different model', () => {
    const result = resolveAiConfig({
      AI_PROVIDER: 'anthropic', AI_API_KEY: 'sk-test', AI_MODEL: 'claude-haiku-4-5',
    });
    if (!result.configured) throw new Error(result.reason ?? 'expected configured');
    expect(result.config.model).toBe('claude-haiku-4-5');
  });

  it('requires a key', () => {
    const result = resolveAiConfig({ AI_PROVIDER: 'anthropic' });
    expect(result.configured).toBe(false);
    if (!result.configured) expect(result.reason).toContain('AI_API_KEY');
  });
});

describe('resolveAiConfig — OpenAI and compatible endpoints', () => {
  it('requires an explicit model rather than guessing one', () => {
    // Guessing would either 404 or silently pin the deploying organization to a model they
    // did not choose. The codebase does not invent identifiers.
    const result = resolveAiConfig({ AI_PROVIDER: 'openai', AI_API_KEY: 'sk-test' });
    expect(result.configured).toBe(false);
    if (!result.configured) expect(result.reason).toContain('AI_MODEL');
  });

  it('configures OpenAI with an explicit model', () => {
    const result = resolveAiConfig({
      AI_PROVIDER: 'openai', AI_API_KEY: 'sk-test', AI_MODEL: 'some-model',
    });
    if (!result.configured) throw new Error(result.reason ?? 'expected configured');
    expect(result.config.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('allows a self-hosted endpoint with no key at all', () => {
    // Ollama and similar runtimes are unauthenticated — and an organization who
    // will not send ESG data to a third party needs this path to work.
    const result = resolveAiConfig({
      AI_PROVIDER: 'openai-compatible',
      AI_MODEL: 'llama3.1',
      AI_BASE_URL: 'http://localhost:11434/v1',
    });
    expect(result.configured).toBe(true);
    if (result.configured) expect(result.config.apiKey).toBe('');
  });

  it('requires a base URL for a compatible endpoint', () => {
    const result = resolveAiConfig({ AI_PROVIDER: 'openai-compatible', AI_MODEL: 'llama3.1' });
    expect(result.configured).toBe(false);
    if (!result.configured) expect(result.reason).toContain('AI_BASE_URL');
  });

  it('trims trailing slashes so URL joining cannot double up', () => {
    const result = resolveAiConfig({
      AI_PROVIDER: 'openai-compatible', AI_MODEL: 'm', AI_BASE_URL: 'http://host:1234/v1///',
    });
    if (!result.configured) throw new Error(result.reason ?? 'expected configured');
    expect(result.config.baseUrl).toBe('http://host:1234/v1');
  });
});

describe('resolveAiConfig — misconfiguration is reported', () => {
  it('names the valid providers for an unknown one', () => {
    const result = resolveAiConfig({ AI_PROVIDER: 'gemini', AI_API_KEY: 'k' });
    expect(result.configured).toBe(false);
    if (!result.configured) {
      expect(result.reason).toContain('gemini');
      for (const id of AI_PROVIDER_IDS) expect(result.reason).toContain(id);
    }
  });

  it('is case- and whitespace-insensitive about the provider name', () => {
    const result = resolveAiConfig({ AI_PROVIDER: '  Anthropic ', AI_API_KEY: 'k' });
    expect(result.configured).toBe(true);
  });
});

describe('describeAiConfig', () => {
  it('never exposes the key', () => {
    const status = describeAiConfig(
      resolveAiConfig({ AI_PROVIDER: 'anthropic', AI_API_KEY: 'sk-secret-value' }),
    );
    expect(JSON.stringify(status)).not.toContain('sk-secret-value');
    expect(status.enabled).toBe(true);
    expect(status.model).toBe('claude-opus-5');
  });

  it('reports a broken configuration but stays silent about an absent one', () => {
    expect(describeAiConfig(resolveAiConfig({})).problem).toBeNull();
    expect(describeAiConfig(resolveAiConfig({ AI_PROVIDER: 'anthropic' })).problem)
      .toContain('AI_API_KEY');
  });
});
