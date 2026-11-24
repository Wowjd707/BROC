import type { Geometry, RiskAssessmentRow } from '@/lib/eudr-core';

export interface Org { id: string; name: string; legal_address: string | null; eori_number: string | null }
export interface ProductRow {
  id: string; part_number: string; description: string | null;
  hs_code: string | null; cn_code: string | null; hts_code: string | null;
  supplier_id: string | null; is_active: boolean;
}
export interface RuleRow { regulation: string; code_system: string; cn_prefix: string }
export interface Named { id: string; name: string }
export interface Plot {
  id: string; supplier_id: string | null; name: string; producer_name: string | null; country_code: string;
  commodity: string | null; geometry: Geometry; area_ha: number | null; source: string;
  source_value_id: string | null; notes: string | null; is_active: boolean;
}
export type Assessment = RiskAssessmentRow & { notes: string | null };
export interface Shipment {
  id: string; product_id: string; supplier_id: string | null; reference: string;
  activity: 'import' | 'export' | 'domestic'; hs_code: string | null; description: string | null;
  net_mass_kg: number | null; supplementary_quantity: number | null; supplementary_unit: string | null;
  countries_of_production: string[]; production_from: string | null; production_to: string | null;
  upstream_references: { reference: string; verification?: string }[];
  risk_assessment_id: string | null; status: 'draft' | 'filed' | 'withdrawn';
  dds_reference: string | null; dds_verification_number: string | null; filed_at: string | null;
  notes: string | null; created_at: string;
}
export interface Link { shipment_id: string; plot_id: string }
export interface ValueRow { id: string; product_id: string; field_key: string; value: string; recorded_at: string }

export const today = () => new Date().toISOString().slice(0, 10);

/** The HS code a statement should carry: the product's HS code, else the first six digits of its CN or HTS code. */
export function hsFor(p: ProductRow | undefined): string | null {
  if (!p) return null;
  return p.hs_code ?? p.cn_code?.slice(0, 6) ?? p.hts_code?.slice(0, 6) ?? null;
}

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
