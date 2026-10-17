'use client';

import { useState, useTransition, useMemo } from 'react';
import { releaseEvidence } from '@/components/evidence/release-evidence';
import type { TablesInsert } from '@/lib/supabase/types';
import { Upload } from 'lucide-react';
import { ProjectImportDialog } from './ProjectImportDialog';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fmtCO2e, fmt, formatDate, reportingYearRange } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { EvidenceCell } from '@/components/evidence/EvidencePanel';
import { evidenceCountKey } from '@/lib/evidence-core';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  description: string | null;
  category: string;
  status: string;
  site_id: string | null;
  estimated_co2e_reduction_kg_per_year: number | null;
  estimated_cost_usd: number | null;
  estimated_payback_months: number | null;
  actual_co2e_reduction_kg_per_year: number | null;
  // A project frequently saves more than one thing — a cooling retrofit cuts
  // both kWh and make-up water. Recording only carbon made the water and waste
  // pipelines permanently empty.
  estimated_water_reduction_gal_per_year: number | null;
  estimated_waste_reduction_kg_per_year: number | null;
  actual_water_reduction_gal_per_year: number | null;
  actual_waste_reduction_kg_per_year: number | null;
  start_date: string | null;
  completion_date: string | null;
  notes: string | null;
  created_at: string;
}

interface Site { id: string; name: string; }

interface Props {
  initialProjects: Project[];
  sites: Site[];
  userRole: string;
  /** null = all sites. [] = the current scope matches nothing. */
  scopeSiteIds: string[] | null;
  scopeLabel: string;
  currentYear: number;
  fyStart: number;
  /** Active organization; null only if the profile lookup failed. */
  organizationId: string | null;
  evidenceCounts: Record<string, number>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUSES = ['idea', 'approved', 'in_progress', 'completed'] as const;
type Status = typeof STATUSES[number];

const STATUS_LABELS: Record<Status, string> = {
  idea: 'Idea',
  approved: 'Approved',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const STATUS_COLORS: Record<Status, string> = {
  idea: 'bg-gray-100 text-gray-700',
  approved: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
};

const STATUS_BADGE: Record<Status, 'secondary' | 'blue' | 'warning' | 'default'> = {
  idea: 'secondary',
  approved: 'blue',
  in_progress: 'warning',
  completed: 'default',
};

const CATEGORIES = [
  { value: 'energy_efficiency', label: 'Energy Efficiency' },
  { value: 'renewable_energy', label: 'Renewable Energy' },
  { value: 'fleet', label: 'Fleet / Transport' },
  { value: 'refrigerants', label: 'Refrigerants' },
  { value: 'water', label: 'Water Conservation' },
  { value: 'waste', label: 'Waste Reduction' },
  { value: 'supply_chain', label: 'Supply Chain' },
  { value: 'custom', label: 'Other / Custom' },
];

const EMPTY_FORM = {
  name: '',
  description: '',
  category: 'energy_efficiency',
  status: 'idea' as Status,
  site_id: '',
  estimated_co2e_reduction_kg_per_year: '',
  estimated_water_reduction_gal_per_year: '',
  estimated_waste_reduction_kg_per_year: '',
  estimated_cost_usd: '',
  estimated_payback_months: '',
  start_date: '',
  completion_date: '',
  notes: '',
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function ProjectsClient({
  initialProjects, sites, userRole, scopeSiteIds, scopeLabel, currentYear, fyStart,
  organizationId, evidenceCounts,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [showCreate, setShowCreate] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formError, setFormError] = useState('');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isPending, startTransition] = useTransition();
  const [showImport, setShowImport] = useState(false);
  const canEdit = userRole === 'admin' || userRole === 'editor';

  const setField = (key: string, value: string) =>
    setForm(f => ({ ...f, [key]: value }));

  const siteMap = useMemo(() => new Map(sites.map(s => [s.id, s.name])), [sites]);

  // Projects with no site are organization-wide. They belong in every view, but
  // counting them into a single unit's pipeline would overstate it — so when a
  // scope is active they are separated out and reported rather than folded in.
  const inScope = useMemo(() => {
    if (scopeSiteIds === null) return projects;
    const allowed = new Set(scopeSiteIds);
    return projects.filter(p => p.site_id && allowed.has(p.site_id));
  }, [projects, scopeSiteIds]);

  const orgWideCount = useMemo(
    () => (scopeSiteIds === null ? 0 : projects.filter(p => !p.site_id).length),
    [projects, scopeSiteIds],
  );

  /** Years a project is active in, from its in-service date to completion. */
  const projectYears = useMemo(() => {
    const years = new Set<number>();
    for (const p of projects) {
      for (const d of [p.start_date, p.completion_date]) {
        if (d) years.add(new Date(d + 'T00:00:00').getFullYear());
      }
    }
    years.add(currentYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [projects, currentYear]);

  const visible = useMemo(() => {
    let rows = inScope;
    if (statusFilter !== 'all') rows = rows.filter(p => p.status === statusFilter);
    if (yearFilter !== 'all') {
      const y = parseInt(yearFilter);
      const { startDate, endDate } = reportingYearRange(y, fyStart);
      rows = rows.filter(p => {
        // A project counts toward a year if it is in service at any point in it.
        const from = p.start_date ?? p.completion_date;
        if (!from) return false;
        const ends = p.completion_date && p.status === 'completed' ? p.completion_date : null;
        return from <= endDate && (!ends || ends >= startDate);
      });
    }
    return rows;
  }, [inScope, statusFilter, yearFilter, fyStart]);

  // ── Summary stats ─────────────────────────────────────────────────────────
  const totalPipeline = visible
    .filter(p => ['approved', 'in_progress'].includes(p.status))
    .reduce((s, p) => s + (p.estimated_co2e_reduction_kg_per_year ?? 0), 0);
  const totalActual = visible
    .filter(p => p.status === 'completed')
    .reduce((s, p) => s + (p.actual_co2e_reduction_kg_per_year ?? 0), 0);

  // ── CRUD helpers ──────────────────────────────────────────────────────────
  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setFormError('');
    setShowCreate(true);
  }

  function openEdit(project: Project) {
    setForm({
      name: project.name,
      description: project.description ?? '',
      category: project.category,
      status: project.status as Status,
      site_id: project.site_id ?? '',
      estimated_co2e_reduction_kg_per_year: project.estimated_co2e_reduction_kg_per_year != null
        ? String(project.estimated_co2e_reduction_kg_per_year)
        : '',
      estimated_water_reduction_gal_per_year: project.estimated_water_reduction_gal_per_year != null
        ? String(project.estimated_water_reduction_gal_per_year)
        : '',
      estimated_waste_reduction_kg_per_year: project.estimated_waste_reduction_kg_per_year != null
        ? String(project.estimated_waste_reduction_kg_per_year)
        : '',
      estimated_cost_usd: project.estimated_cost_usd != null ? String(project.estimated_cost_usd) : '',
      estimated_payback_months: project.estimated_payback_months != null
        ? String(project.estimated_payback_months)
        : '',
      start_date: project.start_date ?? '',
      completion_date: project.completion_date ?? '',
      notes: project.notes ?? '',
    });
    setFormError('');
    setEditProject(project);
  }

  async function handleSave() {
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    setFormError('');

    const payload: TablesInsert<'projects'> = {
      name: form.name.trim(),
      description: form.description || null,
      category: form.category,
      status: form.status,
      site_id: form.site_id || null,
      estimated_co2e_reduction_kg_per_year: form.estimated_co2e_reduction_kg_per_year
        ? parseFloat(form.estimated_co2e_reduction_kg_per_year)
        : null,
      estimated_water_reduction_gal_per_year: form.estimated_water_reduction_gal_per_year
        ? parseFloat(form.estimated_water_reduction_gal_per_year)
        : null,
      estimated_waste_reduction_kg_per_year: form.estimated_waste_reduction_kg_per_year
        ? parseFloat(form.estimated_waste_reduction_kg_per_year)
        : null,
      estimated_cost_usd: form.estimated_cost_usd ? parseFloat(form.estimated_cost_usd) : null,
      estimated_payback_months: form.estimated_payback_months
        ? parseInt(form.estimated_payback_months)
        : null,
      start_date: form.start_date || null,
      completion_date: form.completion_date || null,
      notes: form.notes || null,
    };

    startTransition(async () => {
      if (editProject) {
        const { data, error } = await supabase
          .from('projects')
          .update(payload)
          .eq('id', editProject.id)
          .select()
          .single();
        if (error) { setFormError(error.message); return; }
        setProjects(ps => ps.map(p => (p.id === editProject.id ? (data as Project) : p)));
        setEditProject(null);
      } else {
        const { data, error } = await supabase
          .from('projects')
          .insert(payload)
          .select()
          .single();
        if (error) { setFormError(error.message); return; }
        setProjects(ps => [data as Project, ...ps]);
        setShowCreate(false);
      }
      router.refresh();
    });
  }

  async function handleDelete() {
    if (!deleteId) return;
    // .select() so a delete RLS filtered out (a viewer, a stale row) comes back
    // as zero rows instead of a silent success that removes the card locally.
    const { data, error } = await supabase.from('projects').delete().eq('id', deleteId).select('id');
    setDeleteId(null);
    if (error || !data?.length) {
      toast(error?.message ?? 'That project could not be deleted.', 'error');
      return;
    }
    setProjects(ps => ps.filter(p => p.id !== deleteId));
    // Its supporting documents have no foreign key to cascade through, so they
    // are removed explicitly rather than left in storage, unlinked.
    const evidenceError = await releaseEvidence('project', deleteId);
    if (evidenceError) toast(evidenceError, 'error');
    router.refresh();
  }

  async function handleStatusChange(projectId: string, newStatus: Status) {
    const { data, error } = await supabase
      .from('projects')
      .update({ status: newStatus })
      .eq('id', projectId)
      .select()
      .single();
    if (error) { toast(error.message, 'error'); return; }
    if (data) setProjects(ps => ps.map(p => (p.id === projectId ? (data as Project) : p)));
    router.refresh();
  }

  const formDialog = showCreate || editProject !== null;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track emission reduction initiatives · {scopeLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('kanban')}
              title="Kanban"
              className={`p-1.5 rounded ${viewMode === 'kanban' ? 'bg-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('list')}
              title="List"
              className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </button>
          </div>
          {canEdit && (
            <Button variant="outline" onClick={() => setShowImport(true)} className="mr-2">
              <Upload size={14} className="mr-1.5 text-emerald-600" />
              Import
            </Button>
          )}
          {canEdit && (
            <Button onClick={openCreate}>
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Project
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Year</span>
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All years</SelectItem>
              {projectYears.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Status</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map(st => (
                <SelectItem key={st} value={st}>{STATUS_LABELS[st]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(yearFilter !== 'all' || statusFilter !== 'all') && (
          <button
            onClick={() => { setYearFilter('all'); setStatusFilter('all'); }}
            className="text-xs text-emerald-700 hover:underline"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          Showing {visible.length} of {projects.length} projects
        </span>
      </div>

      {orgWideCount > 0 && (
        <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-2.5 text-xs text-blue-800">
          {orgWideCount} organization-wide project{orgWideCount === 1 ? ' is' : 's are'} not shown while a
          scope is selected. They have no site, so attributing them to {scopeLabel} would overstate its pipeline.
        </div>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {STATUSES.map(s => {
          const count = visible.filter(p => p.status === s).length;
          return (
            <div key={s} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${STATUS_COLORS[s].split(' ')[1]}`}>
                {STATUS_LABELS[s]}
              </p>
              <p className="text-2xl font-bold text-gray-900">{count}</p>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Pipeline Reduction (approved + active)</p>
            <p className="text-2xl font-bold text-emerald-600">{fmtCO2e(totalPipeline)}/yr</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Actual Reduction (completed)</p>
            <p className="text-2xl font-bold text-gray-900">{fmtCO2e(totalActual)}/yr</p>
          </CardContent>
        </Card>
      </div>

      {/* Empty state */}
      {projects.length === 0 && (
        <Card>
          <CardContent className="py-20 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900 mb-1">No projects yet</p>
            <p className="text-sm text-gray-500 mb-4">Add reduction initiatives to build your project pipeline.</p>
            {canEdit && <Button onClick={openCreate}>Add first project</Button>}
          </CardContent>
        </Card>
      )}

      {/* Kanban board */}
      {projects.length > 0 && viewMode === 'kanban' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STATUSES.map(status => {
            const col = visible.filter(p => p.status === status);
            return (
              <div key={status} className="flex flex-col gap-3">
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold ${STATUS_COLORS[status]}`}>
                  <span>{STATUS_LABELS[status]}</span>
                  <span className="text-xs opacity-70">{col.length}</span>
                </div>
                {col.map(p => (
                  <KanbanCard
                    key={p.id}
                    project={p}
                    siteMap={siteMap}
                    canEdit={canEdit}
                    onEdit={() => openEdit(p)}
                    onDelete={() => setDeleteId(p.id)}
                    onStatusChange={handleStatusChange}
                    evidence={
                      <EvidenceCell
                        recordType="project"
                        recordId={p.id}
                        title={p.name}
                        organizationId={organizationId}
                        canEdit={canEdit}
                        initialCount={evidenceCounts[evidenceCountKey('project', p.id)] ?? 0}
                      />
                    }
                  />
                ))}
                {col.length === 0 && (
                  <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center text-xs text-gray-400">
                    No projects
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* List view */}
      {projects.length > 0 && viewMode === 'list' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Project</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Site</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Est. Reduction</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Est. Cost</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Payback</th>
                  <th className="px-2 py-3"><span className="sr-only">Evidence</span></th>
                  {canEdit && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {/* `visible`, not `projects`: the list must honour the same
                    scope, status and year filters as the board and the totals. */}
                {visible.map((p, i) => (
                  <tr
                    key={p.id}
                    className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${i === visible.length - 1 ? 'border-b-0' : ''}`}
                  >
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900">{p.name}</p>
                      {p.description && <p className="text-xs text-gray-400 truncate max-w-xs">{p.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 capitalize">
                      {CATEGORIES.find(c => c.value === p.category)?.label ?? p.category}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {p.site_id ? (siteMap.get(p.site_id) ?? '—') : 'All sites'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE[p.status as Status] ?? 'secondary'} className="text-xs">
                        {STATUS_LABELS[p.status as Status] ?? p.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 font-medium">
                      {p.estimated_co2e_reduction_kg_per_year != null
                        ? `${fmtCO2e(p.estimated_co2e_reduction_kg_per_year)}/yr`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {p.estimated_cost_usd != null ? `$${fmt(p.estimated_cost_usd)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {p.estimated_payback_months != null
                        ? `${p.estimated_payback_months} mo`
                        : '—'}
                    </td>
                    <td className="px-2 py-3">
                      <EvidenceCell
                        recordType="project"
                        recordId={p.id}
                        title={p.name}
                        organizationId={organizationId}
                        canEdit={canEdit}
                        initialCount={evidenceCounts[evidenceCountKey('project', p.id)] ?? 0}
                      />
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEdit(p)}
                            className="text-gray-400 hover:text-gray-600"
                            title="Edit"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setDeleteId(p.id)}
                            className="text-gray-400 hover:text-red-500"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create / Edit Dialog */}
      <ProjectImportDialog open={showImport} onClose={() => setShowImport(false)} />

      <Dialog
        open={formDialog}
        onOpenChange={open => {
          if (!open) { setShowCreate(false); setEditProject(null); }
        }}
      >
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editProject ? 'Edit Project' : 'New Project'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label required>Project Name</Label>
              <Input
                value={form.name}
                onChange={e => setField('name', e.target.value)}
                placeholder="e.g. LED lighting retrofit — Plant A"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={e => setField('description', e.target.value)}
                placeholder="Brief description"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label required>Category</Label>
                <Select value={form.category} onValueChange={v => setField('category', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label required>Status</Label>
                <Select value={form.status} onValueChange={v => setField('status', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Site</Label>
              <Select value={form.site_id || 'all'} onValueChange={v => setField('site_id', v === 'all' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="All sites" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sites</SelectItem>
                  {sites.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Annualised savings. A project may deliver against more than one
                metric; each fills its own pipeline independently. */}
            <div>
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                Estimated annual savings
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>CO₂e (kg/yr)</Label>
                  <Input
                    type="number"
                    value={form.estimated_co2e_reduction_kg_per_year}
                    onChange={e => setField('estimated_co2e_reduction_kg_per_year', e.target.value)}
                    placeholder="e.g. 50000"
                  />
                </div>
                <div>
                  <Label>Water (gal/yr)</Label>
                  <Input
                    type="number"
                    value={form.estimated_water_reduction_gal_per_year}
                    onChange={e => setField('estimated_water_reduction_gal_per_year', e.target.value)}
                    placeholder="e.g. 250000"
                  />
                </div>
                <div>
                  <Label>Waste (kg/yr)</Label>
                  <Input
                    type="number"
                    value={form.estimated_waste_reduction_kg_per_year}
                    onChange={e => setField('estimated_waste_reduction_kg_per_year', e.target.value)}
                    placeholder="e.g. 12000"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                Leave a field blank where the project has no effect on that metric — a blank counts as
                zero in that pipeline, not as an unknown.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Est. Cost (USD)</Label>
                <Input
                  type="number"
                  value={form.estimated_cost_usd}
                  onChange={e => setField('estimated_cost_usd', e.target.value)}
                  placeholder="e.g. 120000"
                />
              </div>
              <div>
                <Label>Est. Payback (months)</Label>
                <Input
                  type="number"
                  value={form.estimated_payback_months}
                  onChange={e => setField('estimated_payback_months', e.target.value)}
                  placeholder="e.g. 36"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={e => setField('start_date', e.target.value)}
                />
              </div>
              <div>
                <Label>Completion Date</Label>
                <Input
                  type="date"
                  value={form.completion_date}
                  onChange={e => setField('completion_date', e.target.value)}
                />
              </div>
            </div>
            {/* Estimated savings preview */}
            {form.estimated_co2e_reduction_kg_per_year && form.estimated_cost_usd && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
                <p className="font-medium">Estimated impact</p>
                <p>
                  {fmtCO2e(parseFloat(form.estimated_co2e_reduction_kg_per_year))}/yr saved
                  {' · '}
                  ${fmt(parseFloat(form.estimated_cost_usd))} investment
                  {form.estimated_payback_months && ` · ${form.estimated_payback_months} month payback`}
                </p>
              </div>
            )}
            {formError && <p className="text-sm text-red-600">{formError}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShowCreate(false); setEditProject(null); }}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? 'Saving…' : editProject ? 'Save Changes' : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteId}
        title="Delete project?"
        description="This will permanently remove the project and cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

// ─── Kanban Card ──────────────────────────────────────────────────────────────

function KanbanCard({
  project,
  siteMap,
  canEdit,
  onEdit,
  onDelete,
  onStatusChange,
  evidence,
}: {
  project: Project;
  siteMap: Map<string, string>;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (id: string, status: Status) => void;
  /** The paperclip — shown to every role, since reading evidence is not editing. */
  evidence: React.ReactNode;
}) {
  const STATUSES: Status[] = ['idea', 'approved', 'in_progress', 'completed'];
  const curIdx = STATUSES.indexOf(project.status as Status);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="font-medium text-gray-900 text-sm leading-snug">{project.name}</p>
        <div className="flex items-start gap-1 shrink-0">
        {evidence}
        {canEdit && (
          <div className="flex gap-1 shrink-0">
            <button onClick={onEdit} className="text-gray-400 hover:text-gray-600 p-0.5" title="Edit">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button onClick={onDelete} className="text-gray-400 hover:text-red-500 p-0.5" title="Delete">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
        </div>
      </div>

      {project.description && (
        <p className="text-xs text-gray-400 mb-2 line-clamp-2">{project.description}</p>
      )}

      <div className="space-y-1 text-xs text-gray-500 mb-3">
        <p className="capitalize">{CATEGORIES.find(c => c.value === project.category)?.label ?? project.category}</p>
        {project.site_id && <p>{siteMap.get(project.site_id) ?? '—'}</p>}
        {project.estimated_co2e_reduction_kg_per_year != null && (
          <p className="font-medium text-emerald-600">
            {fmtCO2e(project.estimated_co2e_reduction_kg_per_year)}/yr
          </p>
        )}
        {project.estimated_cost_usd != null && (
          <p>${fmt(project.estimated_cost_usd)}</p>
        )}
      </div>

      {/* Move left/right */}
      {canEdit && (
        <div className="flex gap-1">
          {curIdx > 0 && (
            <button
              onClick={() => onStatusChange(project.id, STATUSES[curIdx - 1])}
              className="flex-1 text-xs py-1 px-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
            >
              ← {STATUS_LABELS[STATUSES[curIdx - 1]]}
            </button>
          )}
          {curIdx < STATUSES.length - 1 && (
            <button
              onClick={() => onStatusChange(project.id, STATUSES[curIdx + 1])}
              className="flex-1 text-xs py-1 px-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
            >
              {STATUS_LABELS[STATUSES[curIdx + 1]]} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
