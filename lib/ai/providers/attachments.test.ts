import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { anthropicMessages } from './anthropic';
import { openAiMessages } from './openai';
import type { CompletionRequest } from '../types';

const req: CompletionRequest = {
  system: 'S',
  maxTokens: 10,
  messages: [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'read this' }],
  attachments: [
    { kind: 'pdf', mediaType: 'application/pdf', data: 'UERG', fileName: 'bill.pdf' },
    { kind: 'image', mediaType: 'image/png', data: 'SU1H', fileName: 'meter.png' },
  ],
};

describe('attachments', () => {
  it('Anthropic: documents and images go on the last user message, before the text', () => {
    const m = anthropicMessages(req);
    expect(m[0].content).toBe('first');
    const last = m[2].content as { type: string }[];
    expect(last.map((b) => b.type)).toEqual(['document', 'image', 'text']);
  });

  it('OpenAI: system first, then text and parts on the last user message', () => {
    const m = openAiMessages(req);
    expect(m[0]).toEqual({ role: 'system', content: 'S' });
    const last = m[3].content as { type: string; image_url?: { url: string }; file?: { file_data: string } }[];
    expect(last.map((p) => p.type)).toEqual(['text', 'file', 'image_url']);
    expect(last[1].file?.file_data).toBe('data:application/pdf;base64,UERG');
    expect(last[2].image_url?.url).toBe('data:image/png;base64,SU1H');
  });

  it('leaves text-only requests exactly as before', () => {
    const plain = { ...req, attachments: undefined };
    expect(anthropicMessages(plain)[2].content).toBe('read this');
    expect(openAiMessages(plain)[3].content).toBe('read this');
  });
});
