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
}

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

export default function PortalRaiseTicket({ onCreated, routes }: Props) {
  const enabledRoutes = (routes && routes.length > 0 ? routes : DEFAULT_PORTAL_SUPPORT_ROUTES);
  const [route, setRoute] = useState<PortalSupportRoute>(enabledRoutes[0]);

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
    brand: '', branch: '', invoiceCommencementDate: '', network: 'Guild', registeredCompanyName: '', membershipArea: '',
    addressLine: '', town: '', county: '', postcode: '',
    offersSales: false, offersLettings: false,
    salesEmail: '', lettingsEmail: '', salesPhone: '', lettingsPhone: '',
    portalsOther: '', websiteProvider: '',
    crmAccountName: '', leadProUser: '', magazineReminderEmails: '', magazineRegion: '',
    dimSales: false, dimLettings: false, dimIncludeSoldLet: false, dimOrderBy: '', dimApprovalEmail: '',
    marketReportRegion: '',
    leadResponderPostcodes: '', leadContactName: '', leadContactEmail: '', leadContactPhone: '',
    ivtUrl: '', ivtPresentOn: '', valuationNotificationEmails: '',
    newAgentName: '', newAgentEmail: '', newAgentPhone: '', newAgentAddress: '', micrositeUrl: '',
    bymUrl: '', notes: '',
  });
  const setObField = (k: keyof typeof ob, v: string | boolean) => setOb(prev => ({ ...prev, [k]: v }));
  const [portalsSel, setPortalsSel] = useState<Record<string, boolean>>({ Rightmove: false, Zoopla: false, 'On The Market': false });
  const [obUsers, setObUsers] = useState<OnboardingUser[]>([{ name: '', email: '', accessLevel: '', jobTitle: '' }]);
  const [files, setFiles] = useState<File[]>([]);

  const canSubmitStandard = !!network && !!summary && !!agentNameBranch && !!detail;
  const canSubmitOnboarding = !!ob.brand.trim() && !!ob.branch.trim() && !!ob.invoiceCommencementDate.trim();

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
    if (!canSubmitOnboarding) { setError('Brand, Branch and Invoice commencement date are required.'); return; }
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
          ivtUrl: ob.ivtUrl || undefined,
          ivtPresentOn: ob.ivtPresentOn || undefined,
          valuationNotificationEmails: ob.valuationNotificationEmails || undefined,
          newAgentName: ob.newAgentName || undefined,
          newAgentEmail: ob.newAgentEmail || undefined,
          newAgentPhone: ob.newAgentPhone || undefined,
          newAgentAddress: ob.newAgentAddress || undefined,
          micrositeUrl: ob.micrositeUrl || undefined,
          bymUrl: ob.bymUrl || undefined,
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

  const handleSubmit = () => (route === 'onboarding' ? submitOnboarding() : submitStandard());

  if (success) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {route === 'onboarding' ? 'Onboarding Request Submitted' : 'Ticket Raised'}
        </h2>
        <p className="text-gray-600 mb-6">
          Your request <span className="font-mono font-medium text-brand">{success}</span> has been logged.
          {route === 'onboarding'
            ? ' A linked QA ticket has been created for the build. The team will pick it up shortly.'
            : ' The support team will pick it up shortly.'}
        </p>
        <button
          onClick={() => onCreated(success)}
          className="px-6 py-2 bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors"
        >
          View Ticket
        </button>
      </div>
    );
  }

  const showSelector = enabledRoutes.length > 1;
  const canSubmit = route === 'onboarding' ? canSubmitOnboarding : canSubmitStandard;

  return (
    <div className="max-w-2xl mx-auto">
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
            <select id="rt-route" value={route} onChange={e => { setRoute(e.target.value as PortalSupportRoute); setError(null); }} className={inputCls}>
              {enabledRoutes.map(r => (
                <option key={r} value={r}>{PORTAL_SUPPORT_ROUTE_LABELS[r]}</option>
              ))}
            </select>
          </div>
        )}

        {route === 'onboarding' ? (
          <OnboardingForm
            ob={ob}
            setObField={setObField}
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
  ob, setObField, portalsSel, setPortalsSel, users, setUsers, files, setFiles,
}: {
  ob: any;
  setObField: (k: any, v: string | boolean) => void;
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
        {text('magazineReminderEmails', 'Magazine reminder email(s)', 'Comma-separated')}
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
        {text('leadResponderPostcodes', 'Lead responder postcode coverage', 'e.g. TN39, TN40, TN33')}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {text('leadContactName', 'Lead responder contact — name')}
          {text('leadContactEmail', 'Contact email')}
          {text('leadContactPhone', 'Contact phone')}
        </div>
        {text('ivtUrl', 'Instant valuation tool URL')}
        <div>
          <label className={labelCls}>Instant valuation presented on</label>
          <select value={ob.ivtPresentOn} onChange={e => setObField('ivtPresentOn', e.target.value)} className={inputCls}>
            <option value="">—</option>
            <option value="Main website">Your main website</option>
            <option value="Separate mini site">A separate mini site</option>
          </select>
        </div>
        {text('valuationNotificationEmails', 'Valuation lead notification email(s)', 'Comma-separated')}
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
        {text('bymUrl', 'BYM URL (for QA)', 'System build URL, if known')}
        <div>
          <label className={labelCls}>Notes / special instructions</label>
          <textarea value={ob.notes} onChange={e => setObField('notes', e.target.value)} rows={3} className={`${inputCls} resize-none`} />
        </div>
      </Section>

      <Section title="Attachments">
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
