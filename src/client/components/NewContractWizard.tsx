import { useState, useEffect, useCallback, useMemo } from 'react';
import type { AdobeSignLibraryDocument, AdobeSignFormField } from '../../shared/types.js';

interface Props {
  onNavigateToAgreements: () => void;
}

type Step = 'template' | 'fields' | 'recipients' | 'review';
const STEPS: { key: Step; label: string }[] = [
  { key: 'template', label: 'Select Templates' },
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

type InputKind = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'radio' | 'email';

function normaliseType(s: string | undefined): string {
  return (s ?? '').toUpperCase().replace(/[_\-\s]/g, '');
}

function inputTypeFor(field: AdobeSignFormField): InputKind {
  if (field.multiLine === true || field.isMultiLine === true) return 'textarea';

  const ct = normaliseType(field.contentType);
  const it = normaliseType(field.inputType);
  const both = `${ct} ${it}`;

  if (both.includes('MULTILINE') || both.includes('TEXTAREA') || both.includes('PARAGRAPH')) return 'textarea';
  if (both.includes('CHECKBOX') || both.includes('CHECKMARK')) return 'checkbox';
  if (both.includes('RADIO')) return 'radio';
  if (both.includes('DROPDOWN') || both.includes('COMBOBOX') || both.includes('LIST')) return 'select';
  if (both.includes('DATE')) return 'date';
  if (both.includes('EMAIL')) return 'email';
  if (both.includes('NUMBER') || both.includes('NUMERIC')) return 'number';

  return 'text';
}

// A form field aggregated across the selected templates. originNames captures which
// templates contributed this field (Adobe links fields with the same name across docs).
type MergedField = AdobeSignFormField & { originNames: string[] };

export function NewContractWizard({ onNavigateToAgreements }: Props) {
  const [step, setStep] = useState<Step>('template');
  const [templates, setTemplates] = useState<AdobeSignLibraryDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Multi-select: order matters — Adobe concatenates the bundle in this order.
  const [selectedTemplates, setSelectedTemplates] = useState<AdobeSignLibraryDocument[]>([]);
  // Cache form fields per template ID — fetched on first selection, kept across reorders/deselects.
  const [templateFields, setTemplateFields] = useState<Map<string, AdobeSignFormField[]>>(new Map());
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

  // Merged field list — union of all selected templates' fields, deduped by name, with origin tracking.
  const mergedFields = useMemo<MergedField[]>(() => {
    const map = new Map<string, MergedField>();
    for (const t of selectedTemplates) {
      const fields = templateFields.get(t.id) ?? [];
      for (const f of fields) {
        const existing = map.get(f.name);
        if (existing) {
          if (!existing.originNames.includes(t.name)) existing.originNames.push(t.name);
        } else {
          map.set(f.name, { ...f, originNames: [t.name] });
        }
      }
    }
    return Array.from(map.values());
  }, [selectedTemplates, templateFields]);

  const fetchTemplates = useCallback(async (force = false) => {
    setLoading(true);
    setLoadError(null);
    try {
      const url = force ? '/api/adobe-sign/library-documents?refresh=1' : '/api/adobe-sign/library-documents';
      const res = await fetch(url);
      const json = await res.json();
      if (json.ok) {
        setTemplates(json.data ?? []);
      } else if (res.status === 429) {
        const retry = typeof json.retryAfter === 'number' ? json.retryAfter : 60;
        setLoadError(`Adobe Sign is rate-limiting us. Try again in ${retry}s.`);
      } else {
        setLoadError(json.error ?? 'Failed to load templates from Adobe Sign');
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load templates');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTemplates(false); }, [fetchTemplates]);

  const filteredTemplates = templates.filter((t) =>
    !templateSearch.trim() ||
    t.name.toLowerCase().includes(templateSearch.toLowerCase())
  );

  const canProceed = (s: Step): boolean => {
    switch (s) {
      case 'template': return selectedTemplates.length > 0;
      case 'fields': return mergedFields.filter(f => f.required).every(f => (fieldValues[f.name] ?? '').trim());
      case 'recipients': return contractName.trim() !== '' && signers.some(s => s.email.trim());
      case 'review': return true;
      default: return false;
    }
  };

  const stepIdx = STEPS.findIndex(s => s.key === step);
  const goNext = () => { if (stepIdx < STEPS.length - 1) setStep(STEPS[stepIdx + 1].key); };
  const goBack = () => { if (stepIdx > 0) setStep(STEPS[stepIdx - 1].key); };

  const fetchTemplateFields = useCallback(async (templateId: string): Promise<AdobeSignFormField[]> => {
    try {
      const res = await fetch(`/api/adobe-sign/library-documents/${encodeURIComponent(templateId)}/form-fields`);
      const json = await res.json();
      if (json.ok) return json.data ?? [];
    } catch { /* Step 2 will fall back to empty state */ }
    return [];
  }, []);

  const toggleTemplate = useCallback(async (t: AdobeSignLibraryDocument) => {
    const wasSelected = selectedTemplates.some(s => s.id === t.id);
    if (wasSelected) {
      setSelectedTemplates(prev => prev.filter(s => s.id !== t.id));
      return;
    }
    // Adding: append to ordered list
    const newSelection = [...selectedTemplates, t];
    setSelectedTemplates(newSelection);
    // Auto-populate contract name from the first template (user can still edit)
    if (!contractName.trim() && newSelection.length === 1) setContractName(t.name);

    // Fetch this template's fields if not already cached
    if (!templateFields.has(t.id)) {
      setFieldsLoading(true);
      const fields = await fetchTemplateFields(t.id);
      setTemplateFields(prev => new Map(prev).set(t.id, fields));
      // Seed any default values for newly-discovered fields (don't overwrite user input)
      setFieldValues(prev => {
        const next = { ...prev };
        for (const f of fields) {
          if (f.defaultValue && next[f.name] === undefined) next[f.name] = f.defaultValue;
        }
        return next;
      });
      setFieldsLoading(false);
    }
  }, [selectedTemplates, templateFields, contractName, fetchTemplateFields]);

  const moveTemplateUp = (idx: number) => {
    if (idx <= 0) return;
    setSelectedTemplates(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveTemplateDown = (idx: number) => {
    setSelectedTemplates(prev => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const removeFromSelection = (idx: number) => {
    setSelectedTemplates(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const mergeFields = mergedFields.length > 0
        ? mergedFields
            .filter(f => (fieldValues[f.name] ?? '').trim())
            .map(f => ({ fieldName: f.name, defaultValue: fieldValues[f.name] }))
        : undefined;

      const res = await fetch('/api/adobe-sign/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          library_document_ids: selectedTemplates.map(t => t.id),
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

  const resetWizard = () => {
    setSentId(null);
    setStep('template');
    setSelectedTemplates([]);
    setTemplateFields(new Map());
    setFieldValues({});
    setSigners([{ email: '', name: '' }]);
    setContractName('');
    setCcEmails('');
    setMessage('');
    setExpirationDays('');
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
            <button onClick={resetWizard} className={btnSecondary}>
              Send Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  const selectedCount = selectedTemplates.length;
  const isSelected = (t: AdobeSignLibraryDocument) => selectedTemplates.some(s => s.id === t.id);
  const orderIndex = (t: AdobeSignLibraryDocument) => selectedTemplates.findIndex(s => s.id === t.id);

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
                <h2 className="text-[14px] font-semibold text-neutral-100">Select Templates</h2>
                <p className="text-[11px] text-neutral-500 mt-0.5">
                  Pick one or more templates. They'll be bundled into a single agreement in the order shown below.
                </p>
              </div>
              <button onClick={() => fetchTemplates(true)} className={btnSecondary} disabled={loading}>
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

            {/* Selected templates — ordered bundle list with reorder controls */}
            {selectedCount > 0 && (
              <div className="mb-5 rounded-lg border border-[#5ec1ca]/30 bg-[#5ec1ca]/5 p-3">
                <div className="text-[10px] text-[#5ec1ca] uppercase tracking-wider mb-2">
                  Bundle order — {selectedCount} {selectedCount === 1 ? 'template' : 'templates'}
                </div>
                <div className="space-y-1">
                  {selectedTemplates.map((t, idx) => (
                    <div key={t.id} className="flex items-center gap-2 bg-[#1e2228] rounded px-2 py-1.5 border border-[#3a424d]">
                      <span className="text-[10px] text-neutral-500 font-mono w-5">{idx + 1}.</span>
                      <span className="text-[11px] text-neutral-200 flex-1 truncate">{t.name}</span>
                      <button
                        onClick={() => moveTemplateUp(idx)}
                        disabled={idx === 0}
                        className="text-neutral-500 hover:text-[#5ec1ca] disabled:opacity-20 disabled:hover:text-neutral-500 text-[12px] leading-none px-1"
                        title="Move up"
                      >▲</button>
                      <button
                        onClick={() => moveTemplateDown(idx)}
                        disabled={idx === selectedCount - 1}
                        className="text-neutral-500 hover:text-[#5ec1ca] disabled:opacity-20 disabled:hover:text-neutral-500 text-[12px] leading-none px-1"
                        title="Move down"
                      >▼</button>
                      <button
                        onClick={() => removeFromSelection(idx)}
                        className="text-neutral-500 hover:text-red-400 text-sm leading-none px-1"
                        title="Remove from bundle"
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                {filteredTemplates.map((t) => {
                  const sel = isSelected(t);
                  const order = orderIndex(t);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleTemplate(t)}
                      className={`text-left p-4 rounded-lg border transition-colors relative ${
                        sel
                          ? 'bg-[#5ec1ca]/10 border-[#5ec1ca]/40'
                          : 'bg-[#1e2228] border-[#3a424d] hover:border-[#5ec1ca]/30'
                      }`}
                    >
                      {sel && (
                        <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#5ec1ca] text-[#272C33] text-[10px] font-bold flex items-center justify-center">
                          {order + 1}
                        </span>
                      )}
                      <div className="text-[12px] font-medium text-neutral-200 mb-1 pr-7">{t.name}</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {(t.templateTypes ?? []).map((tt) => (
                          <span key={tt} className="text-[9px] px-1.5 py-0.5 rounded bg-[#2f353d] text-neutral-400">
                            {tt.replace(/_/g, ' ').toLowerCase()}
                          </span>
                        ))}
                      </div>
                      <div className="text-[10px] text-neutral-600 mt-2">Modified {fmtDate(t.modifiedDate)}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {step === 'fields' && selectedCount > 0 && (
          <div className="max-w-lg">
            <h2 className="text-[14px] font-semibold text-neutral-100 mb-1">Fill in Contract Details</h2>
            <p className="text-[11px] text-neutral-500 mb-4">
              {selectedCount === 1
                ? `Template: ${selectedTemplates[0].name}`
                : `Bundle of ${selectedCount} templates — fields with the same name across templates are linked.`}
            </p>

            {fieldsLoading ? (
              <div className="text-[12px] text-neutral-500 py-4">Loading fields from Adobe Sign...</div>
            ) : mergedFields.length === 0 ? (
              <div className="text-[12px] text-neutral-500 py-4">
                No sender-fillable merge fields across the selected templates. Signers will fill any fields directly when signing.
              </div>
            ) : (
              <div className="space-y-3">
                {mergedFields.map((f) => {
                  const inputType = inputTypeFor(f);
                  const value = fieldValues[f.name] ?? '';
                  const showOrigins = selectedCount > 1;
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
                      ) : inputType === 'textarea' ? (
                        <textarea
                          ref={(el) => {
                            if (el) {
                              el.style.height = 'auto';
                              el.style.height = `${Math.max(el.scrollHeight, 60)}px`;
                            }
                          }}
                          className={`${inputCls} resize-none overflow-hidden`}
                          rows={3}
                          value={value}
                          onChange={(e) => {
                            setFieldValues({ ...fieldValues, [f.name]: e.target.value });
                            const t = e.currentTarget;
                            t.style.height = 'auto';
                            t.style.height = `${t.scrollHeight}px`;
                          }}
                          placeholder={f.defaultValue ?? ''}
                        />
                      ) : (
                        <input
                          className={inputCls}
                          type={inputType === 'date' ? 'date' : inputType === 'email' ? 'email' : inputType === 'number' ? 'number' : 'text'}
                          value={value}
                          onChange={(e) => setFieldValues({ ...fieldValues, [f.name]: e.target.value })}
                          placeholder={f.defaultValue ?? ''}
                        />
                      )}
                      {showOrigins && (
                        <div className="text-[9px] text-neutral-600 mt-1">
                          in: {f.originNames.join(', ')}
                        </div>
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
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">
                  {selectedCount === 1 ? 'Template' : `Bundle (${selectedCount} templates, in order)`}
                </span>
                <div className="space-y-0.5">
                  {selectedTemplates.map((t, i) => (
                    <div key={t.id} className="text-[11px] text-neutral-200">
                      <span className="text-neutral-500 font-mono mr-2">{i + 1}.</span>{t.name}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-0.5">Agreement Name</span>
                <span className="text-[12px] text-neutral-200">{contractName}</span>
              </div>

              {mergedFields.length > 0 && (
                <div>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">Merge Fields</span>
                  <div className="space-y-1">
                    {mergedFields.map((f) => (
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
