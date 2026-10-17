'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toTitleCase } from '@/lib/utils';
import { buildUnitTree, flattenUnitTree } from '@/lib/scope-filter-core';
import { WATER_SOURCES, WASTEWATER_DISCHARGES, GENERATOR_FUELS } from '@/lib/site-equipment';
import { Plus, Edit2, Archive, Building2, Users, Info, Layers, Boxes, Cpu, MapPin, Scale, Upload } from 'lucide-react';
import { SiteImportDialog } from './SiteImportDialog';
import { EvidenceCell } from '@/components/evidence/EvidencePanel';
import { evidenceCountKey } from '@/lib/evidence-core';
import { BusinessUnitsPanel, SiteGroupsPanel } from './StructurePanels';
import { SiteEquipmentPanel } from './SiteEquipmentPanel';
import { BoundaryPanel } from './BoundaryPanel';
import type { ConsolidationApproach } from '@/lib/consolidation-core';
import type { BusinessMetricDefinition } from '@/lib/business-metrics-core';
import type { Organization, Site, AppUser, BusinessUnit, SiteGroup } from '@/lib/supabase/types';

const INDUSTRIES = [
  'Manufacturing', 'Technology', 'Retail & Consumer Goods', 'Transportation & Logistics',
  'Energy & Utilities', 'Healthcare', 'Financial Services', 'Construction & Real Estate',
  'Food & Beverage', 'Agriculture', 'Chemicals', 'Other',
];

const SITE_TYPES = [
  { value: 'office',        label: 'Office' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'warehouse',     label: 'Warehouse' },
  { value: 'data_center',   label: 'Data Center' },
  { value: 'other',         label: 'Other' },
];

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const TAB_VALUES = ['org', 'sites', 'units', 'groups', 'team', 'boundary'] as const;

interface Props {
  userProfile: AppUser | null;
  organization: Organization | null;
  sites: Site[];
  teamMembers: AppUser[];
  currentUserId: string;
  businessUnits: BusinessUnit[];
  siteGroups: SiteGroup[];
  groupMembers: { group_id: string; site_id: string }[];
  refrigerants: { refrigerant_code: string; refrigerant_name: string }[];
  denominators: BusinessMetricDefinition[];
  /** Active organization, for evidence uploads; null if the profile lookup failed. */
  evidenceOrganizationId: string | null;
  siteEvidenceCounts: Record<string, number>;
}

type MemberRole = 'admin' | 'editor' | 'viewer' | 'auditor';

export function SettingsClient({
  userProfile, organization, sites: initialSites, teamMembers: initialTeam, currentUserId,
  businessUnits, siteGroups, groupMembers, refrigerants, denominators,
  evidenceOrganizationId, siteEvidenceCounts,
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The active tab lives in the URL so other parts of the app can link straight
  // to a panel — the sidebar's scope picker deep-links to Sites this way.
  const tabParam = searchParams.get('tab');
  const activeTab = (TAB_VALUES as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as string)
    : 'org';

  function selectTab(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'org') params.delete('tab');
    else params.set('tab', value);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // ── Org form state ───────────────────────────────────────────────────────
  const [orgName, setOrgName]         = useState(organization?.name ?? '');
  const [industry, setIndustry]       = useState(organization?.industry ?? '');
  const [hqCountry, setHqCountry]     = useState(organization?.hq_country ?? 'USA');
  const [fyStart, setFyStart]         = useState(String(organization?.reporting_year_start ?? 1));
  const [baseYear, setBaseYear]       = useState(String(organization?.base_year ?? ''));
  const [orgSaving, setOrgSaving]     = useState(false);
  const [orgSaved, setOrgSaved]       = useState(false);

  // ── Sites state ──────────────────────────────────────────────────────────
  const [sites, setSites]             = useState<Site[]>(initialSites);
  const [siteDrawerOpen, setSiteDrawerOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [archivingSite, setArchivingSite] = useState<Site | null>(null);
  const [showSiteImport, setShowSiteImport] = useState(false);
  const [siteSaving, setSiteSaving]   = useState(false);

  // Site form
  const [siteName, setSiteName]       = useState('');
  const [siteType, setSiteType]       = useState('office');
  const [siteAddress, setSiteAddress] = useState('');
  const [siteCity, setSiteCity]       = useState('');
  const [siteState, setSiteState]     = useState('');
  const [siteZip, setSiteZip]         = useState('');
  const [siteCountry, setSiteCountry] = useState('USA');
  const [siteArea, setSiteArea]       = useState('');
  const [siteUnit, setSiteUnit]       = useState('');
  const [siteErrors, setSiteErrors]   = useState<Record<string, string>>({});

  // Sustainability profile. Every field is tri-state where it can be: '' means
  // "not recorded", which is not the same answer as "no".
  const [siteWaterSource, setSiteWaterSource]   = useState('');
  const [siteWaterNotes, setSiteWaterNotes]     = useState('');
  const [siteWastewater, setSiteWastewater]     = useState('');
  const [siteUsesGas, setSiteUsesGas]           = useState('');
  const [siteGasUtility, setSiteGasUtility]     = useState('');
  const [siteElecUtility, setSiteElecUtility]   = useState('');
  const [siteEmployees, setSiteEmployees]       = useState('');
  const [siteHours, setSiteHours]               = useState('');
  const [siteHasGensets, setSiteHasGensets]     = useState('');
  const [siteGensetCount, setSiteGensetCount]   = useState('');
  const [siteGensetFuel, setSiteGensetFuel]     = useState('');
  const [siteGensetKw, setSiteGensetKw]         = useState('');

  // Which section of the site drawer is showing. Equipment is only reachable
  // for a saved site, since equipment rows need a site_id to hang off.
  const [siteDrawerTab, setSiteDrawerTab] = useState<'details' | 'profile' | 'equipment'>('details');

  // ── Team state ───────────────────────────────────────────────────────────
  const [team, setTeam]               = useState<AppUser[]>(initialTeam);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState<Exclude<MemberRole, 'admin'>>('editor');
  const [teamError, setTeamError]     = useState('');
  const [siteListError, setSiteListError] = useState('');
  const [inviting, setInviting]       = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  const isAdmin = userProfile?.role === 'admin';

  // Indented business-unit options for the site form.
  const unitOptions = flattenUnitTree(buildUnitTree(businessUnits));

  // ─── Org save ─────────────────────────────────────────────────────────────
  async function saveOrg() {
    setOrgSaving(true);
    await supabase.from('organizations').update({
      name: orgName,
      industry: industry || null,
      hq_country: hqCountry,
      reporting_year_start: Number(fyStart),
      base_year: baseYear ? Number(baseYear) : null,
    }).eq('id', organization!.id);
    setOrgSaving(false);
    setOrgSaved(true);
    setTimeout(() => setOrgSaved(false), 2500);
  }

  // ─── Site drawer helpers ──────────────────────────────────────────────────
  /** Number → form string, keeping null distinct from 0. */
  const numStr = (v: number | null | undefined) => (v == null ? '' : String(v));
  /** Boolean → tri-state select value: '' = not recorded. */
  const boolStr = (v: boolean | null | undefined) => (v == null ? '' : v ? 'yes' : 'no');

  function openNewSite() {
    setEditingSite(null);
    setSiteName(''); setSiteType('office'); setSiteAddress('');
    setSiteCity(''); setSiteState(''); setSiteZip('');
    setSiteCountry('USA'); setSiteArea(''); setSiteUnit('');
    setSiteWaterSource(''); setSiteWaterNotes(''); setSiteWastewater('');
    setSiteUsesGas(''); setSiteGasUtility(''); setSiteElecUtility('');
    setSiteEmployees(''); setSiteHours('');
    setSiteHasGensets(''); setSiteGensetCount(''); setSiteGensetFuel(''); setSiteGensetKw('');
    setSiteErrors({});
    setSiteDrawerTab('details');
    setSiteDrawerOpen(true);
  }

  function openEditSite(site: Site) {
    setEditingSite(site);
    setSiteName(site.name); setSiteType(site.site_type);
    setSiteAddress(site.address ?? ''); setSiteCity(site.city ?? '');
    setSiteState(site.state ?? ''); setSiteZip(site.zip_code ?? '');
    setSiteCountry(site.country); setSiteArea(String(site.floor_area_sqft ?? ''));
    setSiteUnit(site.business_unit_id ?? '');
    setSiteWaterSource(site.water_source ?? '');
    setSiteWaterNotes(site.water_source_notes ?? '');
    setSiteWastewater(site.wastewater_discharge ?? '');
    setSiteUsesGas(boolStr(site.uses_natural_gas));
    setSiteGasUtility(site.natural_gas_utility ?? '');
    setSiteElecUtility(site.electric_utility ?? '');
    setSiteEmployees(numStr(site.employee_count));
    setSiteHours(numStr(site.operating_hours_per_week));
    setSiteHasGensets(boolStr(site.has_backup_generators));
    setSiteGensetCount(numStr(site.backup_generator_count));
    setSiteGensetFuel(site.backup_generator_fuel ?? '');
    setSiteGensetKw(numStr(site.backup_generator_kw));
    setSiteErrors({});
    setSiteDrawerTab('details');
    setSiteDrawerOpen(true);
  }

  function validateSite() {
    const e: Record<string, string> = {};
    if (!siteName.trim()) e.siteName = 'Site name is required.';
    setSiteErrors(e);
    return Object.keys(e).length === 0;
  }

  async function saveSite() {
    if (!validateSite()) return;
    setSiteSaving(true);

    // '' stores as NULL, never as 0 or FALSE: an unanswered profile question
    // must not read as an asserted "none".
    const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));
    const boolOrNull = (v: string) => (v === '' ? null : v === 'yes');

    const payload = {
      name: siteName,
      site_type: siteType as Site['site_type'],
      address: siteAddress || null,
      city: siteCity || null,
      state: siteState || null,
      zip_code: siteZip || null,
      country: siteCountry,
      floor_area_sqft: siteArea ? Number(siteArea) : null,
      business_unit_id: siteUnit || null,
      organization_id: organization!.id,

      water_source: siteWaterSource || null,
      water_source_notes: siteWaterNotes || null,
      wastewater_discharge: siteWastewater || null,
      uses_natural_gas: boolOrNull(siteUsesGas),
      natural_gas_utility: siteGasUtility || null,
      electric_utility: siteElecUtility || null,
      employee_count: numOrNull(siteEmployees),
      operating_hours_per_week: numOrNull(siteHours),
      has_backup_generators: boolOrNull(siteHasGensets),
      backup_generator_count: numOrNull(siteGensetCount),
      backup_generator_fuel: siteGensetFuel || null,
      backup_generator_kw: numOrNull(siteGensetKw),
    };

    if (editingSite) {
      const { data } = await supabase.from('sites').update(payload).eq('id', editingSite.id).select().single();
      if (data) setSites((prev) => prev.map((s) => s.id === data.id ? data : s));
    } else {
      const { data } = await supabase.from('sites').insert(payload).select().single();
      if (data) setSites((prev) => [...prev, data]);
    }

    setSiteSaving(false);
    setSiteDrawerOpen(false);
  }

  async function archiveSite() {
    if (!archivingSite) return;
    setSiteListError('');
    const { data, error } = await supabase
      .from('sites').update({ is_active: false }).eq('id', archivingSite.id).select('id');
    const target = archivingSite;
    setArchivingSite(null);
    if (error || !data?.length) {
      setSiteListError(error?.message ?? `${target.name} could not be archived.`);
      return;
    }
    setSites((prev) => prev.map((s) => s.id === target.id ? { ...s, is_active: false } : s));
  }

  // ─── Unlinked evidence ────────────────────────────────────────────────────
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState('');

  async function sweepOrphans() {
    setSweeping(true); setSweepResult('');
    try {
      const res = await fetch('/api/evidence/orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sweep: true }),
      });
      const body = await res.json();
      if (!res.ok) { setSweepResult(body.error ?? 'The check failed.'); return; }
      setSweepResult(body.orphansFound === 0
        ? 'Nothing to remove — every document is linked to a record.'
        : `Removed ${body.rowsRemoved} unlinked document${body.rowsRemoved === 1 ? '' : 's'}.`);
    } catch {
      setSweepResult('The check failed.');
    } finally {
      setSweeping(false);
    }
  }

  // ─── Team invite ──────────────────────────────────────────────────────────
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(''); setInviteSuccess(''); setInviting(true);

    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });

    const body = await res.json();
    if (!res.ok) {
      setInviteError(body.error ?? 'Failed to send invite.');
    } else {
      setInviteSuccess(`Invitation sent to ${inviteEmail}.`);
      setInviteEmail('');
    }
    setInviting(false);
  }

  // Both of these are refused by the database in cases the UI cannot fully
  // anticipate (migration 032/037 guards), so the result is checked rather than
  // assumed — otherwise the screen shows a change that did not happen.
  async function updateMemberRole(userId: string, role: MemberRole) {
    setTeamError('');
    const { data, error } = await supabase.from('users').update({ role }).eq('id', userId).select('id');
    if (error || !data?.length) {
      setTeamError(error?.message ?? 'That role change was not applied.');
      return;
    }
    setTeam((prev) => prev.map((u) => u.id === userId ? { ...u, role } : u));
  }

  /**
   * Deactivation removes access, not just a label: since migration 037 an
   * inactive profile resolves to no organization, so every RLS policy refuses
   * it. The row is kept so their entries still name who made them.
   */
  async function setMemberActive(userId: string, isActive: boolean) {
    setTeamError('');
    const { data, error } = await supabase
      .from('users').update({ is_active: isActive }).eq('id', userId).select('id');
    if (error || !data?.length) {
      setTeamError(error?.message ?? 'That change was not applied.');
      return;
    }
    setTeam((prev) => prev.map((u) => u.id === userId ? { ...u, is_active: isActive } : u));
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your organization, sites, and team.</p>
      </div>

      <Tabs value={activeTab} onValueChange={selectTab}>
        <TabsList>
          <TabsTrigger value="org"><Info size={13} className="mr-1.5" />Organization</TabsTrigger>
          <TabsTrigger value="sites"><Building2 size={13} className="mr-1.5" />Sites</TabsTrigger>
          <TabsTrigger value="units"><Layers size={13} className="mr-1.5" />Business Units</TabsTrigger>
          <TabsTrigger value="groups"><Boxes size={13} className="mr-1.5" />Site Groups</TabsTrigger>
          <TabsTrigger value="boundary"><Scale size={13} className="mr-1.5" />Boundary</TabsTrigger>
          <TabsTrigger value="team"><Users size={13} className="mr-1.5" />Team</TabsTrigger>
        </TabsList>

        {/* ── Organization ─────────────────────────────────────────────── */}
        <TabsContent value="org">
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Organization Profile</h2>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <Label required>Organization name</Label>
                <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} disabled={!isAdmin} />
              </div>
              <div>
                <Label>Industry</Label>
                <Select value={industry} onValueChange={setIndustry} disabled={!isAdmin}>
                  <SelectTrigger><SelectValue placeholder="Select industry…" /></SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Headquarters country</Label>
                <Input value={hqCountry} onChange={(e) => setHqCountry(e.target.value)} disabled={!isAdmin} />
              </div>
              <div>
                <Label>Fiscal year start month</Label>
                <Select value={fyStart} onValueChange={setFyStart} disabled={!isAdmin}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Base year for goals</Label>
                <Input
                  type="number"
                  placeholder="e.g. 2022"
                  value={baseYear}
                  onChange={(e) => setBaseYear(e.target.value)}
                  disabled={!isAdmin}
                />
                <p className="text-xs text-gray-400 mt-1">Used as the baseline for reduction goal calculations.</p>
              </div>
            </div>

            <div className="pt-2 border-t border-gray-100 flex items-center gap-3">
              <Button onClick={saveOrg} disabled={orgSaving || !isAdmin}>
                {orgSaving ? 'Saving…' : 'Save changes'}
              </Button>
              {orgSaved && <span className="text-sm text-emerald-600 font-medium">Saved ✓</span>}
              {!isAdmin && (
                <p className="text-xs text-gray-400">Only admins can edit organization settings.</p>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-2">Emission Factor Versions</p>
              <div className="flex gap-4 text-xs text-gray-600">
                <span className="bg-gray-50 border border-gray-200 rounded px-2 py-1">Scope 1: EPA 2024</span>
                <span className="bg-gray-50 border border-gray-200 rounded px-2 py-1">Scope 2: eGRID 2023</span>
                <span className="bg-gray-50 border border-gray-200 rounded px-2 py-1">Refrigerants: IPCC AR6</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">Factors are pinned per season for auditability and updated on annual releases.</p>
            </div>

            {isAdmin && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-500 mb-1">Unlinked supporting documents</p>
                <p className="text-xs text-gray-400 mb-2">
                  Removes documents whose record was deleted — for example by a delete made
                  directly in the database. Each removal is kept in the audit log.
                </p>
                <div className="flex items-center gap-3">
                  <Button size="sm" variant="outline" disabled={sweeping} onClick={sweepOrphans}>
                    {sweeping ? 'Checking…' : 'Remove unlinked documents'}
                  </Button>
                  {sweepResult && <span className="text-xs text-gray-600">{sweepResult}</span>}
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Reporting boundary ───────────────────────────────────────── */}
        <TabsContent value="boundary">
          <BoundaryPanel
            approach={(organization?.consolidation_approach ?? 'operational_control') as ConsolidationApproach}
            intensityMetricKey={organization?.intensity_metric_key ?? null}
            denominators={denominators}
            sites={initialSites.map((s2) => ({
              id: s2.id,
              name: s2.name,
              ownership_percent: s2.ownership_percent ?? 100,
              is_controlled: s2.is_controlled ?? true,
            }))}
            isAdmin={isAdmin}
          />
        </TabsContent>

        {/* ── Sites ────────────────────────────────────────────────────── */}
        <TabsContent value="sites">
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Sites</h2>
              {isAdmin && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowSiteImport(true)}>
                    <Upload size={14} className="mr-1.5 text-emerald-600" />
                    Import sites
                  </Button>
                  <Button size="sm" onClick={openNewSite}>
                    <Plus size={14} />Add site
                  </Button>
                </div>
              )}
            </div>

            {sites.length === 0 ? (
              <div className="py-16 text-center">
                <Building2 size={32} className="mx-auto text-gray-300 mb-3" />
                <p className="text-sm font-medium text-gray-700 mb-1">No sites yet</p>
                <p className="text-xs text-gray-400 mb-4">Add your first location to start logging emissions data.</p>
                {isAdmin && <Button size="sm" onClick={openNewSite}><Plus size={14} />Add your first site</Button>}
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {siteListError && <p className="px-6 py-3 text-sm text-red-600">{siteListError}</p>}
                {sites.map((site) => (
                  <div key={site.id} className="px-6 py-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{site.name}</span>
                        {!site.is_active && <Badge variant="secondary">Archived</Badge>}
                        <Badge variant="outline">{toTitleCase(site.site_type)}</Badge>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {[site.city, site.state, site.zip_code, site.country].filter(Boolean).join(', ')}
                        {site.floor_area_sqft && ` · ${site.floor_area_sqft.toLocaleString()} sqft`}
                        {site.employee_count != null && ` · ${site.employee_count.toLocaleString()} employees`}
                      </p>
                      {/* Profile facts worth seeing without opening the drawer:
                          they change what data is expected from this site. */}
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {site.water_source && (
                          <Badge variant="secondary" className="text-[10px]">
                            Water: {WATER_SOURCES.find((w) => w.value === site.water_source)?.label ?? site.water_source}
                          </Badge>
                        )}
                        {site.uses_natural_gas === true && (
                          <Badge variant="secondary" className="text-[10px]">Natural gas</Badge>
                        )}
                        {site.has_backup_generators === true && (
                          <Badge variant="secondary" className="text-[10px]">
                            {site.backup_generator_count ? `${site.backup_generator_count} ` : ''}backup generator
                            {site.backup_generator_count === 1 ? '' : 's'}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {/* Ownership share, floor area and ZIP all change reported
                        figures, so the deed, lease or JV agreement belongs here. */}
                    <EvidenceCell
                      recordType="site"
                      recordId={site.id}
                      title={site.name}
                      organizationId={evidenceOrganizationId}
                      canEdit={userProfile?.role === 'admin' || userProfile?.role === 'editor'}
                      initialCount={siteEvidenceCounts[evidenceCountKey('site', site.id)] ?? 0}
                    />
                    {isAdmin && site.is_active && (
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => openEditSite(site)}>
                          <Edit2 size={13} />Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setArchivingSite(site)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50">
                          <Archive size={13} />Archive
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Site drawer */}
          <Dialog open={siteDrawerOpen} onOpenChange={setSiteDrawerOpen}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <SiteImportDialog open={showSiteImport} onClose={() => setShowSiteImport(false)} />

              <DialogHeader>
                <DialogTitle>{editingSite ? `Edit ${editingSite.name}` : 'Add site'}</DialogTitle>
              </DialogHeader>

              {/* Section switcher. Equipment needs a saved site to attach to, so
                  it is offered only when editing an existing one. */}
              <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 mt-2 self-start">
                {([
                  { id: 'details',   label: 'Location',     icon: MapPin },
                  { id: 'profile',   label: 'Sustainability profile', icon: Info },
                  ...(editingSite ? [{ id: 'equipment' as const, label: 'Equipment', icon: Cpu }] : []),
                ] as const).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSiteDrawerTab(id)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      siteDrawerTab === id
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Icon size={12} />{label}
                  </button>
                ))}
              </div>

              <div className={siteDrawerTab === 'details' ? 'space-y-4 mt-2' : 'hidden'}>
                <div>
                  <Label required>Site name</Label>
                  <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} error={siteErrors.siteName} placeholder="e.g. Chicago Manufacturing Plant" />
                </div>
                <div>
                  <Label required>Site type</Label>
                  <Select value={siteType} onValueChange={setSiteType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SITE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Street address</Label>
                  <Input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} placeholder="123 Main St" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>City</Label>
                    <Input value={siteCity} onChange={(e) => setSiteCity(e.target.value)} />
                  </div>
                  <div>
                    <Label>State</Label>
                    <Input value={siteState} onChange={(e) => setSiteState(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>ZIP / Postal code</Label>
                    <Input value={siteZip} onChange={(e) => setSiteZip(e.target.value)} placeholder="Used for eGRID lookup" />
                  </div>
                  <div>
                    <Label>Country</Label>
                    <Input value={siteCountry} onChange={(e) => setSiteCountry(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Floor area (sqft)</Label>
                    <Input type="number" value={siteArea} onChange={(e) => setSiteArea(e.target.value)} placeholder="Used for intensity KPIs" />
                  </div>
                  <div>
                    <Label>Business unit</Label>
                    <Select value={siteUnit} onValueChange={(v) => setSiteUnit(v === '__none__' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Unassigned</SelectItem>
                        {unitOptions.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {' '.repeat(u.depth * 3)}{u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-400 mt-1">
                      Drives business-unit roll-ups. Unassigned sites are excluded from them.
                    </p>
                  </div>
                </div>
              </div>

              {/* ── Sustainability profile ──────────────────────────────── */}
              <div className={siteDrawerTab === 'profile' ? 'space-y-5 mt-2' : 'hidden'}>
                <p className="text-xs text-gray-500">
                  Every field here is optional and blank means <strong>not recorded</strong> — which is a
                  different answer from &ldquo;no&rdquo;. Data review reads these to tell an
                  unanswered question apart from an asserted absence.
                </p>

                {/* Water */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Water</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Water source</Label>
                      <Select value={siteWaterSource || '__none__'} onValueChange={(v) => setSiteWaterSource(v === '__none__' ? '' : v)}>
                        <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Not recorded</SelectItem>
                          {WATER_SOURCES.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-gray-400 mt-1">
                        Reported as withdrawal by source under CDP Water, ESRS E3 and GRI 303.
                      </p>
                    </div>
                    <div>
                      <Label>Wastewater discharge</Label>
                      <Select value={siteWastewater || '__none__'} onValueChange={(v) => setSiteWastewater(v === '__none__' ? '' : v)}>
                        <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Not recorded</SelectItem>
                          {WASTEWATER_DISCHARGES.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Water source notes</Label>
                    <Textarea
                      rows={2}
                      value={siteWaterNotes}
                      onChange={(e) => setSiteWaterNotes(e.target.value)}
                      placeholder="e.g. 70% municipal, 30% from two on-site wells under permit WR-4471"
                    />
                  </div>
                </div>

                {/* Energy */}
                <div className="space-y-3 pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Energy supply</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <Label>Burns natural gas on site?</Label>
                      <Select value={siteUsesGas || '__none__'} onValueChange={(v) => setSiteUsesGas(v === '__none__' ? '' : v)}>
                        <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Not recorded</SelectItem>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Natural gas utility</Label>
                      <Input value={siteGasUtility} onChange={(e) => setSiteGasUtility(e.target.value)} placeholder="e.g. Nicor Gas" />
                    </div>
                    <div>
                      <Label>Electric utility</Label>
                      <Input value={siteElecUtility} onChange={(e) => setSiteElecUtility(e.target.value)} placeholder="e.g. ComEd" />
                    </div>
                  </div>
                </div>

                {/* Backup power */}
                <div className="space-y-3 pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Backup power</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <Label>Backup generators?</Label>
                      <Select value={siteHasGensets || '__none__'} onValueChange={(v) => setSiteHasGensets(v === '__none__' ? '' : v)}>
                        <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Not recorded</SelectItem>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>How many</Label>
                      <Input type="number" min="0" value={siteGensetCount} onChange={(e) => setSiteGensetCount(e.target.value)} />
                    </div>
                    <div>
                      <Label>Fuel</Label>
                      <Select value={siteGensetFuel || '__none__'} onValueChange={(v) => setSiteGensetFuel(v === '__none__' ? '' : v)}>
                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">—</SelectItem>
                          {GENERATOR_FUELS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Total capacity (kW)</Label>
                      <Input type="number" value={siteGensetKw} onChange={(e) => setSiteGensetKw(e.target.value)} />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">
                    Generator fuel is Scope 1 stationary combustion. Record individual units under
                    Equipment if you need per-unit detail.
                  </p>
                </div>

                {/* Operations */}
                <div className="space-y-3 pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Operations</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Employees at this site</Label>
                      <Input type="number" min="0" value={siteEmployees} onChange={(e) => setSiteEmployees(e.target.value)} placeholder="Used for per-FTE intensity" />
                    </div>
                    <div>
                      <Label>Operating hours per week</Label>
                      <Input type="number" value={siteHours} onChange={(e) => setSiteHours(e.target.value)} placeholder="e.g. 120" />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Equipment ───────────────────────────────────────────── */}
              {/* Mounted only while its tab is showing, so opening a site to fix
                  a ZIP code does not fetch its asset register. */}
              {editingSite && siteDrawerTab === 'equipment' && (
                <div className="mt-4">
                  <SiteEquipmentPanel
                    siteId={editingSite.id}
                    siteName={editingSite.name}
                    canEdit={userProfile?.role === 'admin' || userProfile?.role === 'editor'}
                    refrigerants={refrigerants}
                  />
                </div>
              )}

              {/* Equipment saves itself row by row, so the site-level footer
                  would be misleading there. */}
              {siteDrawerTab !== 'equipment' && (
                <DialogFooter className="mt-4">
                  <Button variant="outline" onClick={() => setSiteDrawerOpen(false)}>Cancel</Button>
                  <Button onClick={saveSite} disabled={siteSaving}>
                    {siteSaving ? 'Saving…' : editingSite ? 'Save changes' : 'Add site'}
                  </Button>
                </DialogFooter>
              )}
            </DialogContent>
          </Dialog>

          <ConfirmDialog
            open={!!archivingSite}
            onOpenChange={(o) => !o && setArchivingSite(null)}
            title="Archive this site?"
            description={`${archivingSite?.name} will be deactivated and hidden from new data entry. Existing data is preserved.`}
            confirmLabel="Archive site"
            onConfirm={archiveSite}
          />
        </TabsContent>

        {/* ── Team ─────────────────────────────────────────────────────── */}
        <TabsContent value="units">
          <BusinessUnitsPanel
            canEdit={userProfile?.role === 'admin' || userProfile?.role === 'editor'}
            isAdmin={userProfile?.role === 'admin'}
            sites={sites}
            businessUnits={businessUnits}
            siteGroups={siteGroups}
            groupMembers={groupMembers}
          />
        </TabsContent>

        <TabsContent value="groups">
          <SiteGroupsPanel
            canEdit={userProfile?.role === 'admin' || userProfile?.role === 'editor'}
            isAdmin={userProfile?.role === 'admin'}
            sites={sites}
            businessUnits={businessUnits}
            siteGroups={siteGroups}
            groupMembers={groupMembers}
          />
        </TabsContent>

        <TabsContent value="team">
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Team members</h2>
            </div>

            <div className="divide-y divide-gray-100">
              {team.map((member) => (
                <div key={member.id} className="px-6 py-4 flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                    {(member.first_name?.[0] ?? member.email[0]).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {[member.first_name, member.last_name].filter(Boolean).join(' ') || '(no name)'}
                      {member.id === currentUserId && <span className="ml-2 text-xs text-gray-400">(you)</span>}
                    </p>
                    <p className="text-xs text-gray-400">{member.email}</p>
                  </div>
                  {!member.is_active && <Badge variant="secondary">Inactive</Badge>}
                  {isAdmin && member.id !== currentUserId && member.is_active ? (
                    <div className="flex items-center gap-2">
                      <Select
                        value={member.role}
                        onValueChange={(v) => updateMemberRole(member.id, v as MemberRole)}
                      >
                        <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="editor">Editor</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="auditor">Auditor</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="ghost"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => setMemberActive(member.id, false)}>
                        Deactivate
                      </Button>
                    </div>
                  ) : isAdmin && member.id !== currentUserId && !member.is_active ? (
                    <Button size="sm" variant="ghost" onClick={() => setMemberActive(member.id, true)}>
                      Reactivate
                    </Button>
                  ) : (
                    <Badge variant={member.role === 'admin' ? 'default' : 'secondary'}>
                      {toTitleCase(member.role)}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
            {teamError && <p className="px-6 pb-3 text-sm text-red-600">{teamError}</p>}

            {isAdmin && (
              <div className="px-6 py-5 border-t border-gray-100">
                <p className="text-sm font-medium text-gray-900 mb-3">Invite team member</p>
                <form onSubmit={handleInvite} className="flex gap-3 items-start">
                  <div className="flex-1">
                    <Input
                      type="email"
                      placeholder="colleague@company.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      required
                      error={inviteError || undefined}
                    />
                  </div>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Exclude<MemberRole, 'admin'>)}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                      <SelectItem value="auditor">Auditor</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="submit" disabled={inviting}>
                    {inviting ? 'Sending…' : 'Send invite'}
                  </Button>
                </form>
                {inviteSuccess && <p className="text-sm text-emerald-600 mt-2">{inviteSuccess}</p>}
                <p className="text-xs text-gray-400 mt-2">
                  <strong>Editor</strong> can log and edit data. <strong>Viewer</strong> has read-only access.
                  {' '}<strong>Auditor</strong> is read-only too, for an external assurance provider.
                </p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
