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

export const AI_TASK_IDS = [
  'draft_disclosure_narrative',
  'summarise_regulatory_change',
  'explain_review_finding',
  'read_evidence_document',
] as const;
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
  // An explanation, a short checklist and a note of a few sentences.
  explain_review_finding: 900,
  // A handful of extracted values with their quoted source text. A bill with
  // many meters still fits; anything longer is the model transcribing.
  read_evidence_document: 1500,
};

/** Pull the first JSON object out of a reply, tolerating fences and chatter. */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function str(value: unknown, max = 2000): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

// ─── Task: explain a data-review finding and draft the follow-up ─────────────

/**
 * The Data Review explainer.
 *
 * The finding itself is computed deterministically in `lib/anomaly-core.ts`
 * and is the whole of the model's evidence. The model is asked to do the two
 * things a reviewer spends their time on — say in plain words what the flag
 * means, and write the note that asks the site what happened — and is told
 * explicitly that it does not know the cause. It offers things to check, never
 * a diagnosis: whether a 300% jump is a new production line or a units error is
 * known only to the site.
 */
const REVIEW_FINDING_SYSTEM = `You help a sustainability data reviewer follow up on one data-quality flag raised by an automated check.

You are given the FINDING: what the check found, at which site, for which data stream, and the numbers behind it.

Absolute rules:
- Use ONLY the figures in the FINDING. Never introduce a number, percentage, date or unit that is not there.
- You do not know why this happened. Never state a cause. Offer possible explanations only as things to check, phrased as questions.
- Never say the data is wrong or right. The check found something unusual; a person at the site knows whether it is real.
- The follow-up note goes to whoever enters this site's data. Keep it short, polite and specific: what was noticed, and the one or two questions that would settle it. Ask for a supporting document (a bill, invoice or meter reading) when that would settle it. No greeting by name and no signature; the reviewer adds those.

Reply with a single JSON object and nothing else:
{
  "explanation": "2-3 plain sentences on what the flag means and why it matters for reported figures.",
  "things_to_check": ["3 to 5 short questions a reviewer could ask, most likely first"],
  "follow_up_subject": "a short email subject",
  "follow_up_body": "the note, 60-120 words"
}`;

export interface ReviewFindingInput {
  kindLabel: string;
  severity: string;
  siteName: string;
  businessUnitName: string | null;
  streamLabel: string | null;
  period: string | null;
  headline: string;
  detail: string;
  basis: { label: string; value: string }[];
}

export function buildReviewFindingPrompt(input: ReviewFindingInput): BuiltPrompt {
  const basis = input.basis.length > 0
    ? input.basis.map((b) => `- ${b.label}: ${b.value}`).join('\n')
    : '- (no figures)';
  // The headline, detail and basis are all computed by the platform, so all of
  // them are ground truth for the grounding check. The period goes in too: a
  // note that says "March 2026" is quoting the finding, not inventing a date.
  const context = [input.period ?? '', input.headline, input.detail, basis].join('\n');

  const user = `FINDING
Type: ${input.kindLabel} (severity ${input.severity})
Site: ${input.siteName}${input.businessUnitName ? ` (${input.businessUnitName})` : ''}
Data stream: ${input.streamLabel ?? 'not specific to one stream'}
Period: ${input.period ?? 'not specific to one month'}
Headline: ${input.headline}
Detail: ${input.detail}
Numbers behind it:
${basis}

Explain this flag and draft the follow-up note.`;

  return { system: REVIEW_FINDING_SYSTEM, user, context };
}

export interface ParsedFindingExplanation {
  explanation: string;
  thingsToCheck: string[];
  followUpSubject: string | null;
  followUpBody: string | null;
  fellBackToProse: boolean;
}

/** A parse failure keeps the prose: the explanation is the useful part. */
export function parseFindingExplanation(raw: string): ParsedFindingExplanation {
  const obj = extractJsonObject(raw);
  if (!obj) {
    return { explanation: raw.trim(), thingsToCheck: [], followUpSubject: null, followUpBody: null, fellBackToProse: true };
  }
  const things = Array.isArray(obj.things_to_check)
    ? obj.things_to_check.map((t) => str(t, 300)).filter((t): t is string => t !== null).slice(0, 6)
    : [];
  return {
    explanation: str(obj.explanation) ?? raw.trim(),
    thingsToCheck: things,
    followUpSubject: str(obj.follow_up_subject, 200),
    followUpBody: str(obj.follow_up_body, 3000),
    fellBackToProse: false,
  };
}

/** Everything the reviewer will read, for the grounding check. */
export function findingExplanationText(p: ParsedFindingExplanation): string {
  return [p.explanation, ...p.thingsToCheck, p.followUpSubject ?? '', p.followUpBody ?? ''].join('\n');
}

// ─── Task: read a supporting document ─────────────────────────────────────────

/**
 * Reading a bill, and only reading it.
 *
 * The model is deliberately NOT told the figure that was entered. Shown the
 * entered value, a model reading a smudged scan tends to find it; asked what
 * the document says, it has nothing to agree with. The comparison with the
 * entry is done afterwards, in code, by `compareEvidence` in
 * `lib/evidence-check-core.ts` — so whether something "matches" is decided by
 * arithmetic the reviewer can repeat, not by a model's judgement.
 *
 * Every value comes back with the text it was read from, so a reviewer can
 * find it on the page in seconds.
 */
const READ_DOCUMENT_SYSTEM = `You read one supporting document (a utility bill, fuel invoice, delivery note, meter reading or waste manifest) for a sustainability data team, and report what it says.

Absolute rules:
- Report only what is printed in the document. Never estimate, calculate a missing value, or fill a gap. If something is not shown, use null.
- Quantities only: energy, fuel, water or waste amounts. Never report money amounts, tax, rates or prices as quantities.
- For each value, copy the exact text you read it from into "source_text", so a person can find it on the page.
- Dates as YYYY-MM-DD. If the document shows only a month, use its first and last day.
- If the document is not readable, or is not this kind of document, set "readable" to false and say why in "notes".

Reply with a single JSON object and nothing else:
{
  "readable": true,
  "document_type": "utility bill | invoice | delivery note | meter reading | waste manifest | other",
  "issuer": "who issued it, or null",
  "account_or_meter": "account, meter or site number as printed, or null",
  "period_start": "YYYY-MM-DD or null",
  "period_end": "YYYY-MM-DD or null",
  "readings": [
    { "description": "what this line is", "quantity": 1234.5, "unit_as_written": "kWh", "unit_code": "one of the UNIT CODES, or null", "source_text": "exact text" }
  ],
  "total": { "description": "total for the commodity", "quantity": 1234.5, "unit_as_written": "kWh", "unit_code": "...", "source_text": "exact text" } or null,
  "notes": "anything a reviewer should know: several meters, estimated reads, a corrected bill. Or null."
}`;

export interface ReadDocumentInput {
  /** What the entry is, e.g. "Purchased electricity (Scope 2)". */
  commodityLabel: string;
  /** Unit codes the platform can convert for this kind of entry. */
  unitCodes: { code: string; label: string }[];
  fileName: string;
}

export function buildReadDocumentPrompt(input: ReadDocumentInput): BuiltPrompt {
  const codes = input.unitCodes.map((u) => `- ${u.code} (${u.label})`).join('\n');
  const user = `DOCUMENT: ${input.fileName} (attached)
LOOK FOR: ${input.commodityLabel}

UNIT CODES (set unit_code to one of these when the printed unit is the same unit; otherwise null):
${codes}

Read the document and report what it says about ${input.commodityLabel}.`;
  // No grounding context: extraction is checked against the document by the
  // quoted source text, and against the entry by compareEvidence.
  return { system: READ_DOCUMENT_SYSTEM, user, context: '' };
}

export interface DocumentReading {
  description: string | null;
  quantity: number;
  unitAsWritten: string | null;
  unitCode: string | null;
  sourceText: string | null;
}

export interface ParsedDocument {
  readable: boolean;
  documentType: string | null;
  issuer: string | null;
  accountOrMeter: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  readings: DocumentReading[];
  total: DocumentReading | null;
  notes: string | null;
  fellBackToProse: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function reading(value: unknown, allowedCodes: ReadonlySet<string>): DocumentReading | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const q = typeof r.quantity === 'number' ? r.quantity
    : typeof r.quantity === 'string' ? Number(r.quantity.replace(/,/g, '')) : NaN;
  if (!Number.isFinite(q)) return null;
  const code = str(r.unit_code, 40);
  return {
    description: str(r.description, 200),
    quantity: q,
    unitAsWritten: str(r.unit_as_written, 40),
    // A code the platform did not offer is treated as "unknown unit" rather
    // than trusted: the comparison only converts between units it knows.
    unitCode: code && allowedCodes.has(code) ? code : null,
    sourceText: str(r.source_text, 300),
  };
}

/**
 * Parse and sanitise. Anything malformed becomes "not read" rather than a
 * guess, and an unparseable reply is an unreadable document — a check that
 * cannot say what the bill says must not report a match.
 */
export function parseDocumentReading(raw: string, allowedCodes: readonly string[]): ParsedDocument {
  const allowed = new Set(allowedCodes);
  const obj = extractJsonObject(raw);
  if (!obj) {
    return {
      readable: false, documentType: null, issuer: null, accountOrMeter: null,
      periodStart: null, periodEnd: null, readings: [], total: null,
      notes: str(raw, 500), fellBackToProse: true,
    };
  }
  const date = (v: unknown) => {
    const s = str(v, 10);
    return s && ISO_DATE.test(s) ? s : null;
  };
  const readings = Array.isArray(obj.readings)
    ? obj.readings.map((r) => reading(r, allowed)).filter((r): r is DocumentReading => r !== null).slice(0, 30)
    : [];
  return {
    readable: obj.readable !== false,
    documentType: str(obj.document_type, 60),
    issuer: str(obj.issuer, 200),
    accountOrMeter: str(obj.account_or_meter, 120),
    periodStart: date(obj.period_start),
    periodEnd: date(obj.period_end),
    readings,
    total: reading(obj.total, allowed),
    notes: str(obj.notes, 1000),
    fellBackToProse: false,
  };
}
