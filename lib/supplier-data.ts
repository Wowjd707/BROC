import 'server-only';
import { fetchAll } from './fetch-all';
import { createServerClient } from './supabase/server';
import {
  declarationFromCbamFactor,
  declarationFromSurveyAnswers,
  scoreSupplier,
  type SupplierDeclaration,
  type SupplierScore,
  type CbamFactorRow,
} from './supplier-data-core';

export type { SupplierDeclaration, SupplierScore } from './supplier-data-core';

export interface SupplierDataOverview {
  declarations: SupplierDeclaration[];
  scores: SupplierScore[];
}

/**
 * Collect every supplier-provided emission declaration available to the org,
 * from both the CBAM factor store and CBAM survey responses, and score each
 * supplier's data quality. All reads are RLS-scoped to the caller's org.
 */
export async function getSupplierDataOverview(currentYear: number): Promise<SupplierDataOverview> {
  const supabase = await createServerClient();

  const [{ data: suppliers }, { data: cbamFactors }, { data: invitations }, { data: answers }] =
    await Promise.all([
      supabase.from('suppliers').select('id, name').eq('is_active', true).order('name'),
      supabase
        .from('cbam_supplier_factors')
        .select('supplier_id, supplier_name, commodity_name, emission_factor, factor_unit, factor_source, created_at')
        .order('created_at', { ascending: false }),
      fetchAll((from, to) => supabase
        .from('supplier_survey_invitations')
        .select('id, supplier_id, supplier_name, status, submitted_at, supplier_surveys(regulation_type)')
        .order('id')
        .range(from, to)),
      fetchAll((from, to) => supabase
        .from('supplier_survey_question_responses')
        .select('invitation_id, question_id, answer')
        .order('id')
        .range(from, to)),
    ]);

  // Group survey answers by invitation
  const answersByInvitation = new Map<string, Record<string, string>>();
  for (const a of answers ?? []) {
    const bucket = answersByInvitation.get(a.invitation_id) ?? {};
    bucket[a.question_id] = a.answer ?? '';
    answersByInvitation.set(a.invitation_id, bucket);
  }

  const declarations: SupplierDeclaration[] = [];

  // 1. Supplier-declared CBAM factors
  for (const f of (cbamFactors ?? []) as CbamFactorRow[]) {
    declarations.push(declarationFromCbamFactor(f));
  }

  // 2. CBAM survey responses carrying a declared intensity
  const respondedSupplierIds = new Set<string>();
  const invitedSupplierIds = new Set<string>();

  for (const inv of invitations ?? []) {
    if (inv.supplier_id) invitedSupplierIds.add(inv.supplier_id);
    if (inv.status === 'submitted' && inv.supplier_id) respondedSupplierIds.add(inv.supplier_id);

    const regulation = (inv as unknown as { supplier_surveys?: { regulation_type: string } | null })
      .supplier_surveys?.regulation_type;
    if (regulation !== 'cbam') continue;

    const bucket = answersByInvitation.get(inv.id);
    if (!bucket) continue;

    const declaration = declarationFromSurveyAnswers(
      inv.supplier_id,
      inv.supplier_name ?? 'Unknown supplier',
      bucket,
      inv.submitted_at,
    );
    if (declaration) declarations.push(declaration);
  }

  // Best declaration per supplier drives the score (verified beats self-declared,
  // then most recent).
  const bestBySupplier = new Map<string, SupplierDeclaration>();
  for (const d of declarations) {
    if (!d.supplierId) continue;
    const existing = bestBySupplier.get(d.supplierId);
    if (!existing) { bestBySupplier.set(d.supplierId, d); continue; }
    const better =
      (d.verified && !existing.verified) ||
      (d.verified === existing.verified && (d.declaredAt ?? '') > (existing.declaredAt ?? ''));
    if (better) bestBySupplier.set(d.supplierId, d);
  }

  const scores = (suppliers ?? []).map((s) =>
    scoreSupplier({
      supplierId: s.id,
      supplierName: s.name,
      invited: invitedSupplierIds.has(s.id),
      responded: respondedSupplierIds.has(s.id),
      declaration: bestBySupplier.get(s.id) ?? null,
      currentYear,
    }),
  );

  return { declarations, scores };
}
