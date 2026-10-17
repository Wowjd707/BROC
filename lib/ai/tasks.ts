/**
 * The fixed catalogue of things the AI layer may be asked to do.
 *
 * There is no free-text prompt endpoint, by design. A caller names a task and
 * supplies typed input; the system prompt is a constant in this file and cannot
 * be overridden from a request. That makes the boundary structural rather than
 * advisory — this is a compliance tool, and an endpoint that forwards arbitrary
 * prompts to a model on the deployment's key is a different product with a
 * different risk profile.
 *
 * Every task follows the same shape: the platform computes the facts and passes
 * them in, and the model is asked to write prose about facts it was given. It
 * is never asked to recall a figure, an emission factor, or what a standard
 * requires — those come from the database, and a model's recollection of them
 * would be exactly the fabricated regulatory content the project forbids.
 *
 * Pure and dependency-free so it is unit-testable.
 */

export const AI_TASK_IDS = ['draft_disclosure_narrative', 'summarise_regulatory_change'] as const;
export type AiTaskId = (typeof AI_TASK_IDS)[number];

export function isAiTaskId(value: string): value is AiTaskId {
  return (AI_TASK_IDS as readonly string[]).includes(value);
}

/**
 * Shared framing for every task. Concrete and negative where it matters: the
 * instruction not to invent figures is the one the grounding check in
 * `grounding.ts` independently verifies, because a prompt alone is not a
 * guarantee.
 */
const BASE_SYSTEM = `You are assisting a sustainability reporting team in drafting narrative disclosure text.

Absolute rules:
- Use ONLY the figures and facts supplied in the DATA section. Never introduce a number, percentage, emission factor, date, or target that is not present there.
- If the data needed for a claim is missing, write that the information is not yet available rather than estimating, illustrating, or leaving a placeholder.
- Never state what a regulation or standard requires. The reporting framework's requirements are supplied to you; describe what the undertaking did, not what the rule says.
- Do not describe performance as good, poor, strong, or industry-leading. Report what happened.

Style: plain professional prose in the third person, suitable for an annual sustainability statement. No headings, no bullet lists, no preamble, no closing summary. Return only the disclosure text itself.`;

export interface DisclosureNarrativeInput {
  organizationName: string;
  reportingYear: number;
  frameworkName: string;
  requirementCode: string;
  requirementTitle: string;
  requirementDescription: string | null;
  /** Figures the platform computed. The only numbers the model may use. */
  facts: { label: string; value: string }[];
  /** Existing draft, when the user is asking for a revision rather than a start. */
  existingNarrative: string | null;
}

export interface BuiltPrompt {
  system: string;
  user: string;
  /**
   * The DATA section verbatim. The grounding check runs the draft against this
   * exact text, so what is checked is precisely what the model was given.
   */
  context: string;
}

export function buildDisclosureNarrativePrompt(input: DisclosureNarrativeInput): BuiltPrompt {
  const facts = input.facts.length > 0
    ? input.facts.map((f) => `- ${f.label}: ${f.value}`).join('\n')
    : '- No platform data is available for this requirement.';

  // Only the facts block is treated as ground truth. Requirement titles and
  // org names are context for phrasing, and any digits they contain (an "E1-6",
  // a year in a framework name) are structural rather than reported figures.
  const context = facts;

  const user = `ORGANIZATION: ${input.organizationName}
REPORTING YEAR: ${input.reportingYear}
FRAMEWORK: ${input.frameworkName}
REQUIREMENT ${input.requirementCode}: ${input.requirementTitle}${
    input.requirementDescription ? `\nREQUIREMENT DETAIL: ${input.requirementDescription}` : ''
  }

DATA (the only figures you may use):
${facts}
${
  input.existingNarrative
    ? `\nEXISTING DRAFT (revise this; keep any statement it makes that the data supports):\n${input.existingNarrative}`
    : ''
}

Write the disclosure narrative for this requirement.`;

  return { system: BASE_SYSTEM, user, context };
}

// ─── Task: summarise a regulatory source change ──────────────────────────────

/**
 * The regulatory watch task.
 *
 * This is the task most at risk of violating the rule at the top of this file,
 * so the constraint is worth stating plainly: the model is shown a diff that
 * was computed deterministically from a page fetched seconds earlier, and asked
 * what changed **in that text**. It is never asked what the regulation now
 * requires, when a deadline now falls, or whether a rule is in force. Those
 * answers come from a human reading the source.
 *
 * The distinction is not pedantic. "Summarise this diff" is a reading
 * comprehension task on supplied text, which models do well. "What is the
 * current status of the EU Deforestation Regulation" is a recall task, which
 * models do confidently and wrongly — when this tracker's own seed content was
 * researched, model priors were wrong on six of twenty-one entries.
 *
 * Output is JSON so a suggested patch can be parsed, but nothing about the
 * pipeline depends on the model returning valid JSON: `parseRegulatoryChange`
 * falls back to treating the whole response as prose, and every suggested field
 * passes through `sanitisePatch` before it can be stored.
 */
const REGULATORY_CHANGE_SYSTEM = `You are helping a sustainability team notice when a regulatory source page has changed.

You are given: an ADDED/REMOVED diff computed from a page that was just fetched, and the tracker's current stored description of that regime.

Absolute rules:
- Describe ONLY what changed in the supplied diff. The diff is your entire evidence.
- NEVER state what a regulation requires, when a deadline falls, or what stage an instrument has reached, unless that statement appears in the supplied diff text. You are not being asked what you know about this regulation. You are being asked what this text says.
- Never introduce a date, threshold, figure or article number that is not present in the diff.
- Website navigation, cookie banners, "last updated" stamps, related-links blocks and layout changes are NOT regulatory changes. Say so plainly when that is all you see.
- If the diff is ambiguous, or you cannot tell whether it is substantive, say that. "This needs a human to read the source" is a correct and useful answer.
- Do not speculate about what the change implies or what the body might do next.

Reply with a single JSON object and nothing else:
{
  "summary": "2-4 sentences on what changed in the text, or that the change appears cosmetic.",
  "substantive": true or false,
  "suggested_changes": { }
}

"suggested_changes" may contain ONLY these keys, and only where the diff directly supports the new value: "status_summary", "key_points" (array of strings), "stage", "next_milestone", "next_milestone_date" (YYYY-MM-DD or null), "next_milestone_note". Omit the key entirely rather than guessing. An empty object is the correct answer whenever the diff does not clearly support an edit, and is expected most of the time.

You cannot set the entry's confidence rating or its verification date. A person does that after reading the source themselves.`;

export interface RegulatoryChangeInput {
  itemName: string;
  itemCode: string;
  sourceUrl: string;
  /** The tracker's stored description — context for judging novelty, not truth. */
  currentStatusSummary: string;
  currentStage: string;
  currentMilestone: string | null;
  currentMilestoneDate: string | null;
  /** Deterministic diff. The model's only evidence. */
  diffExcerpt: string;
}

export function buildRegulatoryChangePrompt(input: RegulatoryChangeInput): BuiltPrompt {
  // Only the diff is ground truth. The stored fields are context for judging
  // whether the change is news, and the grounding check runs against the diff
  // alone — a date the model echoed from our own stored summary is not
  // evidence that the source said it.
  const context = input.diffExcerpt;

  const user = `REGIME: ${input.itemName} (${input.itemCode})
SOURCE: ${input.sourceUrl}

CURRENTLY STORED (context only - not evidence):
- Stage: ${input.currentStage}
- Status: ${input.currentStatusSummary}
- Next milestone: ${input.currentMilestone ?? 'none recorded'}${
    input.currentMilestoneDate ? ` on ${input.currentMilestoneDate}` : ' (no date announced)'
  }

DIFF FROM THE SOURCE PAGE (your only evidence; "+" was added, "-" was removed):
${input.diffExcerpt}

What changed?`;

  return { system: REGULATORY_CHANGE_SYSTEM, user, context };
}

export interface ParsedRegulatoryChange {
  summary: string;
  substantive: boolean;
  /** Raw — must still pass through sanitisePatch before storage. */
  suggestedChanges: unknown;
  /** True when the response was not valid JSON and the text was used as-is. */
  fellBackToProse: boolean;
}

/**
 * Parse the model's reply, tolerating everything models actually do to JSON:
 * fenced code blocks, a leading sentence, trailing commentary.
 *
 * A parse failure is not an error condition. The summary is the valuable part
 * and prose is a perfectly good summary; only the optional patch is lost, and a
 * reviewer can make that edit themselves.
 */
export function parseRegulatoryChange(raw: string): ParsedRegulatoryChange {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
      const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : text;
      return {
        summary,
        // Absent means "not asserted", and the safe reading of an unstated
        // claim is that the change is not substantive.
        substantive: parsed.substantive === true,
        suggestedChanges: parsed.suggested_changes ?? {},
        fellBackToProse: false,
      };
    } catch {
      // fall through
    }
  }
  return { summary: text, substantive: false, suggestedChanges: {}, fellBackToProse: true };
}

/** Output ceiling per task. A disclosure narrative is paragraphs, not pages. */
export const AI_TASK_MAX_TOKENS: Record<AiTaskId, number> = {
  draft_disclosure_narrative: 1200,
  // A change summary plus a small patch. Anything longer is the model
  // editorialising, which the prompt forbids.
  summarise_regulatory_change: 700,
};
