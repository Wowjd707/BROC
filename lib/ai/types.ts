/**
 * Provider-agnostic model interface.
 *
 * The platform must never hard-depend on one vendor: an organization with a Claude
 * subscription and an organization with an OpenAI subscription both plug in their
 * own keys, and an organization with neither loses nothing, because every AI feature
 * is additive.
 *
 * The interface is deliberately the smallest thing that serves the use case —
 * system prompt, messages, token ceiling, text back. Two omissions are load
 * bearing:
 *
 *   • **No sampling parameters.** `temperature`, `top_p` and `top_k` are
 *     rejected with a 400 on current Claude models (Opus 5, Opus 4.7+,
 *     Sonnet 5) while every OpenAI-shaped API accepts them. An interface
 *     carrying `temperature` would therefore work against one provider and
 *     hard-fail against the other — the exact lock-in this layer exists to
 *     avoid. Output is steered by prompt instead, which is portable.
 *
 *   • **No streaming.** Drafting produces a paragraph the user edits before it
 *     is saved; token-by-token delivery buys nothing and the two providers
 *     disagree on wire format.
 *
 * No SDK dependency either. Both APIs are a single JSON POST, and adding two
 * vendor SDKs would add supply-chain surface to a codebase meant to be owned
 * and audited by the team that runs it.
 */

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * A document the model is asked to read: a scanned bill, a PDF invoice, a
 * photo of a meter. Base64, because both APIs take it inline and neither needs
 * a separate upload step. Only PDFs and the common image types are carried;
 * other formats are refused before a request is made (see
 * `lib/evidence-check-core.ts`), because a provider receiving a format it
 * cannot read tends to answer anyway, about nothing.
 */
export interface AiAttachment {
  kind: 'pdf' | 'image';
  mediaType: string;
  /** Base64, no data: prefix. */
  data: string;
  fileName: string;
}

export interface CompletionRequest {
  /** Fixed per task — never assembled from user input. See `tasks.ts`. */
  system: string;
  messages: AiMessage[];
  maxTokens: number;
  /**
   * Documents attached to the LAST user message. Optional: most tasks are text
   * only. A provider or endpoint that cannot read a document returns its own
   * error, which reaches the user verbatim rather than being swallowed.
   */
  attachments?: AiAttachment[];
}

export interface CompletionResult {
  text: string;
  /** Which provider and model actually answered, for the audit trail. */
  providerId: string;
  model: string;
  /**
   * Normalized stop reason. `refusal` is its own case rather than an error:
   * Claude returns HTTP 200 with an empty content array when a safety
   * classifier declines, so code that reads the first content block without
   * checking would throw on a perfectly successful response.
   */
  stopReason: 'complete' | 'max_tokens' | 'refusal' | 'other';
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AiProvider {
  readonly id: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/** Raised for anything the caller should show the user verbatim. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
