import React, { useState } from 'react';

interface Props {
  onCreated: (ticketKey: string) => void;
}

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

type Network = 'Guild' | 'Fine & Country';
type Priority = 'Low' | 'Medium' | 'High' | 'Business Critical';
type RequestType = 'broken' | 'change';
type SupportTeam = 'development' | 'support';

export default function PortalRaiseTicket({ onCreated }: Props) {
  const [network, setNetwork] = useState<Network>('Guild');
  const [summary, setSummary] = useState('');
  const [agentNameBranch, setAgentNameBranch] = useState('');
  const [agentOfficeId, setAgentOfficeId] = useState('');
  const [detail, setDetail] = useState('');
  const [priority, setPriority] = useState<Priority>('Medium');
  const [businessCriticalReason, setBusinessCriticalReason] = useState('');
  const [requestType, setRequestType] = useState<RequestType>('broken');
  const [supportTeam, setSupportTeam] = useState<SupportTeam>('support');
  const [hubspotLink, setHubspotLink] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canSubmit = !!network && !!summary && !!agentNameBranch && !!detail;

  const handleSubmit = async () => {
    if (!canSubmit) {
      setError('Please complete all required fields.');
      return;
    }
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
          supportTeam,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setSuccess(data.data.ticketKey);
      } else {
        setError(data.error || 'Failed to raise ticket');
      }
    } catch {
      setError('Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Ticket Raised</h2>
        <p className="text-gray-600 mb-6">
          Your request <span className="font-mono font-medium text-brand">{success}</span> has been logged.
          The support team will pick it up shortly.
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

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm';

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Raise a Ticket</h1>
      <p className="text-sm text-gray-600 mb-6">Guild &amp; Fine &amp; Country network support requests.</p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        {/* Network */}
        <div>
          <label htmlFor="rt-network" className="block text-sm font-medium text-gray-700 mb-1">Network *</label>
          <select id="rt-network" value={network} onChange={e => setNetwork(e.target.value as Network)} className={inputCls}>
            <option value="Guild">Guild</option>
            <option value="Fine &amp; Country">Fine &amp; Country</option>
          </select>
        </div>

        {/* Summary */}
        <div>
          <label htmlFor="rt-summary" className="block text-sm font-medium text-gray-700 mb-1">Summary *</label>
          <input
            id="rt-summary"
            type="text"
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="One-line summary of the request"
            aria-required="true"
            className={inputCls}
          />
        </div>

        {/* Agent Name & Branch */}
        <div>
          <label htmlFor="rt-agent" className="block text-sm font-medium text-gray-700 mb-1">Agent Name &amp; Branch *</label>
          <input
            id="rt-agent"
            type="text"
            value={agentNameBranch}
            onChange={e => setAgentNameBranch(e.target.value)}
            placeholder="e.g. Parkers Estate Agents (Backwell)"
            aria-required="true"
            className={inputCls}
          />
        </div>

        {/* Agent Office ID */}
        <div>
          <label htmlFor="rt-office" className="block text-sm font-medium text-gray-700 mb-1">Agent Office ID</label>
          <input
            id="rt-office"
            type="text"
            value={agentOfficeId}
            onChange={e => setAgentOfficeId(e.target.value)}
            placeholder="e.g. 4579"
            className={inputCls}
          />
        </div>

        {/* Detailed description */}
        <div>
          <label htmlFor="rt-detail" className="block text-sm font-medium text-gray-700 mb-1">Detailed description of Issue *</label>
          <textarea
            id="rt-detail"
            value={detail}
            onChange={e => setDetail(e.target.value)}
            placeholder="Describe the issue in as much detail as possible"
            aria-required="true"
            rows={5}
            className={`${inputCls} resize-none`}
          />
        </div>

        {/* Request type + Priority */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="rt-type" className="block text-sm font-medium text-gray-700 mb-1">Request type *</label>
            <select id="rt-type" value={requestType} onChange={e => setRequestType(e.target.value as RequestType)} className={inputCls}>
              <option value="broken">Something is broken</option>
              <option value="change">Something needs changing</option>
            </select>
          </div>
          <div>
            <label htmlFor="rt-priority" className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
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
            <label htmlFor="rt-bc-reason" className="block text-sm font-medium text-gray-700 mb-1">
              Why is this business critical? <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="rt-bc-reason"
              value={businessCriticalReason}
              onChange={e => setBusinessCriticalReason(e.target.value)}
              rows={2}
              placeholder="e.g. blocking all agents from listing properties"
              className={inputCls}
            />
          </div>
        )}

        {/* Support Team */}
        <div>
          <label htmlFor="rt-team" className="block text-sm font-medium text-gray-700 mb-1">Select Support Team *</label>
          <select id="rt-team" value={supportTeam} onChange={e => setSupportTeam(e.target.value as SupportTeam)} className={inputCls}>
            <option value="support">Raise to Support</option>
            <option value="development">Triaged for Development</option>
          </select>
        </div>

        {/* Hubspot link */}
        <div>
          <label htmlFor="rt-hubspot" className="block text-sm font-medium text-gray-700 mb-1">Link to originating Hubspot ticket</label>
          <input
            id="rt-hubspot"
            type="text"
            value={hubspotLink}
            onChange={e => setHubspotLink(e.target.value)}
            placeholder="For the Dev team's reference"
            className={inputCls}
          />
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="rt-notes" className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            id="rt-notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className={`${inputCls} resize-none`}
          />
        </div>

        <div className="flex items-center justify-end pt-2">
          <button
            onClick={handleSubmit}
            disabled={submitting || !canSubmit}
            className="px-6 py-2.5 bg-brand text-white font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 outline-none"
          >
            {submitting ? 'Submitting...' : 'Raise Ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}
