'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import {
  EQUIPMENT_GROUPS, EQUIPMENT_TYPE_LABELS, ENERGY_SOURCES, EQUIPMENT_STATUSES,
  CAPACITY_UNITS, CAPACITY_UNIT_LABELS, holdsRefrigerant, connectedLoadKw,
} from '@/lib/site-equipment';
import { Plus, Trash2, Edit2, Cpu, X } from 'lucide-react';
import type { SiteEquipment } from '@/lib/supabase/types';

interface Props {
  siteId: string;
  siteName: string;
  canEdit: boolean;
  /** Refrigerant codes from the reference table, for the charge fields. */
  refrigerants: { refrigerant_code: string; refrigerant_name: string }[];
}

interface FormState {
  name: string;
  equipment_type: string;
  quantity: string;
  manufacturer: string;
  model: string;
  asset_tag: string;
  energy_source: string;
  rated_capacity: string;
  capacity_unit: string;
  rated_power_kw: string;
  install_year: string;
  operating_hours_per_year: string;
  refrigerant_code: string;
  refrigerant_charge_kg: string;
  status: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: '', equipment_type: 'chiller', quantity: '1',
  manufacturer: '', model: '', asset_tag: '',
  energy_source: 'electricity', rated_capacity: '', capacity_unit: '',
  rated_power_kw: '', install_year: '', operating_hours_per_year: '',
  refrigerant_code: '', refrigerant_charge_kg: '',
  status: 'operating', notes: '',
};

const NONE = '__none__';

/**
 * Per-site asset register.
 *
 * Loads lazily when the tab is opened rather than with the settings page: most
 * visits to Settings are not about equipment, and a site with 200 assets should
 * not slow down a team-member rename.
 */
export function SiteEquipmentPanel({ siteId, siteName, canEdit, refrigerants }: Props) {
  const supabase = createClient();
  const { toast } = useToast();

  const [equipment, setEquipment] = useState<SiteEquipment[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState('');

  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState<SiteEquipment | null>(null);
  const [form, setForm]           = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState('');
  const [deleting, setDeleting]   = useState<SiteEquipment | null>(null);

  useEffect(() => {
    let cancelled = false;

    // State transitions all happen in the async callback rather than in the
    // effect body: setting `loading` synchronously here would re-render before
    // the fetch had even started. The initial state is already `true`.
    async function fetchEquipment() {
      const { data, error } = await supabase
        .from('site_equipment')
        .select('*')
        .eq('site_id', siteId)
        .eq('is_active', true)
        .order('equipment_type')
        .order('name');

      if (cancelled) return;
      if (error) setLoadError(error.message);
      else { setLoadError(''); setEquipment(data ?? []); }
      setLoading(false);
    }

    void fetchEquipment();
    return () => { cancelled = true; };
  }, [siteId, supabase]);

  const setField = (key: keyof FormState, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const load = connectedLoadKw(equipment);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  }

  function openEdit(e: SiteEquipment) {
    setEditing(e);
    setForm({
      name: e.name,
      equipment_type: e.equipment_type,
      quantity: String(e.quantity ?? 1),
      manufacturer: e.manufacturer ?? '',
      model: e.model ?? '',
      asset_tag: e.asset_tag ?? '',
      energy_source: e.energy_source ?? '',
      rated_capacity: e.rated_capacity != null ? String(e.rated_capacity) : '',
      capacity_unit: e.capacity_unit ?? '',
      rated_power_kw: e.rated_power_kw != null ? String(e.rated_power_kw) : '',
      install_year: e.install_year != null ? String(e.install_year) : '',
      operating_hours_per_year: e.operating_hours_per_year != null ? String(e.operating_hours_per_year) : '',
      refrigerant_code: e.refrigerant_code ?? '',
      refrigerant_charge_kg: e.refrigerant_charge_kg != null ? String(e.refrigerant_charge_kg) : '',
      status: e.status,
      notes: e.notes ?? '',
    });
    setFormError('');
    setShowForm(true);
  }

  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  async function save() {
    if (!form.name.trim()) { setFormError('Name is required.'); return; }
    setSaving(true);
    setFormError('');

    const payload = {
      site_id: siteId,
      name: form.name.trim(),
      equipment_type: form.equipment_type,
      quantity: Number(form.quantity) || 1,
      manufacturer: form.manufacturer || null,
      model: form.model || null,
      asset_tag: form.asset_tag || null,
      energy_source: form.energy_source || null,
      rated_capacity: num(form.rated_capacity),
      capacity_unit: form.capacity_unit || null,
      rated_power_kw: num(form.rated_power_kw),
      install_year: num(form.install_year),
      operating_hours_per_year: num(form.operating_hours_per_year),
      refrigerant_code: form.refrigerant_code || null,
      refrigerant_charge_kg: num(form.refrigerant_charge_kg),
      status: form.status,
      notes: form.notes || null,
    };

    if (editing) {
      const { data, error } = await supabase
        .from('site_equipment').update(payload).eq('id', editing.id).select().single();
      if (error) { setFormError(error.message); setSaving(false); return; }
      setEquipment((prev) => prev.map((e) => (e.id === data.id ? data : e)));
    } else {
      const { data, error } = await supabase
        .from('site_equipment').insert(payload).select().single();
      if (error) { setFormError(error.message); setSaving(false); return; }
      setEquipment((prev) => [...prev, data]);
    }

    setSaving(false);
    setShowForm(false);
  }

  /**
   * Soft delete, matching how sites are archived: an asset that was on the
   * floor during a reported year stays retrievable for an assurance review.
   */
  async function remove() {
    if (!deleting) return;
    const target = deleting;
    const { data, error } = await supabase
      .from('site_equipment').update({ is_active: false }).eq('id', target.id).select('id');
    setDeleting(null);
    if (error || !data?.length) {
      toast(error?.message ?? 'That item could not be removed.', 'error');
      return;
    }
    setEquipment((prev) => prev.filter((e) => e.id !== target.id));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-medium text-gray-900">Equipment inventory</p>
          <p className="text-xs text-gray-500 mt-0.5">
            What consumes energy at {siteName}. Enough for a basic register — not a maintenance system.
          </p>
        </div>
        {canEdit && !showForm && (
          <Button size="sm" onClick={openNew}><Plus size={14} />Add equipment</Button>
        )}
      </div>

      {/* Roll-up. Deliberately reports how much is unknown alongside the total:
          a connected-load figure derived from a third of the register is
          misleading unless it says so. */}
      {equipment.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-xs">
          <span className="text-gray-500">
            <strong className="text-gray-900 text-sm">{equipment.length}</strong> items
          </span>
          <span className="text-gray-500">
            Connected load{' '}
            <strong className="text-gray-900 text-sm">
              {load.knownKw.toLocaleString('en-US', { maximumFractionDigits: 1 })} kW
            </strong>
          </span>
          {load.itemsWithoutPower > 0 && (
            <span className="text-amber-600">
              {load.itemsWithoutPower} item{load.itemsWithoutPower === 1 ? '' : 's'} with no rated kW — excluded from the total
            </span>
          )}
        </div>
      )}

      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {/* ── Form ─────────────────────────────────────────────────────────── */}
      {showForm && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-900">
              {editing ? 'Edit equipment' : 'Add equipment'}
            </p>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label required>Name / tag</Label>
              <Input
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="e.g. Chiller #2"
              />
            </div>
            <div>
              <Label required>Type</Label>
              <Select value={form.equipment_type} onValueChange={(v) => setField('equipment_type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                {/* SelectGroup/SelectLabel rather than a plain div: Radix needs
                    the primitives to keep grouping accessible to screen readers
                    and to keep typeahead working across a list this long. */}
                <SelectContent>
                  {EQUIPMENT_GROUPS.map((g) => (
                    <SelectGroup key={g.group}>
                      <SelectLabel className="px-2 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                        {g.group}
                      </SelectLabel>
                      {g.items.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label>Quantity</Label>
              <Input type="number" min="1" value={form.quantity} onChange={(e) => setField('quantity', e.target.value)} />
            </div>
            <div>
              <Label>Energy source</Label>
              <Select value={form.energy_source || NONE} onValueChange={(v) => setField('energy_source', v === NONE ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not recorded</SelectItem>
                  {ENERGY_SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setField('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EQUIPMENT_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Install year</Label>
              <Input type="number" value={form.install_year} onChange={(e) => setField('install_year', e.target.value)} placeholder="2018" />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label>Nameplate capacity</Label>
              <Input type="number" value={form.rated_capacity} onChange={(e) => setField('rated_capacity', e.target.value)} placeholder="500" />
            </div>
            <div>
              <Label>Capacity unit</Label>
              <Select value={form.capacity_unit || NONE} onValueChange={(v) => setField('capacity_unit', v === NONE ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {CAPACITY_UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Rated power (kW)</Label>
              <Input type="number" value={form.rated_power_kw} onChange={(e) => setField('rated_power_kw', e.target.value)} placeholder="350" />
              <p className="text-[11px] text-gray-400 mt-1">Electrical draw. Drives the connected-load roll-up.</p>
            </div>
            <div>
              <Label>Operating hrs/yr</Label>
              <Input type="number" value={form.operating_hours_per_year} onChange={(e) => setField('operating_hours_per_year', e.target.value)} placeholder="4000" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Manufacturer</Label>
              <Input value={form.manufacturer} onChange={(e) => setField('manufacturer', e.target.value)} />
            </div>
            <div>
              <Label>Model</Label>
              <Input value={form.model} onChange={(e) => setField('model', e.target.value)} />
            </div>
            <div>
              <Label>Asset tag / serial</Label>
              <Input value={form.asset_tag} onChange={(e) => setField('asset_tag', e.target.value)} />
            </div>
          </div>

          {/* Refrigerant charge is the input to fugitive-emission screening, so
              it is offered wherever a charge is plausible — and kept if it was
              already recorded against a type that normally has none. */}
          {(holdsRefrigerant(form.equipment_type) || form.refrigerant_code || form.refrigerant_charge_kg) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg bg-blue-50/50 border border-blue-100 p-3">
              <div>
                <Label>Refrigerant</Label>
                <Select value={form.refrigerant_code || NONE} onValueChange={(v) => setField('refrigerant_code', v === NONE ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not recorded</SelectItem>
                    {refrigerants.map((r) => (
                      <SelectItem key={r.refrigerant_code} value={r.refrigerant_code}>
                        {r.refrigerant_code} — {r.refrigerant_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Charge (kg)</Label>
                <Input type="number" value={form.refrigerant_charge_kg} onChange={(e) => setField('refrigerant_charge_kg', e.target.value)} placeholder="180" />
                <p className="text-[11px] text-gray-400 mt-1">
                  Full charge. Used to screen fugitive Scope 1 emissions.
                </p>
              </div>
            </div>
          )}

          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add equipment'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* ── List ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <p className="text-sm text-gray-400 py-6 text-center">Loading equipment…</p>
      ) : equipment.length === 0 ? (
        <div className="py-12 text-center border border-dashed border-gray-200 rounded-lg">
          <Cpu size={28} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm font-medium text-gray-700">No equipment recorded</p>
          <p className="text-xs text-gray-400 mt-1">
            Add the major loads — chillers, boilers, compressors, production machines.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {equipment.map((e) => (
            <div key={e.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">{e.name}</span>
                  {e.quantity > 1 && <Badge variant="secondary">×{e.quantity}</Badge>}
                  <Badge variant="outline">{EQUIPMENT_TYPE_LABELS[e.equipment_type] ?? e.equipment_type}</Badge>
                  {e.status !== 'operating' && <Badge variant="secondary">{e.status}</Badge>}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {[
                    [e.manufacturer, e.model].filter(Boolean).join(' ') || null,
                    e.rated_power_kw != null ? `${e.rated_power_kw.toLocaleString()} kW` : null,
                    e.rated_capacity != null
                      ? `${e.rated_capacity.toLocaleString()} ${e.capacity_unit ? CAPACITY_UNIT_LABELS[e.capacity_unit] ?? e.capacity_unit : ''}`.trim()
                      : null,
                    e.energy_source ? e.energy_source.replace(/_/g, ' ') : null,
                    e.refrigerant_code
                      ? `${e.refrigerant_code}${e.refrigerant_charge_kg != null ? ` · ${e.refrigerant_charge_kg} kg charge` : ''}`
                      : null,
                    e.install_year ? `installed ${e.install_year}` : null,
                  ].filter(Boolean).join(' · ') || 'No details recorded'}
                </p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(e)}><Edit2 size={13} /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(e)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50">
                    <Trash2 size={13} />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove this equipment?"
        description={`${deleting?.name} will be removed from the active inventory. The record is retained for audit history.`}
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </div>
  );
}
