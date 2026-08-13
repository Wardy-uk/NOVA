import React, { useState } from 'react';
import {
  DEFAULT_PORTAL_SUPPORT_ROUTES,
  PORTAL_SUPPORT_ROUTE_LABELS,
  type PortalSupportRoute,
} from '../../../shared/portal-types.js';

interface Props {
  onCreated: (ticketKey: string) => void;
  /** Routes this org's selector offers. Falls back to the default pair. */
  routes?: PortalSupportRoute[];
  /** Guild two-stage onboarding (backlog #8) — splits the onboarding route into
   *  the three Guild forms (Membership Application / Standard / Multi-Branch). */
  guildOnboarding?: boolean;
}

type ObFormType = 'application' | 'standard' | 'multi';
const OB_FORM_LABELS: Record<ObFormType, string> = {
  application: 'Raise Membership Application',
  standard: 'Raise Standard Onboarding',
  multi: 'Raise Multi Branch Onboarding',
};
interface OpenApplication { id: number; ref: string; office: string; brand: string | null; branch: string | null; submittedAt: string }

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

type Network = 'Guild' | 'Fine & Country';
type Priority = 'Low' | 'Medium' | 'High' | 'Business Critical';
type RequestType = 'broken' | 'change';

interface OnboardingUser {
  name: string;
  email: string;
  accessLevel: string;
  jobTitle: string;
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm';
const labelCls = 'block text-sm font-medium text-gray-700 mb-1';

export default function PortalRaiseTicket({ onCreated, routes, guildOnboarding }: Props) {
  const enabledRoutes = (routes && routes.length > 0 ? routes : DEFAULT_PORTAL_SUPPORT_ROUTES);
  const [route, setRoute] = useState<PortalSupportRoute>(enabledRoutes[0]);

  // ── Guild two-stage onboarding (backlog #8) ──
  const [obFormType, setObFormType] = useState<ObFormType>('application');
  const [applicationId, setApplicationId] = useState<number | ''>('');
  const [openApps, setOpenApps] = useState<OpenApplication[]>([]);
  const [branches, setBranches] = useState('');   // multi-office: one branch per line
  const [applicationTouched, setApplicationTouched] = useState(false);  // manual override of auto-match
  const [app, setApp] = useState({
    brand: '', branch: '', membershipArea: '', agencyTradingName: '', websiteAddress: '',
    businessEntity: '', companyName: '', addressLine: '', town: '', county: '', postcode: '',
    companyRegNumber: '', businessEstablished: '', vatNumber: '',
    contactName: '', contactPosition: '', contactEmail: '', contactPhone: '',
    directors: '', offersSales: false, offersLettings: false,
    redressScheme: '', amlRegistered: false, icoRegistered: false,
    cmpProvider: '', tenancyDepositProvider: '', piInsurer: '', piExpiryDate: '',
    accountsEmail: '', crmSoftware: '', crmSoftwareOther: '',
    setupFormRecipientName: '', setupFormRecipientEmail: '', invoiceCommencementDate: '', notes: '',
  });
  const setAppField = (k: keyof typeof app, v: string | boolean) => setApp(prev => ({ ...prev, [k]: v }));
  const guildOb = route === 'onboarding' && !!guildOnboarding;
  const [importing, setImporting] = useState(false);
  const [showImportWarning, setShowImportWarning] = useState(false);
  const [importedFile, setImportedFile] = useState<File | null>(null);  // the Guild form used for import → attached to QA + email

  const applyImport = (data: Record<string, unknown>) => {
    const str = (v: unknown) => (v == null ? '' : Array.isArray(v) ? v.join('\n') : String(v));
    const bool = (v: unknown) => v === true || v === 'true' || v === 'yes' || v === 'Yes';
    if (obFormType === 'application') {
      setApp(prev => {
        const next = { ...prev };
        for (const k of Object.keys(prev) as Array<keyof typeof prev>) {
          if (!(k in data)) continue;
          next[k] = (typeof prev[k] === 'boolean' ? bool(data[k]) : str(data[k])) as never;
        }
        return next;
      });
    } else {
      setOb(prev => {
        const next = { ...prev };
        for (const k of Object.keys(prev) as Array<keyof typeof prev>) {
          if (!(k in data)) continue;
          next[k] = (typeof prev[k] === 'boolean' ? bool(data[k]) : str(data[k])) as never;
        }
        return next;
      });
      if (Array.isArray(data.portals)) {
        setPortalsSel(prev => { const n = { ...prev }; for (const p of Object.keys(n)) n[p] = (data.portals as unknown[]).some(x => String(x).toLowerCase() === p.toLowerCase()); return n; });
      }
      if (Array.isArray(data.users) && data.users.length) {
        setObUsers((data.users as Array<Record<string, unknown>>).map(u => ({
          name: str(u.name), email: str(u.email), accessLevel: str(u.accessLevel), jobTitle: str(u.jobTitle),
        })));
      }
    }
  };

  const handleImport = async (file: File) => {
    setImporting(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('formType', obFormType === 'application' ? 'application' : 'setup');
      fd.append('file', file);
      const res = await pf('/api/portal/onboarding/import', { method: 'POST', body: fd });
      const d = await res.json();
      if (d.ok) { applyImport(d.data); setImportedFile(file); setShowImportWarning(true); }
      else setError(d.error || 'Import failed');
    } catch { setError('Import failed'); }
    finally { setImporting(false); }
  };

  // Load open applications when a setup form (standard/multi) is active, for the
  // "attach to application" picker.
  React.useEffect(() => {
    if (!guildOb || obFormType === 'application') return;
    pf('/api/portal/onboarding/open-applications')
      .then(r => r.json()).then(d => { if (d.ok) setOpenApps(d.data); }).catch(() => {});
  }, [guildOb, obFormType]);

  // ── Shared submission state ──
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ── Standard support/development request fields ──
  const [network, setNetwork] = useState<Network>('Guild');
  const [summary, setSummary] = useState('');
  const [agentNameBranch, setAgentNameBranch] = useState('');
  const [agentOfficeId, setAgentOfficeId] = useState('');
  const [detail, setDetail] = useState('');
  const [priority, setPriority] = useState<Priority>('Medium');
  const [businessCriticalReason, setBusinessCriticalReason] = useState('');
  const [requestType, setRequestType] = useState<RequestType>('broken');
  const [hubspotLink, setHubspotLink] = useState('');
  const [notes, setNotes] = useState('');
  const [ccRecipients, setCcRecipients] = useState('');

  // ── Onboarding request fields ──
  const [ob, setOb] = useState({
    brand: '', branch: '', hexCode: '', font: '', invoiceCommencementDate: '', network: 'Guild', registeredCompanyName: '', membershipArea: '',
    addressLine: '', town: '', county: '', postcode: '',
    offersSales: false, offersLettings: false,
    salesEmail: '', lettingsEmail: '', salesPhone: '', lettingsPhone: '',
    portalsOther: '', websiteProvider: '',
    crmAccountName: '', leadProUser: '', magazineReminderEmails: '', magazineRegion: '',
    dimSales: false, dimLettings: false, dimIncludeSoldLet: false, dimOrderBy: '', dimApprovalEmail: '',
    marketReportRegion: '',
    leadResponderPostcodes: '', leadContactName: '', leadContactEmail: '', leadContactPhone: '',
    valuationNotificationEmails: '',
    newAgentName: '', newAgentEmail: '', newAgentPhone: '', newAgentAddress: '', micrositeUrl: '',
    notes: '',
  });
  const setObField = (k: keyof typeof ob, v: string | boolean) => setOb(prev => ({ ...prev, [k]: v }));
  // Valuation notifications default to the office email captured above. Only ever
  // replaces a blank field or a value we defaulted ourselves — a typed or
  // imported address wins.
  const [valuationTouched, setValuationTouched] = useState(false);
  const valuationDefault = React.useRef('');
  React.useEffect(() => {
    if (valuationTouched) return;
    const officeEmail = ob.salesEmail.trim() || ob.lettingsEmail.trim();
    if (!officeEmail || ob.valuationNotificationEmails === officeEmail) return;
    if (ob.valuationNotificationEmails && ob.valuationNotificationEmails !== valuationDefault.current) return;
    valuationDefault.current = officeEmail;
    setObField('valuationNotificationEmails', officeEmail);
  }, [ob.salesEmail, ob.lettingsEmail, ob.valuationNotificationEmails, valuationTouched]);
  const [portalsSel, setPortalsSel] = useState<Record<string, boolean>>({ Rightmove: false, Zoopla: false, 'On The Market': false });
  const [obUsers, setObUsers] = useState<OnboardingUser[]>([{ name: '', email: '', accessLevel: '', jobTitle: '' }]);
  const [usersPrefilled, setUsersPrefilled] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  // Pre-fill "Users to set up" from the org's user configuration, so the team
  // deletes the ones that don't apply instead of typing every user by hand.
  // Only ever fills a still-empty grid — an import or manual edit wins.
  React.useEffect(() => {
    if (route !== 'onboarding' || usersPrefilled) return;
    let active = true;
    pf('/api/portal/onboarding/setup-users')
      .then(r => r.json())
      .then((d: { ok: boolean; data?: OnboardingUser[] }) => {
        if (!active || !d.ok || !d.data?.length) return;
        setUsersPrefilled(true);
        setObUsers(prev => (prev.every(u => !u.name.trim() && !u.email.trim()) ? d.data! : prev));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [route, usersPrefilled]);

  // Auto-match the setup form to an open application by Brand + Branch (works
  // especially well after Import). Manual override via the dropdown; once the
  // user changes it themselves, auto-matching backs off. (Placed after `ob` is
  // declared — its deps read ob.brand/ob.branch at render time.)
  React.useEffect(() => {
    if (!guildOb || obFormType === 'application' || applicationTouched) return;
    const b = ob.brand.trim().toLowerCase(), br = ob.branch.trim().toLowerCase();
    if (!b || !br) return;
    const match = openApps.find(a => (a.brand || '').trim().toLowerCase() === b && (a.branch || '').trim().toLowerCase() === br);
    setApplicationId(match ? match.id : '');
  }, [openApps, ob.brand, ob.branch, guildOb, obFormType, applicationTouched]);
  const autoMatched = !applicationTouched && applicationId !== '';

  const canSubmitStandard = !!network && !!summary && !!agentNameBranch && !!detail;
  const canSubmitOnboarding = !!ob.brand.trim() && !!ob.branch.trim() && !!ob.hexCode.trim();
  const canSubmitApplication = !!app.brand.trim() && !!app.branch.trim();

  const uploadAttachments = async (ticketKey: string) => {
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      try {
        await pf(`/api/portal/tickets/${ticketKey}/attachments`, { method: 'POST', body: formData });
      } catch {
        console.warn(`Failed to upload ${file.name}`);
      }
    }
  };

  const submitStandard = async () => {
    if (!canSubmitStandard) { setError('Please complete all required fields.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await pf('/api/portal/requests', {
        method: 'POST',
        body: JSON.stringify({
          network,
          summary,
          agentNameBranch,
          agentOfficeId: agentOfficeId || undefined,
          detail,
          priority,
          businessCriticalReason: priority === 'Business Critical' ? (businessCriticalReason || undefined) : undefined,
          requestType,
          hubspotLink: hubspotLink || undefined,
          notes: notes || undefined,
          ccEmails: ccRecipients.split(',').map(e => e.trim()).filter(Boolean).slice(0, 10) || undefined,
          supportTeam: route === 'development' ? 'development' : 'support',
        }),
      });
      const data = await res.json();
      if (data.ok) setSuccess(data.data.ticketKey);
      else setError(data.error || 'Failed to raise ticket');
    } catch {
      setError('Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  const submitOnboarding = async () => {
    if (!canSubmitOnboarding) { setError('Brand, Branch and Brand hex colour are required.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const portals = Object.keys(portalsSel).filter(k => portalsSel[k]);
      const users = obUsers.filter(u => u.name.trim() || u.email.trim());
      const res = await pf('/api/portal/onboarding-requests', {
        method: 'POST',
        body: JSON.stringify({
          brand: ob.brand,
          branch: ob.branch,
          invoiceCommencementDate: ob.invoiceCommencementDate,
          hexCode: ob.hexCode,
          font: ob.font || undefined,
          network: ob.network || undefined,
          registeredCompanyName: ob.registeredCompanyName || undefined,
          membershipArea: ob.membershipArea || undefined,
          addressLine: ob.addressLine || undefined,
          town: ob.town || undefined,
          county: ob.county || undefined,
          postcode: ob.postcode || undefined,
          offersSales: ob.offersSales,
          offersLettings: ob.offersLettings,
          salesEmail: ob.salesEmail || undefined,
          lettingsEmail: ob.lettingsEmail || undefined,
          salesPhone: ob.salesPhone || undefined,
          lettingsPhone: ob.lettingsPhone || undefined,
          portals: portals.length ? portals : undefined,
          portalsOther: ob.portalsOther || undefined,
          websiteProvider: ob.websiteProvider || undefined,
          users: users.length ? users : undefined,
          crmAccountName: ob.crmAccountName || undefined,
          leadProUser: ob.leadProUser || undefined,
          magazineReminderEmails: ob.magazineReminderEmails || undefined,
          magazineRegion: ob.magazineRegion || undefined,
          dimSales: ob.dimSales,
          dimLettings: ob.dimLettings,
          dimIncludeSoldLet: ob.dimIncludeSoldLet,
          dimOrderBy: ob.dimOrderBy || undefined,
          dimApprovalEmail: ob.dimApprovalEmail || undefined,
          marketReportRegion: ob.marketReportRegion || undefined,
          leadResponderPostcodes: ob.leadResponderPostcodes || undefined,
          leadContactName: ob.leadContactName || undefined,
          leadContactEmail: ob.leadContactEmail || undefined,
          leadContactPhone: ob.leadContactPhone || undefined,
          valuationNotificationEmails: ob.valuationNotificationEmails || undefined,
          newAgentName: ob.newAgentName || undefined,
          newAgentEmail: ob.newAgentEmail || undefined,
          newAgentPhone: ob.newAgentPhone || undefined,
          newAgentAddress: ob.newAgentAddress || undefined,
          micrositeUrl: ob.micrositeUrl || undefined,
          notes: ob.notes || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        if (files.length > 0) await uploadAttachments(data.data.ticketKey);
        setSuccess(data.data.ticketKey);
      } else {
        setError(data.error || 'Failed to submit onboarding request');
      }
    } catch {
      setError('Failed to submit onboarding request');
    } finally {
      setSubmitting(false);
    }
  };

  // Step 1 — Membership Application (Guild two-stage). Creates the record only.
  const submitApplication = async () => {
    if (!canSubmitApplication) { setError('Brand and Branch are required.'); return; }
    setSubmitting(true); setError(null);
    try {
      const res = await pf('/api/portal/onboarding/application', {
        method: 'POST',
        body: JSON.stringify({
          ...app,
          directors: app.directors.split('\n').map(s => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (data.ok) setSuccess(data.data.ref);
      else setError(data.error || 'Failed to submit application');
    } catch { setError('Failed to submit application'); }
    finally { setSubmitting(false); }
  };

  // Step 2 — Setup form (Standard / Multi). Fires the QA parent + 7 children.
  const submitSetup = async (planType: 'standard' | 'multi') => {
    if (!canSubmitOnboarding) { setError('Brand, Branch and Brand hex colour are required.'); return; }
    setSubmitting(true); setError(null);
    try {
      const portals = Object.keys(portalsSel).filter(k => portalsSel[k]);
      const users = obUsers.filter(u => u.name.trim() || u.email.trim());
      const payload = {
        ...ob,
        planType,
        applicationId: applicationId || undefined,
        branches: planType === 'multi' ? branches.split('\n').map(s => s.trim()).filter(Boolean) : undefined,
        portals,
        users,
        invoiceCommencementDate: ob.invoiceCommencementDate || undefined,
      };
      // Multipart: payload + the imported Guild form (attached server-side to QA + email).
      const fd = new FormData();
      fd.append('payload', JSON.stringify(payload));
      if (importedFile) fd.append('form', importedFile);
      const res = await pf('/api/portal/onboarding/setup', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.ok) {
        // Attachments section → the Digital Design child ticket (item 2).
        const designKey = data.data.childKeys?.design;
        if (files.length > 0 && designKey) await uploadAttachments(designKey);
        setSuccess(data.data.ticketKey);
      } else setError(data.error || 'Failed to submit setup form');
    } catch { setError('Failed to submit setup form'); }
    finally { setSubmitting(false); }
  };

  const handleSubmit = () => {
    if (guildOb) {
      if (obFormType === 'application') return submitApplication();
      return submitSetup(obFormType === 'multi' ? 'multi' : 'standard');
    }
    return route === 'onboarding' ? submitOnboarding() : submitStandard();
  };

  if (success) {
    const wasApplication = guildOb && obFormType === 'application';
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {wasApplication ? 'Membership Application Submitted' : route === 'onboarding' ? 'Onboarding Request Submitted' : 'Ticket Raised'}
        </h2>
        <p className="text-gray-600 mb-6">
          Your {wasApplication ? 'application' : 'request'} <span className="font-mono font-medium text-brand">{success}</span> has been logged.
          {wasApplication
            ? ' No setup tickets are created yet — submit the setup form when you\'re ready and it will start the onboarding.'
            : route === 'onboarding'
            ? ' The setup tickets have been created and the 30-day SLA has started. The team will pick it up shortly.'
            : ' The support team will pick it up shortly.'}
        </p>
        <button
          onClick={() => (wasApplication ? setSuccess(null) : onCreated(success))}
          className="px-6 py-2 bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors"
        >
          {wasApplication ? 'Done' : 'View Ticket'}
        </button>
      </div>
    );
  }

  // Top-level "What do you need?" options. When Guild onboarding is enabled, the
  // single 'onboarding' route expands into the three named Guild forms.
  const selectorOptions: Array<{ value: string; label: string }> = [];
  for (const r of enabledRoutes) {
    if (r === 'onboarding' && guildOnboarding) {
      selectorOptions.push({ value: 'ob:application', label: OB_FORM_LABELS.application });
      selectorOptions.push({ value: 'ob:standard', label: OB_FORM_LABELS.standard });
      selectorOptions.push({ value: 'ob:multi', label: OB_FORM_LABELS.multi });
    } else {
      selectorOptions.push({ value: r, label: PORTAL_SUPPORT_ROUTE_LABELS[r] });
    }
  }
  const selectedValue = guildOb ? `ob:${obFormType}` : route;
  const onSelectRoute = (v: string) => {
    setError(null);
    if (v.startsWith('ob:')) { setRoute('onboarding'); setObFormType(v.slice(3) as ObFormType); }
    else setRoute(v as PortalSupportRoute);
  };
  const showSelector = selectorOptions.length > 1;
  const canSubmit = guildOb
    ? (obFormType === 'application' ? canSubmitApplication : canSubmitOnboarding)
    : (route === 'onboarding' ? canSubmitOnboarding : canSubmitStandard);

  return (
    <div className="max-w-2xl mx-auto">
      {showImportWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 5a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" /></svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Check the imported details</h2>
            </div>
            <p className="text-sm text-gray-600">
              We've pre-filled this form from the file you uploaded. Automated extraction can make mistakes —
              <strong> it is your responsibility to validate the imported data before submitting this request.</strong>
              {obFormType !== 'application' && <><br /><br />Please also remember to <strong>attach the logo</strong> — it's needed for the Digital Design ticket.</>}
            </p>
            <div className="flex justify-end">
              <button onClick={() => setShowImportWarning(false)} className="px-5 py-2 bg-brand text-white rounded-lg hover:bg-brand-dark text-sm">
                I understand
              </button>
            </div>
          </div>
        </div>
      )}
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Raise a Ticket</h1>
      <p className="text-sm text-gray-600 mb-6">Raise a support, development or onboarding request.</p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        {/* Route selector — first field. Hidden when the org has a single route. */}
        {showSelector && (
          <div>
            <label htmlFor="rt-route" className={labelCls}>What do you need? *</label>
            <select id="rt-route" value={selectedValue} onChange={e => onSelectRoute(e.target.value)} className={inputCls}>
              {selectorOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        {guildOb ? (
          <>
            <p className="text-xs text-gray-500">
              {obFormType === 'application'
                ? 'Step 1 — the membership application. No setup tickets are created yet.'
                : 'Step 2 — the setup form. Creates the setup tickets and starts the 30-day SLA.'}
            </p>

            {/* Import from the Guild form (backlog #8, stage 3) */}
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3">
              <label className="cursor-pointer px-3 py-1.5 bg-brand text-white rounded-lg text-sm hover:bg-brand-dark">
                {importing ? 'Reading…' : 'Import from Guild form'}
                <input type="file" accept=".pdf,.xlsx,.xls" className="hidden" disabled={importing}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }} />
              </label>
              <p className="text-xs text-gray-500">Upload the {obFormType === 'multi' ? 'multi-office set-up spreadsheet' : obFormType === 'application' ? 'Guild application PDF' : 'Guild set-up PDF'} to pre-fill this form. Review before submitting.</p>
            </div>

            {obFormType === 'application' ? (
              <MembershipApplicationForm app={app} setAppField={setAppField} />
            ) : (
              <>
                {/* Attach to an existing application */}
                <div>
                  <label className={labelCls}>Link to a membership application</label>
                  <select value={applicationId} onChange={e => { setApplicationId(e.target.value ? Number(e.target.value) : ''); setApplicationTouched(true); }} className={inputCls}>
                    <option value="">— New / not linked —</option>
                    {openApps.map(a => <option key={a.id} value={a.id}>{a.office} ({a.ref})</option>)}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    {autoMatched
                      ? '✓ Auto-matched to the application with the same Brand & Branch. Change it here if that\'s wrong.'
                      : 'Pick the application this setup completes, so it\'s tracked as one onboarding.'}
                  </p>
                </div>
                {obFormType === 'multi' && (
                  <div>
                    <label className={labelCls}>Branches (one per line)</label>
                    <textarea value={branches} onChange={e => setBranches(e.target.value)} rows={4} placeholder={'Branch A\nBranch B\nBranch C'} className={`${inputCls} resize-none`} />
                  </div>
                )}
                <OnboardingForm
                  ob={ob}
                  setObField={setObField}
                  onValuationEdit={() => setValuationTouched(true)}
                  portalsSel={portalsSel}
                  setPortalsSel={setPortalsSel}
                  users={obUsers}
                  setUsers={setObUsers}
                  files={files}
                  setFiles={setFiles}
                />
              </>
            )}
          </>
        ) : route === 'onboarding' ? (
          <OnboardingForm
            ob={ob}
            setObField={setObField}
            onValuationEdit={() => setValuationTouched(true)}
            portalsSel={portalsSel}
            setPortalsSel={setPortalsSel}
            users={obUsers}
            setUsers={setObUsers}
            files={files}
            setFiles={setFiles}
          />
        ) : (
          <>
            {/* Network */}
            <div>
              <label htmlFor="rt-network" className={labelCls}>Network *</label>
              <select id="rt-network" value={network} onChange={e => setNetwork(e.target.value as Network)} className={inputCls}>
                <option value="Guild">Guild</option>
                <option value="Fine &amp; Country">Fine &amp; Country</option>
              </select>
            </div>

            {/* Summary */}
            <div>
              <label htmlFor="rt-summary" className={labelCls}>Summary *</label>
              <input id="rt-summary" type="text" value={summary} onChange={e => setSummary(e.target.value)} placeholder="One-line summary of the request" aria-required="true" className={inputCls} />
            </div>

            {/* Agent Name & Branch */}
            <div>
              <label htmlFor="rt-agent" className={labelCls}>Agent Name &amp; Branch *</label>
              <input id="rt-agent" type="text" value={agentNameBranch} onChange={e => setAgentNameBranch(e.target.value)} placeholder="e.g. Parkers Estate Agents (Backwell)" aria-required="true" className={inputCls} />
            </div>

            {/* Agent Office ID */}
            <div>
              <label htmlFor="rt-office" className={labelCls}>Agent Office ID</label>
              <input id="rt-office" type="text" value={agentOfficeId} onChange={e => setAgentOfficeId(e.target.value)} placeholder="e.g. 4579" className={inputCls} />
            </div>

            {/* Detailed description */}
            <div>
              <label htmlFor="rt-detail" className={labelCls}>Detailed description of Issue *</label>
              <textarea id="rt-detail" value={detail} onChange={e => setDetail(e.target.value)} placeholder="Describe the issue in as much detail as possible" aria-required="true" rows={5} className={`${inputCls} resize-none`} />
            </div>

            {/* Request type + Priority */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="rt-type" className={labelCls}>Request type *</label>
                <select id="rt-type" value={requestType} onChange={e => setRequestType(e.target.value as RequestType)} className={inputCls}>
                  <option value="broken">Something is broken</option>
                  <option value="change">Something needs changing</option>
                </select>
              </div>
              <div>
                <label htmlFor="rt-priority" className={labelCls}>Priority</label>
                <select id="rt-priority" value={priority} onChange={e => setPriority(e.target.value as Priority)} className={inputCls}>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Business Critical">Business Critical</option>
                </select>
              </div>
            </div>

            {priority === 'Business Critical' && (
              <div>
                <label htmlFor="rt-bc-reason" className={labelCls}>
                  Why is this business critical? <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea id="rt-bc-reason" value={businessCriticalReason} onChange={e => setBusinessCriticalReason(e.target.value)} rows={2} placeholder="e.g. blocking all agents from listing properties" className={inputCls} />
              </div>
            )}

            {/* Hubspot link */}
            <div>
              <label htmlFor="rt-hubspot" className={labelCls}>Link to originating Hubspot ticket</label>
              <input id="rt-hubspot" type="text" value={hubspotLink} onChange={e => setHubspotLink(e.target.value)} placeholder="For the Dev team's reference" className={inputCls} />
            </div>

            {/* Notes */}
            <div>
              <label htmlFor="rt-notes" className={labelCls}>Notes</label>
              <textarea id="rt-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${inputCls} resize-none`} />
            </div>

            {/* CC / additional recipients */}
            <div>
              <label htmlFor="rt-cc" className={labelCls}>CC / additional recipients</label>
              <input id="rt-cc" type="text" value={ccRecipients} onChange={e => setCcRecipients(e.target.value)} placeholder="email@example.com, another@example.com" className={inputCls} />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Comma-separated email addresses. They'll receive the ticket's correspondence (must be portal users).</p>
            </div>
          </>
        )}

        <div className="flex items-center justify-end pt-2">
          <button
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
            className="px-6 py-2.5 bg-brand text-white font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 outline-none"
          >
            {submitting ? 'Submitting...' : route === 'onboarding' ? 'Submit Onboarding Request' : 'Raise Ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Onboarding sub-form ──────────────────────────────────────────────────────

const ACCESS_LEVELS = ['Client Admin', 'Office Admin', 'Agent'];
const PORTAL_OPTIONS = ['Rightmove', 'Zoopla', 'On The Market'];

function OnboardingForm({
  ob, setObField, onValuationEdit, portalsSel, setPortalsSel, users, setUsers, files, setFiles,
}: {
  ob: any;
  setObField: (k: any, v: string | boolean) => void;
  /** Stops the office-email default from overwriting a hand-typed value. */
  onValuationEdit: () => void;
  portalsSel: Record<string, boolean>;
  setPortalsSel: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  users: OnboardingUser[];
  setUsers: React.Dispatch<React.SetStateAction<OnboardingUser[]>>;
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
}) {
  const text = (k: string, label: string, placeholder?: string, required?: boolean) => (
    <div>
      <label className={labelCls}>{label}{required ? ' *' : ''}</label>
      <input type="text" value={ob[k]} onChange={e => setObField(k, e.target.value)} placeholder={placeholder} className={inputCls} />
    </div>
  );
  const check = (k: string, label: string) => (
    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
      <input type="checkbox" checked={!!ob[k]} onChange={e => setObField(k, e.target.checked)} className="rounded border-gray-300 text-brand focus:ring-brand" />
      {label}
    </label>
  );

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles(prev => [...prev, ...Array.from(list)]);
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="border-t border-gray-100 pt-4 space-y-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Set up a new office / agent. This creates a setup ticket plus a linked QA ticket for the build.
      </p>

      <Section title="Business">
        {text('brand', 'Brand / Agent name', 'e.g. Property Cafe', true)}
        {text('branch', 'Branch', 'e.g. Bexhill', true)}
        {text('hexCode', 'Brand hex colour', 'e.g. #0d9488 — for the Digital Design ticket', true)}
        {text('font', 'Brand font', 'e.g. Montserrat — for the Digital Design ticket')}
        <div>
          <label className={labelCls}>Invoice commencement date *</label>
          <input type="date" value={ob.invoiceCommencementDate} onChange={e => setObField('invoiceCommencementDate', e.target.value)} className={inputCls} />
          <p className="mt-1 text-xs text-gray-500">Required — the 30-day onboarding SLA runs from your submission and billing depends on this date.</p>
        </div>
        <div>
          <label className={labelCls}>Network</label>
          <select value={ob.network} onChange={e => setObField('network', e.target.value)} className={inputCls}>
            <option value="Guild">Guild</option>
            <option value="Fine & Country">Fine &amp; Country</option>
            <option value="">Other / N/A</option>
          </select>
        </div>
        {text('registeredCompanyName', 'Registered company name')}
        {text('membershipArea', 'Membership area / location')}
        {text('addressLine', 'Trading address')}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {text('town', 'Town')}
          {text('county', 'County')}
          {text('postcode', 'Postcode')}
        </div>
      </Section>

      <Section title="Services offered">
        <div className="flex gap-6">
          {check('offersSales', 'Sales')}
          {check('offersLettings', 'Lettings')}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {text('salesEmail', 'Sales email')}
          {text('salesPhone', 'Sales phone')}
          {text('lettingsEmail', 'Lettings email')}
          {text('lettingsPhone', 'Lettings phone')}
        </div>
      </Section>

      <Section title="Marketing">
        <div>
          <label className={labelCls}>Portals advertised on</label>
          <div className="flex flex-wrap gap-4">
            {PORTAL_OPTIONS.map(p => (
              <label key={p} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={!!portalsSel[p]} onChange={e => setPortalsSel(prev => ({ ...prev, [p]: e.target.checked }))} className="rounded border-gray-300 text-brand focus:ring-brand" />
                {p}
              </label>
            ))}
          </div>
        </div>
        {text('portalsOther', 'Other portals')}
        {text('websiteProvider', 'Current website provider')}
      </Section>

      <Section title="Users to set up">
        {users.map((u, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
            <input className={`${inputCls} sm:col-span-3`} placeholder="Name" value={u.name} onChange={e => setUsers(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input className={`${inputCls} sm:col-span-4`} placeholder="Email" value={u.email} onChange={e => setUsers(prev => prev.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} />
            <select className={`${inputCls} sm:col-span-2`} value={u.accessLevel} onChange={e => setUsers(prev => prev.map((x, j) => j === i ? { ...x, accessLevel: e.target.value } : x))}>
              <option value="">Access…</option>
              {ACCESS_LEVELS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <input className={`${inputCls} sm:col-span-2`} placeholder="Job title" value={u.jobTitle} onChange={e => setUsers(prev => prev.map((x, j) => j === i ? { ...x, jobTitle: e.target.value } : x))} />
            <button type="button" onClick={() => setUsers(prev => prev.length > 1 ? prev.filter((_, j) => j !== i) : prev)} className="sm:col-span-1 text-gray-400 hover:text-red-500 text-lg leading-none" aria-label="Remove user">×</button>
          </div>
        ))}
        <button type="button" onClick={() => setUsers(prev => [...prev, { name: '', email: '', accessLevel: '', jobTitle: '' }])} className="text-sm text-brand hover:underline">+ Add another user</button>
      </Section>

      <Section title="Products & set-up">
        {text('crmAccountName', 'CRM / referral account name', 'Name as it appears on your CRM')}
        {text('leadProUser', 'Lead Pro user', 'Named person for the free Lead Pro seat')}
        {text('magazineRegion', 'Preferred magazine region')}
        <div className="flex gap-6">
          {check('dimSales', 'Digital magazine — Sales')}
          {check('dimLettings', 'Digital magazine — Lettings')}
          {check('dimIncludeSoldLet', 'Include Sold / Let')}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Digital magazine — order properties by</label>
            <select value={ob.dimOrderBy} onChange={e => setObField('dimOrderBy', e.target.value)} className={inputCls}>
              <option value="">—</option>
              <option value="Most Expensive">Most Expensive</option>
              <option value="Recently Added">Recently Added</option>
            </select>
          </div>
          {text('dimApprovalEmail', 'Digital magazine — approval email')}
        </div>
        {text('marketReportRegion', 'Regional market report region')}
      </Section>

      <Section title="Lead generation">
        {text('leadResponderPostcodes', 'Lead responder postcode coverage (please separate postcode districts by commas)', 'e.g. TN39, TN40, TN33')}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {text('leadContactName', 'Lead responder contact — name')}
          {text('leadContactEmail', 'Contact email')}
          {text('leadContactPhone', 'Contact phone')}
        </div>
        <div>
          <label className={labelCls}>Valuation lead notification email(s)</label>
          <input type="text" value={ob.valuationNotificationEmails}
            onChange={e => { onValuationEdit(); setObField('valuationNotificationEmails', e.target.value); }}
            placeholder="Comma-separated" className={inputCls} />
          <p className="mt-1 text-xs text-gray-500">Pre-filled with the office email above — change it if valuation leads go elsewhere.</p>
        </div>
        {text('magazineReminderEmails', 'Magazine reminder email(s)', 'Comma-separated')}
      </Section>

      <Section title="New agent joining (if applicable)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {text('newAgentName', 'Agent full name')}
          {text('newAgentEmail', 'Agent email')}
          {text('newAgentPhone', 'Agent phone')}
          {text('micrositeUrl', 'Microsite / IVT URL')}
        </div>
        {text('newAgentAddress', 'Agent registered address')}
      </Section>

      <Section title="Build & QA">
        <div>
          <label className={labelCls}>Notes / special instructions</label>
          <textarea value={ob.notes} onChange={e => setObField('notes', e.target.value)} rows={3} className={`${inputCls} resize-none`} />
        </div>
      </Section>

      <Section title="Attachments">
        <div className="rounded-lg border-2 border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm font-bold text-red-700">Please attach the logo and any branding / compliance documents here.</p>
          <p className="mt-1 text-xs text-red-600">The Digital Design ticket can't start without the logo.</p>
        </div>
        <input type="file" multiple onChange={e => { addFiles(e.target.files); e.target.value = ''; }} className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200" />
        {files.length > 0 && (
          <ul className="space-y-1">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between text-sm text-gray-600 bg-gray-50 rounded px-2 py-1">
                <span className="truncate">{f.name}</span>
                <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 ml-2" aria-label="Remove file">×</button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-400">PDF, images, Office docs, CSV, TXT, ZIP up to 10 MB each.</p>
      </Section>
    </div>
  );
}

// Step 1 form — Guild Membership Application (backlog #8). Mirrors the Guild
// "Membership Application Form (Single Office)". Creates the record; no tickets.
function MembershipApplicationForm({ app, setAppField }: {
  app: Record<string, string | boolean>;
  setAppField: (k: string, v: string | boolean) => void;
}) {
  const text = (k: string, label: string, placeholder?: string, required?: boolean) => (
    <div>
      <label className={labelCls}>{label}{required ? ' *' : ''}</label>
      <input type="text" value={String(app[k] ?? '')} onChange={e => setAppField(k, e.target.value)} placeholder={placeholder} className={inputCls} />
    </div>
  );
  const check = (k: string, label: string) => (
    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
      <input type="checkbox" checked={!!app[k]} onChange={e => setAppField(k, e.target.checked)} className="rounded border-gray-300 text-brand focus:ring-brand" />
      {label}
    </label>
  );
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="border-t border-gray-100 pt-4 space-y-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">The membership application. Once countersigned, complete the setup form to start the onboarding.</p>

      <Section title="Business">
        {text('brand', 'Agent / Brand', 'e.g. Property Cafe', true)}
        {text('branch', 'Branch', 'e.g. Bexhill', true)}
        {text('membershipArea', 'Guild Membership Area / Location')}
        {text('agencyTradingName', 'Agency trading name')}
        {text('websiteAddress', 'Website address')}
        <div>
          <label className={labelCls}>Business entity</label>
          <select value={String(app.businessEntity ?? '')} onChange={e => setAppField('businessEntity', e.target.value)} className={inputCls}>
            <option value="">Select…</option>
            <option value="Limited Company">Limited Company</option>
            <option value="Sole Trader">Sole Trader</option>
            <option value="Traditional Partnership">Traditional Partnership</option>
            <option value="LLP">Limited Liability Partnership (LLP)</option>
          </select>
        </div>
        {text('companyName', 'Registered company name')}
        {text('addressLine', 'Business address')}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {text('town', 'Town')}
          {text('county', 'County')}
          {text('postcode', 'Postcode')}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {text('companyRegNumber', 'Company reg. number')}
          {text('businessEstablished', 'Established (year)')}
          {text('vatNumber', 'VAT number')}
        </div>
      </Section>

      <Section title="Contact">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {text('contactName', 'Contact name')}
          {text('contactPosition', 'Contact position')}
          {text('contactEmail', 'Contact email')}
          {text('contactPhone', 'Contact phone')}
        </div>
        <div>
          <label className={labelCls}>Directors / business owners (one per line)</label>
          <textarea value={String(app.directors ?? '')} onChange={e => setAppField('directors', e.target.value)} rows={3} className={`${inputCls} resize-none`} />
        </div>
      </Section>

      <Section title="Compliance">
        <div className="flex gap-6">
          {check('offersSales', 'Offers Sales')}
          {check('offersLettings', 'Offers Lettings')}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {text('redressScheme', 'Redress scheme (PRS / TPO)')}
          <div className="flex items-end gap-6">
            {check('amlRegistered', 'AML registered')}
            {check('icoRegistered', 'ICO registered')}
          </div>
          {text('cmpProvider', 'Client Money Protection provider')}
          {text('tenancyDepositProvider', 'Tenancy Deposit Scheme provider')}
          {text('piInsurer', 'PI insurer')}
          {text('piExpiryDate', 'PI policy expiry (YYYY-MM-DD)')}
        </div>
      </Section>

      <Section title="Integration & invoicing">
        {text('crmSoftware', 'Estate agency software (CRM)')}
        {text('crmSoftwareOther', 'CRM — other (if not listed)')}
        {text('accountsEmail', 'Accounts email (for invoicing)')}
        <div>
          <label className={labelCls}>Invoice commencement date</label>
          <input type="date" value={String(app.invoiceCommencementDate ?? '')} onChange={e => setAppField('invoiceCommencementDate', e.target.value)} className={inputCls} />
        </div>
      </Section>

      <Section title="Setup form recipient">
        <p className="text-xs text-gray-500">Who should the setup form go to for completion?</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {text('setupFormRecipientName', 'Full name')}
          {text('setupFormRecipientEmail', 'Email address')}
        </div>
      </Section>

      <Section title="Notes">
        <textarea value={String(app.notes ?? '')} onChange={e => setAppField('notes', e.target.value)} rows={3} className={`${inputCls} resize-none`} />
      </Section>
    </div>
  );
}
