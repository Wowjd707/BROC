import 'server-only';
import { createServerClient, createServiceClient } from './supabase/server';
import { parseCsvToObjects } from './csv';
import { mapRequirementCsvRow, type MappedRequirementRow, type TopicCodesDirective } from './requirement-import-core';
import type { ImportRowError, ImportSummary } from './import-core';

/**
 * Bulk-import disclosure requirements.
 *
 * Requirements are shared catalog data, not tenant data, so writing them needs
 * admin rights. Validation is all-or-nothing for the same reason the factor
 * import is: a half-loaded framework silently under-reports coverage, which is
 * worse than a failed import.
 *
 * Existing (framework_code, requirement_code) pairs are UPDATED rather than
 * duplicated, so re-importing a corrected file amends the catalog in place —
 * that is the normal way an organization applies a standard's revision.
 */
export async function importRequirementCsv(csvText: string): Promise<ImportSummary> {
  const supabase = await createServerClient();

  // Catalog writes are admin-only; the tables have no tenant scoping to fall
  // back on, so this check is the access control.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { imported: 0, failed: 1, errors: [{ line: 0, message: 'Not authenticated.' }] };
  }
  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') {
    return {
      imported: 0,
      failed: 1,
      errors: [{ line: 0, message: 'Only an admin can modify the disclosure framework catalog.' }],
    };
  }

  const { rows } = parseCsvToObjects(csvText);
  const errors: ImportRowError[] = [];
  const mapped: MappedRequirementRow[] = [];
  const topicDirectives: TopicCodesDirective[] = [];

  for (let i = 0; i < rows.length; i++) {
    const result = mapRequirementCsvRow(rows[i]);
    if (result.ok) {
      mapped.push(result.row);
      topicDirectives.push(result.topicCodes);
    } else {
      errors.push({ line: i + 1, message: result.error });
    }
  }

  if (errors.length > 0) return { imported: 0, failed: errors.length, errors };
  if (mapped.length === 0) {
    return { imported: 0, failed: 1, errors: [{ line: 0, message: 'No data rows found in the file.' }] };
  }

  // Every referenced framework must already exist — a typo in framework_code
  // would otherwise create orphan requirements that never render.
  const referenced = Array.from(new Set(mapped.map((r) => r.framework_code)));
  const { data: known } = await supabase
    .from('disclosure_frameworks').select('code').in('code', referenced);
  const knownCodes = new Set((known ?? []).map((f) => f.code));
  const unknown = referenced.filter((c) => !knownCodes.has(c));
  if (unknown.length > 0) {
    return {
      imported: 0,
      failed: mapped.length,
      errors: [{
        line: 0,
        message: `Unknown framework_code(s): ${unknown.join(', ')}. Create the framework before importing its requirements.`,
      }],
    };
  }

  // Same for material topics: a typo in topic_codes would produce a link to a
  // topic nobody assesses, which under the gating rules leaves the requirement
  // permanently 'undetermined' with no way to resolve it.
  const referencedTopics = Array.from(new Set(topicDirectives.flatMap((d) => d ?? [])));
  if (referencedTopics.length > 0) {
    const { data: knownTopics } = await supabase
      .from('material_topics').select('code').in('code', referencedTopics);
    const knownTopicCodes = new Set((knownTopics ?? []).map((t) => t.code));
    const unknownTopics = referencedTopics.filter((c) => !knownTopicCodes.has(c));
    if (unknownTopics.length > 0) {
      return {
        imported: 0,
        failed: mapped.length,
        errors: [{
          line: 0,
          message: `Unknown topic_codes: ${unknownTopics.join(', ')}. Use the material topic codes from the materiality catalog (E1–E5, S1–S4, G1), separated by ";".`,
        }],
      };
    }
  }

  // The reference tables carry a SELECT policy only (migration 013), so the
  // write goes through the service role. The admin check above is therefore
  // the access control for this operation, not RLS.
  const service = createServiceClient();
  const { data: upserted, error } = await service
    .from('disclosure_requirements')
    .upsert(mapped, { onConflict: 'framework_code,requirement_code' })
    .select('id, framework_code, requirement_code');

  if (error) {
    return { imported: 0, failed: mapped.length, errors: [{ line: 0, message: error.message }] };
  }

  const linkError = await applyTopicLinks(service, mapped, topicDirectives, upserted ?? []);
  if (linkError) {
    return { imported: 0, failed: mapped.length, errors: [{ line: 0, message: linkError }] };
  }

  return { imported: mapped.length, failed: 0, errors: [] };
}

/**
 * Replace the requirement → material topic links for the rows that specified
 * `topic_codes`. Rows that left the column blank are skipped entirely, so an
 * import that predates the column cannot un-scope an existing framework.
 *
 * Runs after the requirement upsert because a newly-created requirement has no
 * id until then; ids come back from the upsert's RETURNING rather than a second
 * lookup.
 */
async function applyTopicLinks(
  service: ReturnType<typeof createServiceClient>,
  mapped: MappedRequirementRow[],
  directives: TopicCodesDirective[],
  upserted: { id: string; framework_code: string; requirement_code: string }[],
): Promise<string | null> {
  const idByKey = new Map(
    upserted.map((r) => [`${r.framework_code}::${r.requirement_code}`, r.id]),
  );

  const touched: string[] = [];
  const links: { requirement_id: string; topic_code: string }[] = [];

  for (let i = 0; i < mapped.length; i++) {
    const directive = directives[i];
    if (directive === undefined) continue;

    const id = idByKey.get(`${mapped[i].framework_code}::${mapped[i].requirement_code}`);
    if (!id) continue;

    touched.push(id);
    for (const topic of directive) links.push({ requirement_id: id, topic_code: topic });
  }

  if (touched.length === 0) return null;

  // Delete-then-insert rather than upsert: the directive REPLACES the link set,
  // and a topic removed from the file must actually be removed.
  const { error: deleteError } = await service
    .from('requirement_topics').delete().in('requirement_id', touched);
  if (deleteError) return deleteError.message;

  if (links.length === 0) return null;

  const { error: insertError } = await service.from('requirement_topics').insert(links);
  return insertError?.message ?? null;
}
