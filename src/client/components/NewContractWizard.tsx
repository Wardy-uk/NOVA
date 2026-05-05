import { useState, useEffect, useCallback } from 'react';
import type { AdobeSignLibraryDocument, AdobeSignFormField } from '../../shared/types.js';

interface Props {
  onNavigateToAgreements: () => void;
}

type Step = 'template' | 'fields' | 'recipients' | 'review';
const STEPS: { key: Step; label: string }[] = [
  { key: 'template', label: 'Select Template' },
  { key: 'fields', label: 'Fill Fields' },
  { key: 'recipients', label: 'Recipients' },
  { key: 'review', label: 'Review & Send' },
];

const inputCls = 'bg-[#272C33] text-neutral-200 text-[11px] rounded px-2.5 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-full placeholder:text-neutral-600';
const labelCls = 'text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block';
const btnPrimary = 'text-[11px] px-4 py-2 rounded bg-[#5ec1ca] text-[#272C33] font-medium hover:bg-[#4db0b9] transition-colors disabled:opacity-40';
const btnSecondary = 'text-[11px] px-4 py-2 rounded bg-[#2f353d] text-neutral-300 hover:bg-[#3a424d] transition-colors';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function inputTypeFor(field: AdobeSignFormField): 'text' | 'date' | 'select' | 'checkbox' | 'radio' | 'email' {
  switch (field.contentType) {
    case 'DATE_FIELD': return 'date';
    case 'DROP_DOWN_LIST_FIELD': return 'select';
    case 'CHECK_BOX_FIELD': return 'checkbox';
    case 'RADIO_BUTTON_FIELD': return 'radio';
    case 'EMAIL_FIELD': return 'email';
    default: return 'text';
  }
}

export function NewContractWizard({ onNavigateToAgreements }: Props) {
  const [step, setStep] = useState<Step>('template');
  const [templates, setTemplates] = useState<AdobeSignLibraryDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedTemplate, setSelectedTemplate] = useState<AdobeSignLibraryDocument | null>(null);
  const [formFields, setFormFields] = useState<AdobeSignFormField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  const [contractName, setContractName] = useState('');
  const [signers, setSigners] = useState<Array<{ email: string; name: string }>>([{ email: '', name: '' }]);
  const [ccEmails, setCcEmails] = useState('');
  const [message, setMessage] = useState('');
  const [expirationDays, setExpirationDays] = useState('');
  const [sending, setSending] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [templateSearch, setTemplateSearch] = useState('');

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/adobe-sign/library-documents');
      const json = await res.json();
      if (json.ok) {
        setTemplates(json.data ?? []);
      } else {
        setLoadError(json.error ?? 'Failed to load templates from Adobe Sign');
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load templates');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const filteredTemplates = templates.filter((t) =>
    !templateSearch.trim() ||
    t.name.toLowerCase().includes(templateSearch.toLowerCase())
  );

  const canProceed = (s: Step): boolean => {
    switch (s) {
      case 'template': return selectedTemplate !== null;
      case 'fields': return formFields.filter(f => f.required).every(f => (fieldValues[f.name] ?? '').trim());
      case 'recipients': return contractName.trim() !== '' && signers.some(s => s.email.trim());
      case 'review': return true;
      default: return false;
    }
  };

  const stepIdx = STEPS.findIndex(s => s.key === step);
  const goNext = () => { if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1].key); };
  const goBack = () => { if (stepIdx > 0) setStep(STEPS[stepIdx - 1].key); };

  const handleSelectTemplate = async (t: AdobeSignLibraryDocument) => {
    setSelectedTemplate(t);
    setContractName(t.name);
    setFieldValues({});
    setFormFields([]);
    setFieldsLoading(true);
    try {
      const res = await fetch(`/api/adobe-sign/library-documents/${encodeURIComponent(t.id)}/form-fields`);
      const json = await res.json();
      if (json.ok) {
        const fields: AdobeSignFormField[] = json.data ?? [];
        setFormFields(fields);
        const defaults: Record<string, string> = {};
        for (const f of fields) {
          if (f.defaultValue) defaults[f.name] = f.defaultValue;
        }
        setFieldValues(defaults);
      }
    } catch { /* ignore — Step 2 will show empty state */ }
    setFieldsLoading(false);
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const mergeFields = formFields.length > 0
        ? formFields
            .filter(f => (fieldValues[f.name] ?? '').trim())
            .map(f => ({ fieldName: f.name, defaultValue: fieldValues[f.name] }))
        : undefined;

      const res = await fetch('/api/adobe-sign/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          library_document_id: selectedTemplate?.id,
          name: contractName,
          signer_emails: signers.filter(s => s.email.trim()).map(s => s.email.trim()),
          cc_emails: ccEmails.split(',').map(e => e.trim()).filter(Boolean),
          message: message || undefined,
          merge_fields: mergeFields,
          expiration_days: expirationDays ? parseInt(expirationDays, 10) : undefined,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setSentId(json.data.agreement_id);
      } else {
        alert(json.error ?? 'Failed to send agreement');
      }
    } catch (err) {
      alert('Failed to send: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
    setSending(false);
  };

  const addSigner = () => setSigners([...signers, { email: '', name: '' }]);
  const removeSigner = (idx: number) => setSigners(signers.filter((_, i) => i !== idx));
  const updateSigner = (idx: number, updates: Partial<{ email: string; name: string }>) => {
    setSigners(signers.map((s, i) => i === idx ? { ...s, ...updates } : s));
  };

  if (sentId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-full bg-green-900/30 border border-green-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-[16px] font-semibold text-neutral-100">Agreement Sent</h2>
          <p className="text-[12px] text-neutral-400 max-w-sm">
            Your agreement has been sent for signature via Adobe Sign. Track its status in the Adobe Sign tab.
          </p>
          <p className="text-[10px] text-neutral-600 font-mono">{sentId}</p>
          <div className="flex justify-center gap-3 pt-2">
            <button onClick={onNavigateToAgreements} className={btnPrimary}>
              View Agreements
            </button>
            <button onClick={() => {
              setSentId(null);
              setStep('template');
              setSelectedTemplate(null);
              setFormFields([]);
              setFieldValues({});
              setSigners([{ email: '', name: '' }]);
              setContractName('');
            }} className={btnSecondary}>
              Send Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-4 pb-3 border-b border-[#3a424d]">
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <button
                onClick={() => { if (i <= stepIdx) setStep(s.key); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-[11px] transition-colors ${
                  step === s.key
                    ? 'bg-[#5ec1ca]/15 text-[#5ec1ca] border border-[#5ec1ca]/30'
                    : i < stepIdx
                    ? 'text-neutral-300 hover:text-[#5ec1ca]'
                    : 'text-neutral-600'
                }`}
                disabled={i > stepIdx}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium ${
                  i < stepIdx ? 'bg-[#5ec1ca] text-[#272C33]' : i === stepIdx ? 'bg-[#5ec1ca]/20 text-[#5ec1ca]' : 'bg-[#2f353d] text-neutral-600'
                }`}>
                  {i < stepIdx ? '✓' : i + 1}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <div className="w-8 h-px bg-[#3a424d] mx-1" />}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {step === 'template' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-[14px] font-semibold text-neutral-100">Select a Template</h2>
                <p className="text-[11px] text-neutral-500 mt-0.5">Templates are pulled live from Adobe Sign. To add a new template, create it in Adobe Sign.</p>
              </div>
              <button onClick={fetchTemplates} className={btnSecondary} disabled={loading}>
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            <input
              type="text"
              placeholder="Search templates..."
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              className={`${inputCls} max-w-sm mb-4`}
            />

            {loading ? (
              <div className="text-neutral-500 text-[12px] py-8 text-center">Loading templates from Adobe Sign...</div>
            ) : loadError ? (
              <div className="text-amber-400 text-[12px] py-8 text-center max-w-md mx-auto">
                {loadError}
                <div className="text-neutral-500 text-[11px] mt-2">
                  Check that Adobe Sign is connected in Admin &gt; Integrations.
                </div>
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-neutral-500 text-[12px] py-8 text-center">
                {templates.length === 0
                  ? 'No library documents found in Adobe Sign. Create a template in Adobe Sign first.'
                  : 'No templates match your search.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredTemplates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleSelectTemplate(t)}
                    className={`text-left p-4 rounded-lg border transition-colors ${
                      selectedTemplate?.id === t.id
                        ? 'bg-[#5ec1ca]/10 border-[#5ec1ca]/40'
                        : 'bg-[#1e2228] border-[#3a424d] hover:border-[#5ec1ca]/30'
                    }`}
                  >
                    <div className="text-[12px] font-medium text-neutral-200 mb-1">{t.name}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {(t.templateTypes ?? []).map((tt) => (
                        <span key={tt} className="text-[9px] px-1.5 py-0.5 rounded bg-[#2f353d] text-neutral-400">
                          {tt.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      ))}
                    </div>
                    <div className="text-[10px] text-neutral-600 mt-2">Modified {fmtDate(t.modifiedDate)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'fields' && selectedTemplate && (
          <div className="max-w-lg">
            <h2 className="text-[14px] font-semibold text-neutral-100 mb-1">Fill in Contract Details</h2>
            <p className="text-[11px] text-neutral-500 mb-4">Template: {selectedTemplate.name}</p>

            {fieldsLoading ? (
              <div className="text-[12px] text-neutral-500 py-4">Loading fields from Adobe Sign...</div>
            ) : formFields.length === 0 ? (
              <div className="text-[12px] text-neutral-500 py-4">
                This template has no sender-fillable merge fields. Signers will fill any fields directly when signing.
              </div>
            ) : (
              <div className="space-y-3">
                {formFields.map((f) => {
                  const inputType = inputTypeFor(f);
                  const value = fieldValues[f.name] ?? '';
                  return (
                    <div key={f.name}>
                      <label className={labelCls}>
                        {f.displayLabel || f.name} {f.required && <span className="text-red-400">*</span>}
                        {f.assignee && f.assignee !== 'SENDER' && (
                          <span className="ml-2 text-neutral-600 normal-case">(assigned: {f.assignee})</span>
                        )}
                      </label>
                      {inputType === 'select' ? (
                        <select
                          className={inputCls}
                          value={value}
                          onChange={(e) => setFieldValues({ ...fieldValues, [f.name]: e.target.value })}
                        >
                          <option value="">Select...</option>
                          {(f.options ?? []).map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : inputType === 'checkbox' ? (
                        <label className="flex items-center gap-2 text-[11px] text-neutral-300">
                          <input
                            type="checkbox"
                            checked={value === 'true' || value === 'on'}
                            onChange={(e) => setFieldValues({ ...fieldValues, [f.name]: e.target.checked ? 'true' : 'false' })}
                            className="accent-[#5ec1ca]"
                          />
                          {f.displayLabel || f.name}
                        </label>
                      ) : inputType === 'radio' && (f.options ?? []).length > 0 ? (
                        <div className="space-y-1">
                          {(f.options ?? []).map((opt) => (
                            <label key={opt} className="flex items-center gap-2 text-[11px] text-neutral-300">
                              <input
                                type="radio"
                                name={f.name}
                                value={opt}
                                checked={value === opt}
                                onChange={(e) => setFieldValues({ ...fieldValues, [f.name]: e.target.value })}
                                className="accent-[#5ec1ca]"
                              />
                              {opt}
                            </label>
                          ))}
                        </div>
                      ) : (
                        <input
                          className={inputCls}
                          type={inputType === 'date' ? 'date' : inputType === 'email' ? 'email' : 'text'}
                          value={value}
                          onChange={(e) => setFieldValues({ ...fieldValues, [f.name]: e.target.value })}
                          placeholder={f.defaultValue ?? ''}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {step === 'recipients' && (
          <div className="max-w-lg">
            <h2 className="text-[14px] font-semibold text-neutral-100 mb-4">Recipients</h2>

            <div className="mb-4">
              <label className={labelCls}>Agreement Name *</label>
              <input
                className={inputCls}
                value={contractName}
                onChange={(e) => setContractName(e.target.value)}
                placeholder="e.g. Service Agreement — Acme Corp"
              />
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className={labelCls}>Signers *</label>
                <button onClick={addSigner} className="text-[10px] text-[#5ec1ca] hover:text-[#4db0b9]">+ Add Signer</button>
              </div>
              <div className="space-y-2">
                {signers.map((s, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      className={`${inputCls} flex-1`}
                      placeholder="Email address"
                      type="email"
                      value={s.email}
                      onChange={(e) => updateSigner(idx, { email: e.target.value })}
                    />
                    <input
                      className={`${inputCls} flex-1`}
                      placeholder="Name (optional)"
                      value={s.name}
                      onChange={(e) => updateSigner(idx, { name: e.target.value })}
                    />
                    {signers.length > 1 && (
                      <button onClick={() => removeSigner(idx)} className="text-neutral-600 hover:text-red-400 text-sm">&times;</button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-neutral-600 mt-1">Signers will receive the document in order (1st signer signs first)</p>
            </div>

            <div className="mb-4">
              <label className={labelCls}>CC Emails</label>
              <input
                className={inputCls}
                value={ccEmails}
                onChange={(e) => setCcEmails(e.target.value)}
                placeholder="Comma-separated email addresses"
              />
            </div>

            <div className="mb-4">
              <label className={labelCls}>Message to Signers</label>
              <textarea
                className={`${inputCls} resize-none`}
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Optional message included in the signing email"
              />
            </div>

            <div>
              <label className={labelCls}>Expiration (days)</label>
              <input
                className={`${inputCls} max-w-[120px]`}
                type="number"
                min="1"
                value={expirationDays}
                onChange={(e) => setExpirationDays(e.target.value)}
                placeholder="e.g. 30"
              />
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="max-w-lg">
            <h2 className="text-[14px] font-semibold text-neutral-100 mb-4">Review & Send</h2>

            <div className="space-y-4 bg-[#1e2228] rounded-lg border border-[#3a424d] p-4">
              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">Template</span>
                <span className="text-[12px] text-neutral-200">{selectedTemplate?.name}</span>
              </div>

              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">Agreement Name</span>
                <span className="text-[12px] text-neutral-200">{contractName}</span>
              </div>

              {formFields.length > 0 && (
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">Merge Fields</span>
                  <div className="space-y-1">
                    {formFields.map((f) => (
                      <div key={f.name} className="flex items-baseline gap-2 text-[11px]">
                        <span className="text-neutral-500 min-w-[120px]">{f.displayLabel || f.name}:</span>
                        <span className="text-neutral-200">{fieldValues[f.name] || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">Signers</span>
                {signers.filter(s => s.email.trim()).map((s, i) => (
                  <div key={i} className="text-[11px] text-neutral-200">
                    {i + 1}. {s.email} {s.name && <span className="text-neutral-500">({s.name})</span>}
                  </div>
                ))}
              </div>

              {ccEmails.trim() && (
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">CC</span>
                  <span className="text-[11px] text-neutral-300">{ccEmails}</span>
                </div>
              )}

              {message && (
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">Message</span>
                  <span className="text-[11px] text-neutral-300">{message}</span>
                </div>
              )}

              {expirationDays && (
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">Expires In</span>
                  <span className="text-[11px] text-neutral-300">{expirationDays} days</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-6 py-4 border-t border-[#3a424d]">
        <div>
          {stepIdx > 0 && (
            <button onClick={goBack} className={btnSecondary}>Back</button>
          )}
        </div>
        <div>
          {step === 'review' ? (
            <button onClick={handleSend} disabled={sending} className={btnPrimary}>
              {sending ? 'Sending...' : 'Send for Signature'}
            </button>
          ) : (
            <button onClick={goNext} disabled={!canProceed(step)} className={btnPrimary}>
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
