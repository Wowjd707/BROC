'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, ChevronRight } from 'lucide-react';
import { countryName, toCountryCode } from '@/lib/eudr-core';
import { issuesFor, assessmentsFor } from './ShipmentDrawer';
import { AddPlotsDialog, fmtArea } from './PlotsTab';
import type { AssessmentPreset } from './RiskTab';
import { today, type Assessment, type Link, type Named, type Org, type Plot, type ProductRow, type RuleRow, type Shipment, type ValueRow } from './types';

/**
 * EUDR inside a part: its shipments, its supplier's plots and the risk
 * assessments that cover where it is produced. Everything that spans parts
 * (the queue of statements to file) is on the EUDR dashboard.
 */
export function EudrPartPanel({
  product, org, products, rules, suppliers, plots, assessments, shipments, links, values, canEdit,
  onOpenShipment, onOpenAssessment, onChanged,
}: {
  product: ProductRow & { country_of_origin?: string | null };
  org: Org | null;
  products: ProductRow[];
  rules: RuleRow[];
  suppliers: Named[];
  plots: Plot[];
  assessments: Assessment[];
  shipments: Shipment[];
  links: Link[];
  values: ValueRow[];
  canEdit: boolean;
  onOpenShipment: (id: string | null) => void;
  onOpenAssessment: (id: string | null, preset?: AssessmentPreset) => void;
  onChanged: () => void;
}) {
  const [addingPlots, setAddingPlots] = useState(false);
  const mine = shipments.filter((s) => s.product_id === product.id);
  const supplier = suppliers.find((s) => s.id === product.supplier_id) ?? null;
  const supplierPlots = product.supplier_id ? plots.filter((p) => p.is_active && p.supplier_id === product.supplier_id) : [];
  const latest = (key: string) => values
    .filter((v) => v.product_id === product.id && v.field_key === key)
    .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0]?.value ?? null;
  const commodity = latest('eudr.commodity');
  const declaredCountry = toCountryCode(latest('eudr.country_of_production') ?? undefined) ?? toCountryCode(product.country_of_origin ?? undefined);
  const countries = [...new Set([declaredCountry, ...mine.flatMap((s) => s.countries_of_production)].filter((c): c is string => !!c))];
  const now = today();
  const common = { org, products, rules, plots, assessments, links };

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">Shipments</p>
            <p className="text-xs text-gray-500">One due diligence statement each time this part is placed on the market or exported.</p>
          </div>
          {canEdit && <Button size="sm" onClick={() => onOpenShipment(null)}><Plus size={13} className="mr-1" />New shipment</Button>}
        </div>
        {mine.length === 0 ? (
          <p className="text-sm text-gray-500 rounded-md border border-dashed border-gray-200 px-3 py-3">No shipments of this part yet.</p>
        ) : (
          <ul className="divide-y divide-gray-50 border border-gray-100 rounded-lg">
            {mine.map((s) => {
              const blocks = issuesFor(s, common).issues.filter((i) => i.level === 'block').length;
              return (
                <li key={s.id}>
                  <button className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50" onClick={() => onOpenShipment(s.id)}>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-gray-900">{s.reference}</span>
                      <span className="block text-xs text-gray-500 truncate">
                        {[s.countries_of_production.map(countryName).join(', '), s.net_mass_kg != null ? `${Number(s.net_mass_kg).toLocaleString()} kg` : null].filter(Boolean).join(' · ') || 'No details yet'}
                      </span>
                    </span>
                    {s.status === 'filed' ? <Badge variant="default">Filed</Badge>
                      : s.status === 'withdrawn' ? <Badge variant="secondary">Withdrawn</Badge>
                        : blocks === 0 ? <Badge variant="default">Ready to file</Badge> : <Badge variant="warning">{blocks} to resolve</Badge>}
                    <ChevronRight size={14} className="text-gray-300" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">Plots of land</p>
            <p className="text-xs text-gray-500">{supplier ? `Where ${supplier.name} produces. A shipment picks from these.` : 'Plots belong to a supplier.'}</p>
          </div>
          {canEdit && supplier && <Button size="sm" variant="outline" onClick={() => setAddingPlots(true)}><Plus size={13} className="mr-1" />Add plots</Button>}
        </div>
        {!supplier ? (
          <p className="text-sm text-gray-500">Set this part&rsquo;s supplier (Edit, on the Overview tab) to see and add its plots.</p>
        ) : supplierPlots.length === 0 ? (
          <p className="text-sm text-gray-500 rounded-md border border-dashed border-gray-200 px-3 py-3">
            No plots from {supplier.name} yet. Paste GeoJSON or coordinates, or import their survey answers on the EUDR dashboard.
          </p>
        ) : (
          <ul className="text-sm text-gray-700 divide-y divide-gray-50 border border-gray-100 rounded-lg">
            {supplierPlots.slice(0, 8).map((p) => (
              <li key={p.id} className="flex justify-between gap-3 px-3 py-1.5">
                <span className="truncate">{p.name}</span>
                <span className="text-xs text-gray-500 whitespace-nowrap">{countryName(p.country_code)} · {p.geometry.type} · {fmtArea(p.area_ha)}</span>
              </li>
            ))}
            {supplierPlots.length > 8 && <li className="px-3 py-1.5 text-xs text-gray-500">and {supplierPlots.length - 8} more, on the EUDR dashboard</li>}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">Risk assessment</p>
            <p className="text-xs text-gray-500">Each country this part is produced in needs one, for this supplier or any supplier.</p>
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => onOpenAssessment(null, { supplier_id: product.supplier_id, country: countries[0] ?? null, commodity })}>
              <Plus size={13} className="mr-1" />Add
            </Button>
          )}
        </div>
        {countries.length === 0 ? (
          <p className="text-sm text-gray-500">No country of production known yet: ask the supplier, or add a shipment with its countries.</p>
        ) : (
          <ul className="divide-y divide-gray-50 border border-gray-100 rounded-lg">
            {countries.map((c) => {
              const covering = assessmentsFor({ supplier_id: product.supplier_id, countries_of_production: [c] }, assessments);
              const a = covering[0];
              const overdue = a?.review_by ? a.review_by < now : false;
              return (
                <li key={c} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-1 min-w-0 text-sm">
                    <span className="text-gray-900">{countryName(c)}</span>
                    {a && <span className="block text-xs text-gray-500">{a.commodity} · {a.country_risk} country risk · assessed {a.assessed_at}{a.review_by ? ` · review by ${a.review_by}` : ''}</span>}
                  </span>
                  {!a ? (
                    canEdit
                      ? <Button size="sm" variant="outline" onClick={() => onOpenAssessment(null, { supplier_id: product.supplier_id, country: c, commodity })}>Assess</Button>
                      : <Badge variant="secondary">None</Badge>
                  ) : (
                    <button onClick={() => onOpenAssessment(a.id)} className="flex items-center gap-2">
                      {overdue ? <Badge variant="destructive">Review overdue</Badge>
                        : a.conclusion === 'negligible' ? <Badge variant="default">Negligible</Badge> : <Badge variant="warning">Not negligible</Badge>}
                      <ChevronRight size={14} className="text-gray-300" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {addingPlots && (
        <AddPlotsDialog open suppliers={suppliers}
          preset={{ supplier_id: product.supplier_id, country: declaredCountry, commodity }}
          onClose={() => setAddingPlots(false)} onSaved={() => { setAddingPlots(false); onChanged(); }} />
      )}
    </div>
  );
}
