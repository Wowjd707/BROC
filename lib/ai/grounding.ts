/**
 * Checking generated text against the data it was given.
 *
 * The standing rule is that the platform never fabricates a factor or a
 * reported figure. A language model does not know that rule, and the single
 * worst outcome for this product is a filed disclosure containing a plausible
 * number nobody measured.
 *
 * So every draft is checked: extract the figures the model wrote, and report
 * any that do not appear in the data it was given. This is a **prompt to
 * verify, not a fabrication detector**, and the distinction matters. A model
 * that correctly derives "a 20% increase" from 1,000 and 1,200 has produced a
 * figure absent from its context, and it will be listed. That is the right
 * behaviour for a compliance tool — a derived figure still deserves a human
 * glance before it is filed — but it means the output must never be labelled
 * as errors.
 *
 * The check is cheap, deterministic and provider-independent: it works the same
 * against any model, and it does not ask a model to grade another model.
 *
 * Pure and dependency-free so it is unit-testable.
 */

export interface UngroundedFigure {
  /** The figure exactly as it appears in the draft. */
  text: string;
  value: number;
}

/**
 * Structural identifiers, not quantities. `E1-6`, `305-1`, `Scope 3`,
 * `Category 15`, `ESRS 2` and ISO dates all carry digits that are never claims
 * about the undertaking's data, and flagging them would bury the real findings.
 */
const STRUCTURAL_PATTERNS: RegExp[] = [
  // Dates first: the requirement-code pattern below would otherwise consume
  // part of `2025-01-01` and leave `-01`, which parses as negative one.
  /\d{4}-\d{2}-\d{2}/g,
  // Named standards, which take a space: ESRS 2, GRI 305, IFRS S2.
  /\b(?:ESRS|GRI|IFRS|ISO|SASB|CDP|TCFD|SBTi)\s?[A-Z]?\d+(?:[-–]\d+)?/gi,
  // Requirement codes and unit strings: E1, E1-6, S1, G1, and the `CO2` inside
  // `tCO2e`. Letters must be immediately adjacent to the digits — allowing a
  // space here would swallow the figure in an ordinary sentence such as
  // "A 35% reduction", which is exactly the kind of claim worth checking.
  /[A-Za-z]{1,5}\d+(?:[-–]\d+)?/g,
  // Hyphenated codes the previous pattern cannot reach: BP-1, GOV-1, 305-1.
  /\b[A-Z]{2,6}-\d+\b/g,
  /\b\d{3,4}-\d+\b/g,
  /\b(?:scope|category|tier|phase|step|question)\s+\d+\b/gi,
];

/** A number as written: optional sign, thousands separators, decimals. */
const NUMBER_PATTERN = /-?\d[\d,]*(?:\.\d+)?/g;

function stripStructural(text: string): string {
  let out = text;
  for (const pattern of STRUCTURAL_PATTERNS) {
    out = out.replace(pattern, ' ');
  }
  return out;
}

function parseNumber(raw: string): number | null {
  const value = Number(raw.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/** Decimal places as written — `12.30` is two, `12` is zero. */
function precisionOf(raw: string): number {
  const dot = raw.indexOf('.');
  return dot === -1 ? 0 : raw.length - dot - 1;
}

export function extractNumbers(text: string): { text: string; value: number }[] {
  const cleaned = stripStructural(text);
  const found: { text: string; value: number }[] = [];

  for (const match of cleaned.matchAll(NUMBER_PATTERN)) {
    const value = parseNumber(match[0]);
    if (value !== null) found.push({ text: match[0], value });
  }
  return found;
}

/**
 * Figures in `draft` that do not appear in `context`.
 *
 * A draft figure counts as grounded when it equals a context figure, or equals
 * one rounded to the precision the draft used — so a narrative saying
 * "1,235 tCO₂e" is grounded by a context value of 1234.56. Rounding is a normal
 * and correct thing for prose to do, and flagging it would train the reader to
 * ignore the warning.
 */
export function findUngroundedFigures(draft: string, context: string): UngroundedFigure[] {
  const contextNumbers = extractNumbers(context).map((n) => n.value);
  if (contextNumbers.length === 0 && draft.trim() === '') return [];

  const ungrounded: UngroundedFigure[] = [];
  const seen = new Set<string>();

  for (const candidate of extractNumbers(draft)) {
    const precision = precisionOf(candidate.text);

    const grounded = contextNumbers.some((contextValue) => {
      if (contextValue === candidate.value) return true;
      // Compare at the draft's own precision, both directions.
      const factor = 10 ** precision;
      return Math.round(contextValue * factor) / factor === candidate.value;
    });

    if (grounded) continue;

    const key = String(candidate.value);
    if (seen.has(key)) continue;
    seen.add(key);
    ungrounded.push({ text: candidate.text, value: candidate.value });
  }

  return ungrounded;
}

/**
 * One sentence for the reviewer. Deliberately says "verify", not "wrong" — the
 * check cannot tell a fabrication from a correct derivation, and claiming
 * otherwise would be its own kind of false assurance.
 */
export function describeUngrounded(figures: UngroundedFigure[]): string | null {
  if (figures.length === 0) return null;
  const list = figures.map((f) => f.text).join(', ');
  return figures.length === 1
    ? `The figure ${list} does not appear in the data supplied to the model. Verify it before saving.`
    : `These figures do not appear in the data supplied to the model: ${list}. Verify each before saving.`;
}
