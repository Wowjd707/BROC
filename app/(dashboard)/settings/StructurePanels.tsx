'use client';

import { useState, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { buildUnitTree, flattenUnitTree } from '@/lib/scope-filter-core';
import type { BusinessUnit, SiteGroup, Site } from '@/lib/supabase/types';
import { Plus, Layers, Boxes, Upload } from 'lucide-react';
import { BusinessUnitImportDialog } from './BusinessUnitImportDialog';

interface GroupMember { group_id: string; site_id: string; }

interface Props {
  canEdit: boolean;
  isAdmin: boolean;
  sites: Site[];
  businessUnits: BusinessUnit[];
  siteGroups: SiteGroup[];
  groupMembers: GroupMember[];
}

// ─── Business units ──────────────────────────────────────────────────────────

export function BusinessUnitsPanel({ canEdit, isAdmin, sites, businessUnits }: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [showImport, setShowImport] = useState(false);
  const [units, setUnits] = useState<BusinessUnit[]>(businessUnits);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BusinessUnit | null>(null);
  const [form, setForm] = useState({ name: '', code: '', parent_id: '', description: '', sort_order: '0' });
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const nodes = useMemo(() => flattenUnitTree(buildUnitTree(units)), [units]);
  const sitesByUnit = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sites) {
      if (s.business_unit_id) m.set(s.business_unit_id, (m.get(s.business_unit_id) ?? 0) + 1);
    }
    return m;
  }, [sites]);

  const unassignedCount = sites.filter(s => !s.business_unit_id).length;

  function openCreate() {
    setForm({ name: '', code: '', parent_id: '', description: '', sort_order: '0' });
    setEditing(null); setError(''); setShowForm(true);
  }

  function openEdit(u: BusinessUnit) {
    setForm({
      name: u.name,
      code: u.code ?? '',
      parent_id: u.parent_id ?? '',
      description: u.description ?? '',
      sort_order: String(u.sort_order),
    });
    setEditing(u); setError(''); setShowForm(true);
  }

  /** Units that cannot be this unit's parent: itself and its own descendants. */
  const invalidParents = useMemo(() => {
    if (!editing) return new Set<string>();
    const blocked = new Set<string>([editing.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const u of units) {
        if (u.parent_id && blocked.has(u.parent_id) && !blocked.has(u.id)) {
          blocked.add(u.id); grew = true;
        }
      }
    }
    return blocked;
  }, [editing, units]);

  async function save() {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setError('');

    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      parent_id: form.parent_id || null,
      description: form.description.trim() || null,
      sort_order: parseInt(form.sort_order) || 0,
    };

    startTransition(async () => {
      if (editing) {
        const { data, error: err } = await supabase
          .from('business_units').update(payload).eq('id', editing.id).select().single();
        if (err) { setError(err.message); return; }
        setUnits(us => us.map(u => (u.id === editing.id ? (data as BusinessUnit) : u)));
      } else {
        const { data, error: err } = await supabase
          .from('business_units').insert(payload).select().single();
        if (err) { setError(err.message); return; }
        setUnits(us => [...us, data as BusinessUnit]);
      }
      setShowForm(false);
      router.refresh();
    });
  }

  async function remove() {
    if (!deleteId) return;
    const { error: err } = await supabase.from('business_units').delete().eq('id', deleteId);
    if (!err) setUnits(us => us.filter(u => u.id !== deleteId));
    setDeleteId(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <Layers size={14} /> Business units
          </h2>
          <p className="text-xs text-gray-500 mt-0.5 max-w-xl">
            Your reporting hierarchy. A site belongs to exactly one unit, so roll-ups never
            double-count. Selecting a unit in the scope picker includes everything beneath it.
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
              <Upload size={14} className="mr-1 text-emerald-600" />Import
            </Button>
            <Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" />Add unit</Button>
          </div>
        )}
      </div>

      {unassignedCount > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-900">
          {unassignedCount} site{unassignedCount === 1 ? ' is' : 's are'} not assigned to a business unit.
          Unassigned sites are excluded from unit roll-ups — assign them on the Sites tab.
        </div>
      )}

      {units.length === 0 ? (
        <div className="rounded-xl border border-gray-200 py-10 text-center text-sm text-gray-500">
          No business units yet. Add one to start building your reporting hierarchy.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 divide-y divide-gray-50">
          {nodes.map((n) => {
            const unit = units.find(u => u.id === n.id)!;
            const count = sitesByUnit.get(n.id) ?? 0;
            return (
              <div key={n.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50">
                <div className="flex-1 min-w-0" style={{ paddingLeft: `${n.depth * 20}px` }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-900">{unit.name}</span>
                    {unit.code && <Badge variant="secondary">{unit.code}</Badge>}
                    <span className="text-xs text-gray-400">
                      {count} site{count === 1 ? '' : 's'}
                    </span>
                  </div>
                  {unit.description && <p className="text-xs text-gray-400 mt-0.5">{unit.description}</p>}
                </div>
                {canEdit && (
                  <button onClick={() => openEdit(unit)} className="text-xs text-emerald-700 hover:underline">Edit</button>
                )}
                {isAdmin && (
                  <button onClick={() => setDeleteId(unit.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) setShowForm(false); }}>
        <BusinessUnitImportDialog open={showImport} onClose={() => setShowImport(false)} />

        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit business unit' : 'Add business unit'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label required>Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <Label>Code</Label>
                <Input value={form.code} placeholder="EMEA" onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Parent unit</Label>
              <Select value={form.parent_id} onValueChange={v => setForm(f => ({ ...f, parent_id: v === '__none__' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="None (top level)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (top level)</SelectItem>
                  {nodes.filter(n => !invalidParents.has(n.id)).map(n => (
                    <SelectItem key={n.id} value={n.id}>
                      {' '.repeat(n.depth * 2)}{n.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editing && (
                <p className="text-xs text-gray-400 mt-1">
                  This unit and everything beneath it are excluded — a unit cannot sit inside its own branch.
                </p>
              )}
            </div>
            <div>
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <Label>Sort order</Label>
              <Input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={save} disabled={isPending}>{isPending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete business unit?"
        description="Sites and child units pointing at it become unassigned. Emission data is not affected."
        onConfirm={remove}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

// ─── Site groups ─────────────────────────────────────────────────────────────

export function SiteGroupsPanel({ canEdit, sites, siteGroups, groupMembers }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();

  const [groups, setGroups] = useState<SiteGroup[]>(siteGroups);
  const [members, setMembers] = useState<GroupMember[]>(groupMembers);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SiteGroup | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [selectedSites, setSelectedSites] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const membersByGroup = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const gm of members) m.set(gm.group_id, [...(m.get(gm.group_id) ?? []), gm.site_id]);
    return m;
  }, [members]);

  function openCreate() {
    setForm({ name: '', description: '' });
    setSelectedSites(new Set());
    setEditing(null); setError(''); setShowForm(true);
  }

  function openEdit(g: SiteGroup) {
    setForm({ name: g.name, description: g.description ?? '' });
    setSelectedSites(new Set(membersByGroup.get(g.id) ?? []));
    setEditing(g); setError(''); setShowForm(true);
  }

  function toggleSite(id: string) {
    setSelectedSites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setError('');

    startTransition(async () => {
      let groupId: string;

      if (editing) {
        const { error: err } = await supabase
          .from('site_groups')
          .update({ name: form.name.trim(), description: form.description.trim() || null })
          .eq('id', editing.id);
        if (err) { setError(err.message); return; }
        groupId = editing.id;
        setGroups(gs => gs.map(g => g.id === editing.id
          ? { ...g, name: form.name.trim(), description: form.description.trim() || null }
          : g));
      } else {
        const { data, error: err } = await supabase
          .from('site_groups')
          .insert({ name: form.name.trim(), description: form.description.trim() || null })
          .select().single();
        if (err) { setError(err.message); return; }
        groupId = (data as SiteGroup).id;
        setGroups(gs => [...gs, data as SiteGroup]);
      }

      // Replace membership wholesale — simpler and more predictable than
      // diffing, and the sets are small.
      await supabase.from('site_group_members').delete().eq('group_id', groupId);
      const rows = Array.from(selectedSites).map(site_id => ({ group_id: groupId, site_id }));
      if (rows.length > 0) {
        const { error: memberErr } = await supabase.from('site_group_members').insert(rows);
        if (memberErr) { setError(memberErr.message); return; }
      }
      setMembers(ms => [...ms.filter(m => m.group_id !== groupId), ...rows]);

      setShowForm(false);
      router.refresh();
    });
  }

  async function remove() {
    if (!deleteId) return;
    const { data, error: err } = await supabase.from('site_groups').delete().eq('id', deleteId).select('id');
    if (err || !data?.length) {
      setDeleteId(null);
      toast(err?.message ?? 'That group could not be deleted.', 'error');
      return;
    }
    setGroups(gs => gs.filter(g => g.id !== deleteId));
    setMembers(ms => ms.filter(m => m.group_id !== deleteId));
    setDeleteId(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <Boxes size={14} /> Site groups
          </h2>
          <p className="text-xs text-gray-500 mt-0.5 max-w-xl">
            Ad-hoc sets for analysis — &ldquo;EU manufacturing&rdquo;, &ldquo;ISO 14001 sites&rdquo;, &ldquo;2026 audit scope&rdquo;.
            A site can belong to any number of groups, so these are for slicing, not for reporting roll-ups.
          </p>
        </div>
        {canEdit && <Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" />Add group</Button>}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-gray-200 py-10 text-center text-sm text-gray-500">
          No groups yet.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 divide-y divide-gray-50">
          {groups.map(g => {
            const count = (membersByGroup.get(g.id) ?? []).length;
            return (
              <div key={g.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50/50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-900">{g.name}</span>
                    <span className="text-xs text-gray-400">{count} site{count === 1 ? '' : 's'}</span>
                  </div>
                  {g.description && <p className="text-xs text-gray-400 mt-0.5">{g.description}</p>}
                </div>
                {canEdit && (
                  <>
                    <button onClick={() => openEdit(g)} className="text-xs text-emerald-700 hover:underline">Edit</button>
                    <button onClick={() => setDeleteId(g.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(o) => { if (!o) setShowForm(false); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit group' : 'Add group'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label required>Name</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <Label>Sites ({selectedSites.size} selected)</Label>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-50">
                {sites.map(s => (
                  <label key={s.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selectedSites.has(s.id)}
                      onChange={() => toggleSite(s.id)}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-gray-900">{s.name}</span>
                    {s.city && <span className="text-xs text-gray-400">{s.city}</span>}
                  </label>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={save} disabled={isPending}>{isPending ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete group?"
        description="The group and its membership are removed. Sites and their data are not affected."
        onConfirm={remove}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
