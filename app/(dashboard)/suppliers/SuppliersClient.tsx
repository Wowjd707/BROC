'use client';

import { useState, useTransition, useMemo, useCallback } from 'react';
import { releaseEvidence } from '@/components/evidence/release-evidence';
import type { TablesInsert } from '@/lib/supabase/types';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { formatDate } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FileDown, Users, Upload } from 'lucide-react';
import { EvidenceCell } from '@/components/evidence/EvidencePanel';
import { evidenceCountKey } from '@/lib/evidence-core';
import { regulationLabel } from '@/lib/regulations';
import {
  describeSendFailure,
  summariseSendAttempt,
  type EmailFailure,
} from '@/lib/survey-email-core';
import {
  lastContactedAt,
  daysSince,
  pairAnswersWithQuestions,
  resolveQuestionSet,
  type SurveyQuestionRow,
} from '@/lib/survey-questions-core';
import { SurveyQuestionBuilder } from './SurveyQuestionBuilder';
import { SupplierImportDialog } from './SupplierImportDialog';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  country: string | null;
  industry: string | null;
  spend_usd: number | null;
  tier: number | null;
  notes: string | null;
  created_at: string;
}

interface Survey {
  id: string;
  title: string;
  regulation_type: string;
  /** Set only when regulation_type is 'custom'; a CHECK in 036 enforces both ways. */
  custom_regulation_name: string | null;
  status: string;
  due_date: string | null;
  notes: string | null;
  created_at: string;
}

interface Invitation {
  id: string;
  survey_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  email: string | null;
  token: string;
  status: string;
  sent_at: string | null;
  last_reminded_at: string | null;
  reminder_count: number | null;
  submitted_at: string | null;
}

interface Props {
  initialSuppliers: Supplier[];
  initialSurveys: Survey[];
  initialInvitations: Invitation[];
  /** Submitted answers, keyed by invitation id then question key. */
  initialAnswers: Record<string, Record<string, string | null>>;
  /** Bespoke question rows, keyed by survey id. */
  initialCustomQuestions: Record<string, SurveyQuestionRow[]>;
  userRole: string;
  organizationId: string | null;
  evidenceCounts: Record<string, number>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SURVEY_STATUS_BADGE: Record<string, 'default' | 'secondary' | 'warning' | 'destructive' | 'blue'> = {
  draft: 'secondary',
  active: 'default',
  closed: 'blue',
};

const INVITATION_STATUS_BADGE: Record<string, 'default' | 'secondary' | 'warning'> = {
  pending: 'secondary',
  sent: 'warning',
  submitted: 'default',
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function SuppliersClient({
  initialSuppliers,
  initialSurveys,
  initialInvitations,
  initialAnswers,
  initialCustomQuestions,
  userRole,
  organizationId,
  evidenceCounts,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const canEdit = userRole === 'admin' || userRole === 'editor';

  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers);
  const [surveys, setSurveys] = useState<Survey[]>(initialSurveys);
  const [invitations, setInvitations] = useState<Invitation[]>(initialInvitations);

  // Supplier form state
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [showSupplierImport, setShowSupplierImport] = useState(false);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    name: '', contact_name: '', contact_email: '', country: '', industry: '', spend_usd: '', tier: '1', notes: '',
  });
  const [supplierError, setSupplierError] = useState('');

  // Survey form state
  const [showSurveyForm, setShowSurveyForm] = useState(false);
  const [surveyForm, setSurveyForm] = useState({ title: '', regulation_type: 'cbam', custom_regulation_name: '', due_date: '', notes: '' });
  const [surveyError, setSurveyError] = useState('');

  // Invite form state
  const [activeSurvey, setActiveSurvey] = useState<Survey | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSupplier, setInviteSupplier] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteNotice, setInviteNotice] = useState('');
  const [reminderError, setReminderError] = useState('');
  const [reminderNotice, setReminderNotice] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);

  // Bulk invite. Selection is held by supplier id rather than by email so that
  // two suppliers sharing a contact address stay independently selectable.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);

  // Questionnaire builder / response viewer
  const [buildingSurvey, setBuildingSurvey] = useState<Survey | null>(null);
  const [viewingResponses, setViewingResponses] = useState<Invitation | null>(null);

  // Counts the builder has changed since the last server render. Read as an
  // override on top of the props so a refresh cannot be undone by stale state.
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({});

  // Stable identity matters: the builder lists this in the dependencies of the
  // effect that loads its questions, and a new function each render would make
  // that effect re-fire forever.
  const handleQuestionCountChange = useCallback((surveyId: string, count: number) => {
    setQuestionCounts(prev => (prev[surveyId] === count ? prev : { ...prev, [surveyId]: count }));
  }, []);

  function questionCount(surveyId: string): number {
    return questionCounts[surveyId] ?? initialCustomQuestions[surveyId]?.length ?? 0;
  }

  // Delete states
  const [deleteSupplierID, setDeleteSupplierID] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();

  // ── Supplier CRUD ─────────────────────────────────────────────────────────

  function openCreateSupplier() {
    setSupplierForm({ name: '', contact_name: '', contact_email: '', country: '', industry: '', spend_usd: '', tier: '1', notes: '' });
    setSupplierError('');
    setEditSupplier(null);
    setShowSupplierForm(true);
  }

  function openEditSupplier(s: Supplier) {
    setSupplierForm({
      name: s.name,
      contact_name: s.contact_name ?? '',
      contact_email: s.contact_email ?? '',
      country: s.country ?? '',
      industry: s.industry ?? '',
      spend_usd: s.spend_usd != null ? String(s.spend_usd) : '',
      tier: s.tier != null ? String(s.tier) : '1',
      notes: s.notes ?? '',
    });
    setSupplierError('');
    setEditSupplier(s);
    setShowSupplierForm(true);
  }

  async function handleSaveSupplier() {
    if (!supplierForm.name.trim()) { setSupplierError('Name is required'); return; }
    setSupplierError('');
    const payload: TablesInsert<'suppliers'> = {
      name: supplierForm.name.trim(),
      contact_name: supplierForm.contact_name || null,
      contact_email: supplierForm.contact_email || null,
      country: supplierForm.country || null,
      industry: supplierForm.industry || null,
      spend_usd: supplierForm.spend_usd ? parseFloat(supplierForm.spend_usd) : null,
      tier: parseInt(supplierForm.tier) || 1,
      notes: supplierForm.notes || null,
    };

    startTransition(async () => {
      if (editSupplier) {
        const { data, error } = await supabase.from('suppliers').update(payload).eq('id', editSupplier.id).select().single();
        if (error) { setSupplierError(error.message); return; }
        setSuppliers(ss => ss.map(s => s.id === editSupplier.id ? (data as Supplier) : s));
        setEditSupplier(null);
      } else {
        const { data, error } = await supabase.from('suppliers').insert(payload).select().single();
        if (error) { setSupplierError(error.message); return; }
        setSuppliers(ss => [...ss, data as Supplier].sort((a, b) => a.name.localeCompare(b.name)));
      }
      setShowSupplierForm(false);
      router.refresh();
    });
  }

  async function handleDeleteSupplier() {
    if (!deleteSupplierID) return;
    const target = deleteSupplierID;
    const { data, error } = await supabase.from('suppliers').delete().eq('id', target).select('id');
    setDeleteSupplierID(null);
    if (error || !data?.length) {
      toast(error?.message ?? 'That supplier could not be deleted.', 'error');
      return;
    }
    setSuppliers(ss => ss.filter(s => s.id !== target));
    const evidenceError = await releaseEvidence('supplier', target);
    if (evidenceError) toast(evidenceError, 'error');
  }

  // ── Survey CRUD ───────────────────────────────────────────────────────────

  async function handleCreateSurvey() {
    if (!surveyForm.title.trim()) { setSurveyError('Title is required'); return; }
    const isCustom = surveyForm.regulation_type === 'custom';
    if (isCustom && !surveyForm.custom_regulation_name.trim()) {
      setSurveyError('Name the regulation this survey is about.');
      return;
    }
    setSurveyError('');
    const payload = {
      title: surveyForm.title.trim(),
      regulation_type: surveyForm.regulation_type,
      // Null unless custom. Migration 036 refuses a named survey that is not
      // custom, because a badge showing one regulation while the question set
      // comes from another is worse than no badge.
      custom_regulation_name: isCustom ? surveyForm.custom_regulation_name.trim() : null,
      status: 'draft',
      due_date: surveyForm.due_date || null,
      notes: surveyForm.notes || null,
    };
    startTransition(async () => {
      const { data, error } = await supabase.from('supplier_surveys').insert(payload).select().single();
      if (error) { setSurveyError(error.message); return; }
      setSurveys(ss => [data as Survey, ...ss]);
      setShowSurveyForm(false);
      setSurveyForm({ title: '', regulation_type: 'cbam', custom_regulation_name: '', due_date: '', notes: '' });
      router.refresh();
    });
  }

  async function handleActivateSurvey(id: string) {
    const { data } = await supabase.from('supplier_surveys').update({ status: 'active' }).eq('id', id).select().single();
    if (data) setSurveys(ss => ss.map(s => s.id === id ? (data as Survey) : s));
  }

  async function handleCloseSurvey(id: string) {
    const { data } = await supabase.from('supplier_surveys').update({ status: 'closed' }).eq('id', id).select().single();
    if (data) setSurveys(ss => ss.map(s => s.id === id ? (data as Survey) : s));
  }

  // ── Invitations ───────────────────────────────────────────────────────────

  /**
   * Invoke the mailer and report honestly whether it worked.
   *
   * `functions.invoke` resolves with `{ error }` rather than throwing, so the
   * failure path here is a branch, not a catch. The status body carries the
   * detail worth showing — a 404 means the function was never deployed to this
   * project, which is an install step, not a bad address.
   */
  async function sendSurveyEmail(
    invitationId: string,
    type: 'invite' | 'reminder',
  ): Promise<EmailFailure | null> {
    const { error } = await supabase.functions.invoke('send-survey-email', {
      body: { invitationId, type },
    });
    if (!error) return null;

    const context = (error as { context?: unknown }).context;
    let status: number | null = null;
    let body: unknown = null;

    if (context instanceof Response) {
      status = context.status;
      try {
        body = await context.clone().json();
      } catch {
        try { body = await context.clone().text(); } catch { body = null; }
      }
    }

    return describeSendFailure(status, body, error.message || 'The email could not be sent.');
  }

  /** Re-read one invitation so the row shows what the server actually recorded. */
  async function refreshInvitation(invId: string) {
    const { data } = await supabase
      .from('supplier_survey_invitations')
      .select('*')
      .eq('id', invId)
      .single();
    if (data) setInvitations(is => is.map(i => (i.id === invId ? (data as Invitation) : i)));
  }

  async function handleSendInvite() {
    if (!inviteEmail.trim()) { setInviteError('Email is required'); return; }
    if (!activeSurvey) return;
    setInviteError('');
    setInviteNotice('');
    setSendingInvite(true);

    const selectedSupplier = inviteSupplier ? suppliers.find(s => s.id === inviteSupplier) : null;

    // Create invitation row. It is created as 'pending' and stays that way
    // until the mailer confirms a send — the status is a record of whether the
    // supplier was actually asked, so it is never set optimistically.
    const { data: inv, error } = await supabase
      .from('supplier_survey_invitations')
      .insert({
        survey_id: activeSurvey.id,
        supplier_id: inviteSupplier || null,
        supplier_name: selectedSupplier?.name ?? inviteEmail.split('@')[0],
        email: inviteEmail.trim(),
        status: 'pending',
      })
      .select()
      .single();

    if (error) { setInviteError(error.message); setSendingInvite(false); return; }

    const invitation = inv as Invitation;
    setInvitations(is => [...is, invitation]);

    const failure = await sendSurveyEmail(invitation.id, 'invite');

    if (failure) {
      // The invitation exists and holds a valid token, so the link can still be
      // copied and sent by hand. Say so — the row is not useless, it is unsent.
      setInviteError(
        `${failure.message} The invitation was created and is still pending — copy its link, or use Remind to retry.`,
      );
      setSendingInvite(false);
      router.refresh();
      return;
    }

    // The edge function wrote status and sent_at after Resend accepted it.
    await refreshInvitation(invitation.id);
    setInviteNotice(summariseSendAttempt(1, 0));
    setInviteEmail('');
    setInviteSupplier('');
    setSendingInvite(false);
    router.refresh();
  }

  /**
   * Invite several suppliers at once.
   *
   * Sends are sequential, not parallel. Three reasons, and the third is the one
   * that matters: the mailer is rate limited, a failure has to be attributable
   * to one supplier rather than to a batch, and each invitation row must exist
   * before its email is attempted so that a send failure leaves a pending
   * invitation with a usable link rather than nothing at all.
   *
   * Nothing is marked sent optimistically here either — status is the record of
   * whether the supplier was actually asked.
   */
  async function handleBulkInvite(survey: Survey, chosen: Supplier[]) {
    if (chosen.length === 0) { setInviteError('Choose at least one supplier.'); return; }
    setInviteError('');
    setInviteNotice('');
    setBulkSending(true);
    setBulkProgress({ done: 0, total: chosen.length });

    let sent = 0;
    const failures: string[] = [];

    for (const [i, supplier] of chosen.entries()) {
      const email = supplier.contact_email?.trim();
      if (!email) {
        // Filtered out of the list already; belt and braces, because an
        // invitation with no address is a row that can never be answered.
        failures.push(`${supplier.name}: no contact email`);
        setBulkProgress({ done: i + 1, total: chosen.length });
        continue;
      }

      const { data: inv, error } = await supabase
        .from('supplier_survey_invitations')
        .insert({
          survey_id: survey.id,
          supplier_id: supplier.id,
          supplier_name: supplier.name,
          email,
          status: 'pending',
        })
        .select()
        .single();

      if (error || !inv) {
        failures.push(`${supplier.name}: ${error?.message ?? 'could not be created'}`);
        setBulkProgress({ done: i + 1, total: chosen.length });
        continue;
      }

      const invitation = inv as Invitation;
      setInvitations(is => [...is, invitation]);

      const failure = await sendSurveyEmail(invitation.id, 'invite');
      if (failure) {
        failures.push(`${supplier.name}: ${failure.message}`);
      } else {
        sent++;
        await refreshInvitation(invitation.id);
      }
      setBulkProgress({ done: i + 1, total: chosen.length });
    }

    setBulkSending(false);
    setBulkProgress(null);
    setBulkSelected(new Set());
    setInviteNotice(summariseSendAttempt(sent, failures.length));
    if (failures.length > 0) {
      // Named, not counted. "3 not sent" gives nobody anything to act on, and
      // the rows that failed still hold valid links that can be sent by hand.
      setInviteError(
        `Still pending — copy their links or use Remind: ${failures.slice(0, 5).join('; ')}` +
        (failures.length > 5 ? `; and ${failures.length - 5} more` : ''),
      );
    }
    router.refresh();
  }

  async function handleSendReminder(invId: string) {
    setSendingReminder(invId);
    setReminderError('');
    setReminderNotice('');

    const failure = await sendSurveyEmail(invId, 'reminder');

    if (failure) {
      setReminderError(failure.message);
    } else {
      await refreshInvitation(invId);
      setReminderNotice('Reminder sent.');
      router.refresh();
    }
    setSendingReminder(null);
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  function invitationsForSurvey(surveyId: string) {
    return invitations.filter(i => i.survey_id === surveyId);
  }

  /**
   * "Last contacted" in prose. An invitation whose email never went out reports
   * as never contacted rather than as a date, because the row existing is not
   * evidence the supplier was asked.
   */
  function contactSummary(inv: Invitation): string {
    const contact = lastContactedAt(inv);
    if (!contact) return 'Never contacted — no email has been sent.';

    const days = daysSince(contact.at);
    const when =
      days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    const what = contact.kind === 'reminder' ? 'Last reminded' : 'Invited';
    const chases =
      contact.reminderCount > 0
        ? ` · ${contact.reminderCount} reminder${contact.reminderCount === 1 ? '' : 's'}`
        : '';

    return `${what} ${when} (${formatDate(contact.at)})${chases}`;
  }

  /** The question set a submitted response should be read against. */
  function questionSetForSurvey(survey: Survey) {
    return resolveQuestionSet(survey, initialCustomQuestions[survey.id] ?? []);
  }

  function responseRate(surveyId: string): string {
    const inv = invitationsForSurvey(surveyId);
    if (inv.length === 0) return '—';
    const submitted = inv.filter(i => i.status === 'submitted').length;
    return `${submitted}/${inv.length} (${Math.round((submitted / inv.length) * 100)}%)`;
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your supplier relationships and disclosure surveys</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Responses are exportable in full from Reports; this is the way through. */}
          <Link href="/reports">
            <Button variant="outline" size="sm" className="flex items-center gap-1.5">
              <FileDown className="w-4 h-4" />
              Response reports
            </Button>
          </Link>
          <Link href="/suppliers/cbam">
            <Button variant="secondary" size="sm" className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              CBAM Calculator
            </Button>
          </Link>
        </div>
      </div>

      <Tabs defaultValue="suppliers">
        <TabsList className="mb-4">
          <TabsTrigger value="suppliers">Suppliers ({suppliers.length})</TabsTrigger>
          <TabsTrigger value="surveys">Surveys ({surveys.length})</TabsTrigger>
        </TabsList>

        {/* ── Suppliers Tab ── */}
        <TabsContent value="suppliers">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
            <p className="text-sm text-gray-500">{suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}</p>
            {canEdit && (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => setShowSupplierImport(true)}>
                  <Upload size={14} className="mr-1.5 text-emerald-600" />
                  Import suppliers
                </Button>
                <Button onClick={openCreateSupplier}>
                  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Supplier
                </Button>
              </div>
            )}
          </div>

          {suppliers.length === 0 ? (
            <Card>
              <CardContent className="py-16 flex flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-gray-900 mb-1">No suppliers yet</p>
                <p className="text-sm text-gray-500 mb-4">Add your key suppliers to manage disclosures and surveys.</p>
                {canEdit && <Button onClick={openCreateSupplier}>Add first supplier</Button>}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Supplier</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Country</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tier</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Evidence</th>
                      {canEdit && <th className="px-4 py-3" />}
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((s, i) => (
                      <tr key={s.id} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${i === suppliers.length - 1 ? 'border-b-0' : ''}`}>
                        <td className="px-5 py-3">
                          <p className="font-medium text-gray-900">{s.name}</p>
                          {s.industry && <p className="text-xs text-gray-400">{s.industry}</p>}
                        </td>
                        <td className="px-4 py-3">
                          {s.contact_name && <p className="text-gray-700">{s.contact_name}</p>}
                          {s.contact_email && <p className="text-xs text-gray-400">{s.contact_email}</p>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{s.country ?? '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <Badge variant="secondary" className="text-xs">Tier {s.tier ?? 1}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {/* Certifications, audit reports, codes of conduct —
                              the documents behind a supplier's declarations. */}
                          <EvidenceCell
                            recordType="supplier"
                            recordId={s.id}
                            title={s.name}
                            organizationId={organizationId}
                            canEdit={canEdit}
                            initialCount={evidenceCounts[evidenceCountKey('supplier', s.id)] ?? 0}
                          />
                        </td>
                        {canEdit && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => openEditSupplier(s)} className="text-gray-400 hover:text-gray-600" title="Edit">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button onClick={() => setDeleteSupplierID(s.id)} className="text-gray-400 hover:text-red-500" title="Delete">
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
        </TabsContent>

        {/* ── Surveys Tab ── */}
        <TabsContent value="surveys">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
            <p className="text-sm text-gray-500">{surveys.length} survey{surveys.length !== 1 ? 's' : ''}</p>
            {canEdit && (
              <Button onClick={() => setShowSurveyForm(true)}>
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Survey
              </Button>
            )}
          </div>

          {surveys.length === 0 ? (
            <Card>
              <CardContent className="py-16 flex flex-col items-center justify-center text-center">
                <p className="text-sm font-medium text-gray-900 mb-1">No surveys yet</p>
                <p className="text-sm text-gray-500 mb-4">Create a disclosure survey to send to your suppliers.</p>
                {canEdit && <Button onClick={() => setShowSurveyForm(true)}>Create first survey</Button>}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {surveys.map(survey => {
                const invs = invitationsForSurvey(survey.id);
                const submitted = invs.filter(i => i.status === 'submitted').length;
                const sent = invs.filter(i => i.status === 'sent').length;
                const isActive = activeSurvey?.id === survey.id;

                return (
                  <Card key={survey.id} className={isActive ? 'ring-2 ring-emerald-500' : ''}>
                    <CardContent className="pt-5 pb-5">
                      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-semibold text-gray-900">{survey.title}</h3>
                            <Badge variant={SURVEY_STATUS_BADGE[survey.status] ?? 'secondary'} className="text-xs">
                              {survey.status}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {regulationLabel(survey.regulation_type, survey.custom_regulation_name)}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-500">
                            {invs.length} invited · {submitted} submitted · {sent} pending
                            {survey.due_date && ` · Due ${formatDate(survey.due_date)}`}
                          </p>
                          {/* A custom survey with no questions renders as an empty form. Say so
                              before it is sent, not after the supplier reports it broken. */}
                          {survey.regulation_type === 'custom' && questionCount(survey.id) === 0 && (
                            <p className="text-xs text-amber-700 mt-1">
                              No questions yet — suppliers opening this survey will see an empty form.
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {canEdit && survey.status === 'draft' && (
                            <Button size="sm" variant="outline" onClick={() => handleActivateSurvey(survey.id)}>
                              Activate
                            </Button>
                          )}
                          {canEdit && survey.status === 'active' && (
                            <Button size="sm" variant="outline" onClick={() => handleCloseSurvey(survey.id)}>
                              Close
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setBuildingSurvey(survey)}>
                            Questions
                            {(questionCount(survey.id)) > 0 && (
                              <span className="ml-1.5 text-gray-400">{questionCount(survey.id)}</span>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant={isActive ? 'default' : 'outline'}
                            onClick={() => setActiveSurvey(isActive ? null : survey)}
                          >
                            {isActive ? 'Hide invitations' : 'Manage invitations'}
                          </Button>
                        </div>
                      </div>

                      {/* Response rate bar */}
                      {invs.length > 0 && (
                        <div>
                          <div className="flex justify-between text-xs text-gray-500 mb-1">
                            <span>Response rate</span>
                            <span>{responseRate(survey.id)}</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div
                              className="h-1.5 rounded-full bg-emerald-500 transition-all"
                              style={{ width: `${invs.length > 0 ? (submitted / invs.length) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Invitation panel */}
                      {isActive && (
                        <div className="mt-4 border-t border-gray-100 pt-4 space-y-4">
                          {/* Send invite form */}
                          {canEdit && survey.status !== 'closed' && (
                            <div className="flex gap-2 flex-wrap items-end">
                              <div className="flex-1 min-w-[200px]">
                                <Label className="text-xs">Email</Label>
                                <Input
                                  type="email"
                                  value={inviteEmail}
                                  onChange={e => setInviteEmail(e.target.value)}
                                  placeholder="supplier@company.com"
                                  className="h-8 text-sm"
                                />
                              </div>
                              <div className="w-48">
                                <Label className="text-xs">Link to supplier (optional)</Label>
                                <Select
                                  value={inviteSupplier || 'none'}
                                  onValueChange={v => setInviteSupplier(v === 'none' ? '' : v)}
                                >
                                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="None" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    {suppliers.map(s => (
                                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <Button size="sm" onClick={handleSendInvite} disabled={sendingInvite}>
                                {sendingInvite ? 'Sending…' : 'Send invite'}
                              </Button>
                            </div>
                          )}

                          {/* Bulk invite from the supplier list */}
                          {canEdit && survey.status !== 'closed' && (() => {
                            // "Already invited" is matched on email rather than
                            // supplier id: an ad-hoc invitation typed by hand
                            // counts as having been asked even though it carries
                            // no supplier_id, and asking twice is a real cost to
                            // the relationship.
                            // email is nullable on an invitation, so drop the
                            // blanks rather than letting one become the empty
                            // string and match every supplier without an email.
                            const invitedEmails = new Set(
                              invs.flatMap(i => {
                                const e = i.email?.trim().toLowerCase();
                                return e ? [e] : [];
                              }),
                            );
                            const invitable = suppliers.filter(
                              sup => sup.contact_email?.trim()
                                && !invitedEmails.has(sup.contact_email.trim().toLowerCase()),
                            );
                            const withoutEmail = suppliers.filter(sup => !sup.contact_email?.trim());
                            const alreadyCount = suppliers.length - invitable.length - withoutEmail.length;
                            const allSelected = invitable.length > 0
                              && invitable.every(sup => bulkSelected.has(sup.id));

                            return (
                              <div className="rounded-lg border border-gray-200">
                                <button
                                  onClick={() => setBulkOpen(o => !o)}
                                  className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                                >
                                  <span className="flex items-center gap-1.5">
                                    <Users size={13} className="text-emerald-600" />
                                    Invite from your supplier list
                                  </span>
                                  <span className="text-gray-400">
                                    {invitable.length} available
                                    {alreadyCount > 0 && ` \u00b7 ${alreadyCount} already invited`}
                                  </span>
                                </button>

                                {bulkOpen && (
                                  <div className="border-t border-gray-100 p-3 space-y-2">
                                    {invitable.length === 0 ? (
                                      <p className="text-xs text-gray-500">
                                        {suppliers.length === 0
                                          ? 'No suppliers yet \u2014 add one, or import a list.'
                                          : withoutEmail.length === suppliers.length
                                            ? 'None of your suppliers has a contact email yet.'
                                            : 'Every supplier with an email has already been invited to this survey.'}
                                      </p>
                                    ) : (
                                      <>
                                        <div className="flex items-center justify-between">
                                          <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                                            <input
                                              type="checkbox"
                                              className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                              checked={allSelected}
                                              onChange={e => setBulkSelected(
                                                e.target.checked
                                                  ? new Set(invitable.map(sup => sup.id))
                                                  : new Set(),
                                              )}
                                            />
                                            Select all {invitable.length}
                                          </label>
                                          <span className="text-xs text-gray-400">
                                            {bulkSelected.size} selected
                                          </span>
                                        </div>

                                        <div className="max-h-52 overflow-y-auto divide-y divide-gray-100 rounded-md border border-gray-100">
                                          {invitable.map(sup => (
                                            <label
                                              key={sup.id}
                                              className="flex items-center gap-2 px-2.5 py-2 text-xs cursor-pointer hover:bg-gray-50"
                                            >
                                              <input
                                                type="checkbox"
                                                className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                                checked={bulkSelected.has(sup.id)}
                                                onChange={e => setBulkSelected(prev => {
                                                  const next = new Set(prev);
                                                  if (e.target.checked) next.add(sup.id);
                                                  else next.delete(sup.id);
                                                  return next;
                                                })}
                                              />
                                              <span className="min-w-0 flex-1 truncate">
                                                <span className="font-medium text-gray-900">{sup.name}</span>
                                                <span className="text-gray-400"> {sup.contact_email}</span>
                                              </span>
                                              {sup.tier && (
                                                <Badge variant="secondary" className="text-[10px] shrink-0">
                                                  Tier {sup.tier}
                                                </Badge>
                                              )}
                                            </label>
                                          ))}
                                        </div>

                                        {withoutEmail.length > 0 && (
                                          <p className="text-[11px] text-amber-700">
                                            {withoutEmail.length} supplier{withoutEmail.length === 1 ? '' : 's'} hidden
                                            {' \u2014 '}no contact email on record.
                                          </p>
                                        )}

                                        <div className="flex items-center gap-3">
                                          <Button
                                            size="sm"
                                            onClick={() => handleBulkInvite(
                                              survey,
                                              invitable.filter(sup => bulkSelected.has(sup.id)),
                                            )}
                                            disabled={bulkSending || bulkSelected.size === 0}
                                          >
                                            {bulkSending
                                              ? `Sending ${bulkProgress?.done ?? 0} of ${bulkProgress?.total ?? 0}\u2026`
                                              : `Send ${bulkSelected.size} invite${bulkSelected.size === 1 ? '' : 's'}`}
                                          </Button>
                                          {bulkSending && (
                                            <span className="text-[11px] text-gray-500">
                                              One at a time, so a failure can be traced to a supplier.
                                            </span>
                                          )}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                          {inviteError && <p className="text-xs text-red-600">{inviteError}</p>}
                          {inviteNotice && <p className="text-xs text-emerald-700">{inviteNotice}</p>}
                          {reminderError && <p className="text-xs text-red-600">{reminderError}</p>}
                          {reminderNotice && <p className="text-xs text-emerald-700">{reminderNotice}</p>}

                          {/* Invitation list */}
                          {invs.length > 0 && (
                            <div className="space-y-2">
                              {invs.map(inv => (
                                <div key={inv.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg text-sm gap-3">
                                  <div className="min-w-0">
                                    <p className="font-medium text-gray-900">{inv.supplier_name ?? inv.email}</p>
                                    <p className="text-xs text-gray-400">{inv.email}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">{contactSummary(inv)}</p>
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
                                    <Badge
                                      variant={INVITATION_STATUS_BADGE[inv.status] ?? 'secondary'}
                                      className="text-xs"
                                    >
                                      {inv.status}
                                    </Badge>
                                    {inv.submitted_at && (
                                      <span className="text-xs text-gray-400">
                                        {formatDate(inv.submitted_at)}
                                      </span>
                                    )}
                                    {inv.status === 'submitted' && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setViewingResponses(inv)}
                                        className="text-xs h-6 px-2"
                                      >
                                        View responses
                                      </Button>
                                    )}
                                    {/* Available while unanswered, including 'pending' — a send
                                        that failed leaves the invitation pending, and retrying
                                        it is exactly what this button is for. */}
                                    {inv.status !== 'submitted' && canEdit && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleSendReminder(inv.id)}
                                        disabled={sendingReminder === inv.id}
                                        className="text-xs h-6 px-2"
                                      >
                                        {sendingReminder === inv.id
                                          ? 'Sending…'
                                          : inv.sent_at ? 'Remind' : 'Retry send'}
                                      </Button>
                                    )}
                                    {/* Survey link */}
                                    <button
                                      onClick={() => navigator.clipboard.writeText(`${window.location.origin}/survey/${inv.token}`)}
                                      title="Copy survey link"
                                      className="text-gray-400 hover:text-gray-600"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Supplier create/edit dialog */}
      <SupplierImportDialog open={showSupplierImport} onClose={() => setShowSupplierImport(false)} />

      <Dialog
        open={showSupplierForm}
        onOpenChange={open => { if (!open) { setShowSupplierForm(false); setEditSupplier(null); } }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editSupplier ? 'Edit Supplier' : 'Add Supplier'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label required>Name</Label>
              <Input value={supplierForm.name} onChange={e => setSupplierForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Contact Name</Label>
                <Input value={supplierForm.contact_name} onChange={e => setSupplierForm(f => ({ ...f, contact_name: e.target.value }))} />
              </div>
              <div>
                <Label>Contact Email</Label>
                <Input type="email" value={supplierForm.contact_email} onChange={e => setSupplierForm(f => ({ ...f, contact_email: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Country</Label>
                <Input value={supplierForm.country} onChange={e => setSupplierForm(f => ({ ...f, country: e.target.value }))} placeholder="DE, FR, US…" />
              </div>
              <div>
                <Label>Industry</Label>
                <Input value={supplierForm.industry} onChange={e => setSupplierForm(f => ({ ...f, industry: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Annual Spend (USD)</Label>
                <Input type="number" value={supplierForm.spend_usd} onChange={e => setSupplierForm(f => ({ ...f, spend_usd: e.target.value }))} />
              </div>
              <div>
                <Label>Tier</Label>
                <Select value={supplierForm.tier} onValueChange={v => setSupplierForm(f => ({ ...f, tier: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Tier 1 (Direct)</SelectItem>
                    <SelectItem value="2">Tier 2</SelectItem>
                    <SelectItem value="3">Tier 3+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {supplierError && <p className="text-sm text-red-600">{supplierError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowSupplierForm(false); setEditSupplier(null); }}>Cancel</Button>
            <Button onClick={handleSaveSupplier} disabled={isPending}>
              {isPending ? 'Saving…' : editSupplier ? 'Save Changes' : 'Add Supplier'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Survey create dialog */}
      <Dialog open={showSurveyForm} onOpenChange={setShowSurveyForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Survey</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label required>Title</Label>
              <Input
                value={surveyForm.title}
                onChange={e => setSurveyForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. 2026 CBAM emissions data request"
              />
            </div>
            <div>
              <Label required>Regulation Type</Label>
              <Select value={surveyForm.regulation_type} onValueChange={v => setSurveyForm(f => ({ ...f, regulation_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cbam">CBAM (Carbon Border Adjustment)</SelectItem>
                  <SelectItem value="eudr">EUDR (Deforestation Regulation)</SelectItem>
                  <SelectItem value="pfas">PFAS Disclosure</SelectItem>
                  <SelectItem value="general_carbon">General Carbon Footprint</SelectItem>
                  <SelectItem value="custom">Another regulation…</SelectItem>
                </SelectContent>
              </Select>
              {surveyForm.regulation_type !== 'custom' && (
                <p className="text-xs text-gray-500 mt-1">
                  These arrive with a question set already written. Choose
                  &ldquo;Another regulation&rdquo; to build your own.
                </p>
              )}
            </div>
            {surveyForm.regulation_type === 'custom' && (
              <div>
                <Label required>Regulation name</Label>
                <Input
                  value={surveyForm.custom_regulation_name}
                  onChange={e => setSurveyForm(f => ({ ...f, custom_regulation_name: e.target.value }))}
                  placeholder="e.g. California SB 253, or Supplier Code of Conduct"
                  maxLength={120}
                />
                <p className="text-xs text-gray-500 mt-1">
                  What suppliers will see this survey called. You write the questions
                  yourself on the next screen.
                </p>
              </div>
            )}
            <div>
              <Label>Due Date</Label>
              <Input type="date" value={surveyForm.due_date} onChange={e => setSurveyForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
            {surveyError && <p className="text-sm text-red-600">{surveyError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSurveyForm(false)}>Cancel</Button>
            <Button onClick={handleCreateSurvey} disabled={isPending}>
              {isPending ? 'Creating…' : 'Create Survey'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteSupplierID}
        title="Delete supplier?"
        description="This will permanently remove the supplier. Any linked invitations will remain."
        onConfirm={handleDeleteSupplier}
        onCancel={() => setDeleteSupplierID(null)}
      />

      {/* Bespoke questionnaire builder */}
      {buildingSurvey && (
        <SurveyQuestionBuilder
          surveyId={buildingSurvey.id}
          surveyTitle={buildingSurvey.title}
          regulationType={buildingSurvey.regulation_type}
          open={!!buildingSurvey}
          canEdit={canEdit}
          onClose={() => { setBuildingSurvey(null); router.refresh(); }}
          onCountChange={handleQuestionCountChange}
        />
      )}

      {/* Submitted responses */}
      <Dialog open={!!viewingResponses} onOpenChange={(o) => { if (!o) setViewingResponses(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Responses — {viewingResponses?.supplier_name ?? viewingResponses?.email}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1 max-h-[65vh] overflow-y-auto">
            {viewingResponses && (() => {
              const survey = surveys.find(s => s.id === viewingResponses.survey_id);
              const answers = initialAnswers[viewingResponses.id] ?? {};
              const paired = pairAnswersWithQuestions(
                survey ? questionSetForSurvey(survey) : null,
                answers,
              );

              if (paired.length === 0) {
                return (
                  <p className="text-sm text-gray-500 py-6 text-center">
                    This invitation is marked submitted but carries no stored answers.
                  </p>
                );
              }

              return (
                <>
                  <div className="text-xs text-gray-500">
                    {survey?.title}
                    {viewingResponses.submitted_at &&
                      ` · submitted ${formatDate(viewingResponses.submitted_at)}`}
                  </div>
                  <dl className="space-y-3">
                    {paired.map(item => (
                      <div key={item.questionId} className="border-b border-gray-50 pb-3 last:border-0">
                        <dt className="text-xs text-gray-500">
                          {item.label}
                          {item.orphaned && (
                            <span className="ml-1.5 text-amber-700">
                              (question since removed)
                            </span>
                          )}
                        </dt>
                        <dd className="text-sm text-gray-900 mt-0.5 whitespace-pre-wrap break-words">
                          {item.answer}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              );
            })()}
          </div>

          <DialogFooter>
            <Link href="/reports">
              <Button variant="outline" className="mr-auto">
                <FileDown size={14} className="mr-1.5" />
                Export all responses
              </Button>
            </Link>
            <Button onClick={() => setViewingResponses(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
